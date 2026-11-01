/**
 * Same-origin image proxy URLs (IMP-057)
 *
 * The CSP `img-src` lists only Memoria's own and storage origins, so a remote
 * image (bookmark favicon or preview, image item with an external URL, OAuth
 * avatar) is loaded through `/api/v1/image-proxy`, which fetches it with the
 * SSRF protections of link unfurling. This module is safe to import from
 * client components; signing lives in `signed-proxy.ts` on the server.
 */

export const IMAGE_PROXY_PATH = "/api/v1/image-proxy";
export const IMAGE_PROXY_URL_PARAM = "url";
export const IMAGE_PROXY_SIGNATURE_PARAM = "sig";

/** Upper bound on a proxied URL, matching item content URL limits. */
export const IMAGE_PROXY_MAX_URL_LENGTH = 2048;

/** True for an absolute `http:` or `https:` URL. */
export function isRemoteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildImageProxyPath(url: string, signature?: string): string {
  const params = new URLSearchParams({ [IMAGE_PROXY_URL_PARAM]: url });
  if (signature) params.set(IMAGE_PROXY_SIGNATURE_PARAM, signature);
  return `${IMAGE_PROXY_PATH}?${params.toString()}`;
}

/**
 * Map an image source to one the CSP allows.
 *
 * Same-origin paths (uploads, thumbnails, already-proxied URLs), `data:` and
 * `blob:` sources pass through unchanged. Remote `http(s)` URLs go through the
 * proxy. Anything else (protocol-relative, `javascript:`, malformed) yields
 * `undefined` so callers render their fallback instead of a blocked request.
 */
export function toImageProxyUrl(
  src: string | null | undefined,
): string | undefined {
  if (!src) return undefined;
  const value = src.trim();
  if (!value) return undefined;

  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("data:image/") || value.startsWith("blob:")) {
    return value;
  }
  if (!isRemoteHttpUrl(value) || value.length > IMAGE_PROXY_MAX_URL_LENGTH) {
    return undefined;
  }

  if (
    typeof window !== "undefined" &&
    new URL(value).origin === window.location.origin
  ) {
    return value;
  }
  return buildImageProxyPath(value);
}
