/**
 * Bookmark Unfurl Metadata Caching
 * Following ADR-0011: Server-Side Caching Strategy
 * Caches unfurled metadata to reduce external HTTP requests
 */

import { getRedisClient } from "./redis-client";
import { redisScanPattern } from "./redis-keys";
import { createLogger } from "@/lib/logger";

const logger = createLogger("unfurl-cache");

interface UnfurledMetadata {
  title?: string;
  description?: string;
  favicon?: string;
  previewImage?: string;
  siteName?: string;
  unfurledAt?: string;
}

/**
 * Cache TTL for unfurl metadata (24 hours)
 * Longer TTL since external site metadata changes infrequently
 */
const UNFURL_CACHE_TTL = 24 * 60 * 60;

/**
 * Versioned so entries written under the old lowercased keys (which could
 * collide across distinct URLs) are never read; they expire under the TTL.
 */
const UNFURL_KEY_PREFIX = "unfurl:v2:";

function unfurlCacheKey(url: string): string {
  return `${UNFURL_KEY_PREFIX}${normalizeUrl(url)}`;
}

/**
 * Get cached unfurl metadata for a URL
 */
export async function getCachedUnfurl(
  url: string,
): Promise<UnfurledMetadata | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const cached = await redis.get(unfurlCacheKey(url));

    if (!cached) return null;

    return JSON.parse(cached) as UnfurledMetadata;
  } catch (error) {
    logger.error({ error }, "Error getting cached unfurl");
    return null;
  }
}

/**
 * Set unfurl metadata in cache
 */
export async function setCachedUnfurl(
  url: string,
  metadata: UnfurledMetadata,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.setex(
      unfurlCacheKey(url),
      UNFURL_CACHE_TTL,
      JSON.stringify(metadata),
    );
  } catch (error) {
    logger.error({ error }, "Error setting cached unfurl");
  }
}

/**
 * Invalidate unfurl cache for a URL
 */
export async function invalidateUnfurlCache(url: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(unfurlCacheKey(url));
  } catch (error) {
    logger.error({ error }, "Error invalidating unfurl cache");
  }
}

/**
 * Normalize URL for consistent cache keys
 * - Lowercases only the scheme and host (the URL parser does this); path and
 *   query are case-sensitive and kept as given
 * - Removes fragment (#)
 * - Sorts query parameters by key, keeping repeated keys and their order
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove fragment
    parsed.hash = "";

    // URLSearchParams.sort is stable and keeps every repeated key.
    parsed.searchParams.sort();

    return parsed.toString();
  } catch {
    // If URL parsing fails, use the original string unchanged
    return url;
  }
}

/**
 * Get cache statistics
 */
export async function getUnfurlCacheStats(): Promise<{
  totalKeys: number;
  memoryUsage: string;
} | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    // SCAN, never KEYS: KEYS blocks the server and the shared Valkey's ACL
    // refuses it. keyPrefix does not reach MATCH, so the pattern carries it.
    const match = redisScanPattern("unfurl:*");
    let totalKeys = 0;
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        match,
        "COUNT",
        250,
      );
      totalKeys += keys.length;
      cursor = next;
    } while (cursor !== "0");
    const info = await redis.info("memory");
    const memoryMatch = info.match(/used_memory_human:(.+)/);
    const memoryUsage = memoryMatch?.[1] ? memoryMatch[1].trim() : "unknown";

    return {
      totalKeys,
      memoryUsage,
    };
  } catch (error) {
    logger.error({ error }, "Error getting unfurl cache stats");
    return null;
  }
}
