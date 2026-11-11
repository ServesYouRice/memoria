/**
 * Same-origin image proxy (IMP-057)
 *
 * GET /api/v1/image-proxy?url=<remote image URL>[&sig=<signature>]
 *
 * Lets the CSP drop `img-src https:`: remote favicons, link previews, image
 * items and OAuth avatars load from Memoria's own origin. Access needs a
 * session, or a server-issued signature over the exact URL (embed and public
 * share viewers; see `src/lib/images/signed-proxy.ts`).
 *
 * The fetch reuses the SSRF protections of link unfurling (DNS-pinned
 * requests, private-address rejection, per-redirect revalidation), caps the
 * body size, and serves only raster images identified by their magic bytes.
 * SVG is rejected. Small images are cached in Redis; every response carries
 * browser cache headers and an ETag.
 */

import { createHash } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { ApiError, unauthorizedError } from "@/lib/errors";
import {
  getCachedProxiedImage,
  setCachedProxiedImage,
} from "@/lib/cache/image-proxy-cache";
import {
  IMAGE_PROXY_MAX_URL_LENGTH,
  IMAGE_PROXY_SIGNATURE_PARAM,
  IMAGE_PROXY_URL_PARAM,
  isRemoteHttpUrl,
} from "@/lib/images/proxy-url";
import { verifyImageProxySignature } from "@/lib/images/signed-proxy";
import { sniffImageType } from "@/lib/images/sniff";
import {
  safeFetchBuffer,
  validateUrlForSsrf,
} from "@/lib/utils/ssrf-protection";

export const dynamic = "force-dynamic";

/** Largest remote image the proxy will relay. */
const IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_PROXY_TIMEOUT_MS = 10_000;
const IMAGE_PROXY_MAX_REDIRECTS = 3;

/** Browser cache lifetime; remote images change rarely. */
const IMAGE_PROXY_CACHE_CONTROL =
  "private, max-age=86400, stale-while-revalidate=604800";

const ERROR_TYPE = "https://memoria.local/errors/image-proxy";

const querySchema = z.object({
  [IMAGE_PROXY_URL_PARAM]: z
    .string()
    .min(1)
    .max(IMAGE_PROXY_MAX_URL_LENGTH)
    .refine(isRemoteHttpUrl, "Image URL must be an absolute HTTP(S) URL"),
  [IMAGE_PROXY_SIGNATURE_PARAM]: z.string().max(128).optional(),
});

function proxyError(status: number, title: string, detail: string): ApiError {
  return new ApiError(status, ERROR_TYPE, title, detail);
}

/** Map a failed safe fetch onto the status the browser should see. */
function upstreamError(status: number, error?: string): ApiError {
  if (status === 400) {
    return proxyError(400, "Image URL Rejected", error || "URL is not allowed");
  }
  if (status === 413) {
    return proxyError(
      413,
      "Image Too Large",
      "Remote image exceeds the size cap",
    );
  }
  if (status === 408) {
    return proxyError(504, "Image Fetch Timeout", "Remote image timed out");
  }
  return proxyError(
    502,
    "Image Fetch Failed",
    "Remote image could not be fetched",
  );
}

async function loadImage(
  url: string,
): Promise<{ contentType: string; body: Buffer }> {
  const cached = await getCachedProxiedImage(url);
  if (cached && sniffImageType(cached.body) === cached.contentType) {
    return cached;
  }

  const result = await safeFetchBuffer(url, {
    maxRedirects: IMAGE_PROXY_MAX_REDIRECTS,
    timeout: IMAGE_PROXY_TIMEOUT_MS,
    // Whole fetch, redirects included; a dripping server cannot hold it open.
    deadlineMs: IMAGE_PROXY_TIMEOUT_MS,
    maxSize: IMAGE_PROXY_MAX_BYTES,
    headers: {
      Accept:
        "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
      "User-Agent": "Memoria/1.0 (Image Proxy)",
    },
  });
  if (!result.ok || !result.body) {
    throw upstreamError(result.status, result.error);
  }

  const contentType = sniffImageType(result.body);
  if (!contentType) {
    throw proxyError(
      415,
      "Unsupported Image Type",
      "Only PNG, JPEG, GIF, WebP, AVIF and ICO images are proxied",
    );
  }

  const image = { contentType, body: result.body };
  await setCachedProxiedImage(url, image);
  return image;
}

export const GET = withApiHandler(async (request: NextRequest) => {
  const query = querySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const url = query[IMAGE_PROXY_URL_PARAM];

  // A valid signature stands in for a session; anything else needs one.
  if (!verifyImageProxySignature(url, query[IMAGE_PROXY_SIGNATURE_PARAM])) {
    const session = await auth();
    if (!session?.user?.id) throw unauthorizedError();
  }

  // Cheap syntactic rejection before cache or DNS; safeFetchBuffer repeats
  // this with DNS pinning on every hop.
  const ssrf = validateUrlForSsrf(url);
  if (!ssrf.valid) {
    throw proxyError(
      400,
      "Image URL Rejected",
      ssrf.error || "URL is not allowed",
    );
  }

  const image = await loadImage(url);
  const etag = `"${createHash("sha256").update(image.body).digest("base64url").slice(0, 32)}"`;
  const headers: Record<string, string> = {
    "content-type": image.contentType,
    "cache-control": IMAGE_PROXY_CACHE_CONTROL,
    etag,
    "x-content-type-options": "nosniff",
    "content-disposition": "inline",
    "cross-origin-resource-policy": "same-origin",
  };

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(new Uint8Array(image.body), {
    status: 200,
    headers: { ...headers, "content-length": String(image.body.length) },
  });
});
