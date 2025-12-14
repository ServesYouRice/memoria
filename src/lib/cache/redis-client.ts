/**
 * Redis Client Configuration
 * Following ADR-0011: Server-Side Caching Strategy
 */

import Redis from 'ioredis';
import { createLogger } from '@/lib/logger';

const logger = createLogger('redis-client');

let redis: Redis | null = null;

/**
 * Get Redis client instance
 * Lazy initialization - only creates connection when needed
 */
export function getRedisClient(): Redis | null {
  // Check if Redis is enabled
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    logger.warn('Redis URL not configured, caching disabled');
    return null;
  }

  // Return existing client
  if (redis) {
    return redis;
  }

  try {
    // Create new Redis client
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redis.on('error', (error) => {
      logger.error({ error }, 'Redis connection error');
    });

    redis.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    return redis;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Redis client');
    return null;
  }
}

/**
 * Close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return redis !== null && redis.status === 'ready';
}
