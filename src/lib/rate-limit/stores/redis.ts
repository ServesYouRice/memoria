/**
 * Redis Rate Limit Store
 * Production-ready store using Redis for distributed rate limiting
 *
 * Uses ioredis for Redis connection.
 * Falls back to throwing helpful errors if Redis is misconfigured.
 */

import Redis from 'ioredis';
import { logger } from '@/lib/logger';
import type { RateLimitStore } from '../types';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
}

export class RedisRateLimitStore implements RateLimitStore {
  private client: Redis;
  private keyPrefix: string;

  constructor(config: RedisConfig) {
    this.keyPrefix = config.keyPrefix || 'ratelimit:';

    // Support REDIS_URL or individual config
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });
    } else {
      this.client = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db || 0,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });
    }

    this.client.on('error', (err) => {
      logger.error({ error: err }, 'Redis rate limit store error');
    });

    this.client.on('connect', () => {
      logger.info('Redis rate limit store connected');
    });
  }

  async increment(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    const fullKey = `${this.keyPrefix}${key}`;

    try {
      // Use MULTI/EXEC for atomic increment and TTL check
      const pipeline = this.client.multi();
      pipeline.incr(fullKey);
      pipeline.ttl(fullKey);
      const results = await pipeline.exec();

      if (!results) {
        throw new Error('Redis pipeline returned null');
      }

      const count = results[0]?.[1] as number;
      let ttl = results[1]?.[1] as number;

      // If key is new (no TTL), set expiration
      if (ttl === -1) {
        await this.client.expire(fullKey, windowSeconds);
        ttl = windowSeconds;
      }

      return { count, ttl };
    } catch (error) {
      logger.error({ error, key }, 'Redis increment failed');
      throw error;
    }
  }

  async get(key: string): Promise<number | null> {
    const fullKey = `${this.keyPrefix}${key}`;

    try {
      const value = await this.client.get(fullKey);
      return value ? parseInt(value, 10) : null;
    } catch (error) {
      logger.error({ error, key }, 'Redis get failed');
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;

    try {
      await this.client.del(fullKey);
    } catch (error) {
      logger.error({ error, key }, 'Redis delete failed');
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
