/**
 * Bookmark Unfurl Metadata Caching
 * Following ADR-0011: Server-Side Caching Strategy
 * Caches unfurled metadata to reduce external HTTP requests
 */

import { getRedisClient } from './redis-client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('unfurl-cache');

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
 * Get cached unfurl metadata for a URL
 */
export async function getCachedUnfurl(url: string): Promise<UnfurledMetadata | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    // Normalize URL for consistent caching
    const normalizedUrl = normalizeUrl(url);
    const cached = await redis.get(`unfurl:${normalizedUrl}`);

    if (!cached) return null;

    return JSON.parse(cached) as UnfurledMetadata;
  } catch (error) {
    logger.error({ error }, 'Error getting cached unfurl');
    return null;
  }
}

/**
 * Set unfurl metadata in cache
 */
export async function setCachedUnfurl(url: string, metadata: UnfurledMetadata): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const normalizedUrl = normalizeUrl(url);
    await redis.setex(`unfurl:${normalizedUrl}`, UNFURL_CACHE_TTL, JSON.stringify(metadata));
  } catch (error) {
    logger.error({ error }, 'Error setting cached unfurl');
  }
}

/**
 * Invalidate unfurl cache for a URL
 */
export async function invalidateUnfurlCache(url: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const normalizedUrl = normalizeUrl(url);
    await redis.del(`unfurl:${normalizedUrl}`);
  } catch (error) {
    logger.error({ error }, 'Error invalidating unfurl cache');
  }
}

/**
 * Normalize URL for consistent cache keys
 * - Removes trailing slashes
 * - Converts to lowercase
 * - Removes fragment (#)
 * - Sorts query parameters
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove fragment
    parsed.hash = '';

    // Sort query parameters
    const params = Array.from(parsed.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    parsed.search = '';
    params.forEach(([key, value]) => parsed.searchParams.set(key, value));

    // Convert to string and remove trailing slash
    let normalized = parsed.toString().toLowerCase();
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch (error) {
    // If URL parsing fails, return original
    return url.toLowerCase();
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
    const keys = await redis.keys('unfurl:*');
    const info = await redis.info('memory');
    const memoryMatch = info.match(/used_memory_human:(.+)/);
    const memoryUsage = memoryMatch?.[1] ? memoryMatch[1].trim() : 'unknown';

    return {
      totalKeys: keys.length,
      memoryUsage,
    };
  } catch (error) {
    logger.error({ error }, 'Error getting unfurl cache stats');
    return null;
  }
}
