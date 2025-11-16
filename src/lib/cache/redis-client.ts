/**
 * Redis Client Configuration
 * Following ADR-0011: Server-Side Caching Strategy
 */

import Redis from 'ioredis';

let redis: Redis | null = null;

/**
 * Get Redis client instance
 * Lazy initialization - only creates connection when needed
 */
export function getRedisClient(): Redis | null {
  // Check if Redis is enabled
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('Redis URL not configured, caching disabled');
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
      console.error('Redis connection error:', error);
    });

    redis.on('connect', () => {
      console.log('Redis connected successfully');
    });

    return redis;
  } catch (error) {
    console.error('Failed to initialize Redis client:', error);
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
