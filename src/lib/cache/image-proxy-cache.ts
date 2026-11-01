/**
 * Image proxy cache (IMP-057)
 * Following ADR-0011: Server-Side Caching Strategy
 *
 * Keeps small proxied images (favicons, link previews) in the shared Redis so
 * repeated views do not refetch them from third-party hosts. Larger bodies are
 * served once and left to the browser cache. Without Redis it is a no-op.
 */

import { createHash } from "crypto";
import { getRedisClient } from "./redis-client";
import { createLogger } from "@/lib/logger";

const logger = createLogger("image-proxy-cache");

/** Same lifetime as unfurl metadata: remote images change rarely. */
export const IMAGE_PROXY_CACHE_TTL_SECONDS = 24 * 60 * 60;

/** Bodies above this size are not stored in Redis. */
export const IMAGE_PROXY_CACHE_MAX_BYTES = 512 * 1024;

export interface CachedProxiedImage {
  contentType: string;
  body: Buffer;
}

function cacheKey(url: string): string {
  // Paths and queries are case-sensitive, so hash the exact URL.
  return `image-proxy:v1:${createHash("sha256").update(url).digest("hex")}`;
}

export async function getCachedProxiedImage(
  url: string,
): Promise<CachedProxiedImage | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const stored = await redis.getBuffer(cacheKey(url));
    if (!stored) return null;
    const separator = stored.indexOf(0x0a);
    if (separator <= 0) return null;
    return {
      contentType: stored.subarray(0, separator).toString("ascii"),
      body: stored.subarray(separator + 1),
    };
  } catch (error) {
    logger.error({ error }, "Error getting cached proxied image");
    return null;
  }
}

export async function setCachedProxiedImage(
  url: string,
  image: CachedProxiedImage,
): Promise<void> {
  if (image.body.length > IMAGE_PROXY_CACHE_MAX_BYTES) return;
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.setex(
      cacheKey(url),
      IMAGE_PROXY_CACHE_TTL_SECONDS,
      Buffer.concat([
        Buffer.from(`${image.contentType}\n`, "ascii"),
        image.body,
      ]),
    );
  } catch (error) {
    logger.error({ error }, "Error setting cached proxied image");
  }
}
