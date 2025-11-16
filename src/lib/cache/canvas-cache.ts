/**
 * Canvas Snapshot Caching
 * Following ADR-0011: Server-Side Caching Strategy
 * Caches canvas snapshots to reduce database load
 */

import { getRedisClient } from './redis-client';
import { Canvas } from '@/lib/hooks/use-canvases';

/**
 * Cache TTL for canvas snapshots (5 minutes)
 */
const CANVAS_CACHE_TTL = 5 * 60;

/**
 * Get canvas from cache
 */
export async function getCachedCanvas(canvasId: string): Promise<Canvas | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const cached = await redis.get(`canvas:${canvasId}`);
    if (!cached) return null;

    return JSON.parse(cached) as Canvas;
  } catch (error) {
    console.error('Error getting cached canvas:', error);
    return null;
  }
}

/**
 * Set canvas in cache
 */
export async function setCachedCanvas(canvas: Canvas): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.setex(`canvas:${canvas.id}`, CANVAS_CACHE_TTL, JSON.stringify(canvas));
  } catch (error) {
    console.error('Error setting cached canvas:', error);
  }
}

/**
 * Invalidate canvas cache
 */
export async function invalidateCanvasCache(canvasId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(`canvas:${canvasId}`);
  } catch (error) {
    console.error('Error invalidating canvas cache:', error);
  }
}

/**
 * Get canvas items from cache
 */
export async function getCachedCanvasItems(canvasId: string): Promise<any[] | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const cached = await redis.get(`canvas:${canvasId}:items`);
    if (!cached) return null;

    return JSON.parse(cached);
  } catch (error) {
    console.error('Error getting cached canvas items:', error);
    return null;
  }
}

/**
 * Set canvas items in cache
 */
export async function setCachedCanvasItems(canvasId: string, items: any[]): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.setex(`canvas:${canvasId}:items`, CANVAS_CACHE_TTL, JSON.stringify(items));
  } catch (error) {
    console.error('Error setting cached canvas items:', error);
  }
}

/**
 * Invalidate canvas items cache
 */
export async function invalidateCanvasItemsCache(canvasId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(`canvas:${canvasId}:items`);
  } catch (error) {
    console.error('Error invalidating canvas items cache:', error);
  }
}
