/**
 * Canvas Snapshot Caching
 * Following ADR-0011: Server-Side Caching Strategy
 * Caches canvas snapshots to reduce database load
 */


import { getRedisClient } from './redis-client';
import { Canvas, CanvasItem } from '@prisma/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('canvas-cache');

export type CanvasData = Canvas & {
  items: CanvasItem[];
};

/**
 * Cache TTL for canvas snapshots (5 minutes)
 */
const CANVAS_CACHE_TTL = 5 * 60;

/**
 * Get canvas data (canvas + items) from cache
 */
export async function getCachedCanvas(canvasId: string): Promise<CanvasData | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const cached = await redis.get(`canvas:${canvasId}:data`);
    if (!cached) return null;

    return JSON.parse(cached) as CanvasData;
  } catch (error) {
    logger.error({ error }, 'Error getting cached canvas');
    return null;
  }
}

/**
 * Set canvas data in cache
 */
export async function setCachedCanvas(canvas: CanvasData): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    // Store with 5 minute TTL
    await redis.setex(
      `canvas:${canvas.id}:data`,
      CANVAS_CACHE_TTL,
      JSON.stringify(canvas)
    );
  } catch (error) {
    logger.error({ error }, 'Error setting cached canvas');
  }
}

/**
 * Invalidate canvas cache
 */
export async function invalidateCanvasCache(canvasId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(`canvas:${canvasId}:data`);
  } catch (error) {
    logger.error({ error }, 'Error invalidating canvas cache');
  }
}

