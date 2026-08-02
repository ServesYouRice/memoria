/**
 * Redis Rate Limit Store
 * Production-ready store using Redis for distributed rate limiting
 *
 * Uses ioredis for Redis connection.
 * Falls back to throwing helpful errors if Redis is misconfigured.
 */

import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import type { RateLimitStore } from "../types";
import { getRedisClient } from "@/lib/cache/redis-client";

export interface RedisRateLimitStoreConfig {
  keyPrefix?: string;
}

export class RedisRateLimitStore implements RateLimitStore {
  private client: Redis;
  private keyPrefix: string;

  constructor(config: RedisRateLimitStoreConfig = {}) {
    this.keyPrefix = config.keyPrefix || "ratelimit:";

    const client = getRedisClient();
    if (!client)
      throw new Error("REDIS_URL is required for Redis rate limiting");
    this.client = client;
  }

  async increment(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttl: number }> {
    const fullKey = `${this.keyPrefix}${key}`;

    try {
      // Increment and attach/repair the TTL atomically so a process crash
      // cannot leave an immortal limiter key behind.
      const result = (await this.client.eval(
        `
          local count = redis.call("INCR", KEYS[1])
          local ttl = redis.call("TTL", KEYS[1])
          if count == 1 or ttl < 0 then
            redis.call("EXPIRE", KEYS[1], ARGV[1])
            ttl = tonumber(ARGV[1])
          end
          return {count, ttl}
        `,
        1,
        fullKey,
        windowSeconds,
      )) as [number, number];
      const [count, ttl] = result;

      return { count, ttl };
    } catch (error) {
      logger.error({ error, key }, "Redis increment failed");
      throw error;
    }
  }

  async get(key: string): Promise<number | null> {
    const fullKey = `${this.keyPrefix}${key}`;

    try {
      const value = await this.client.get(fullKey);
      return value ? parseInt(value, 10) : null;
    } catch (error) {
      logger.error({ error, key }, "Redis get failed");
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;

    try {
      await this.client.del(fullKey);
    } catch (error) {
      logger.error({ error, key }, "Redis delete failed");
      throw error;
    }
  }

  async close(): Promise<void> {
    // The process-wide Redis client is owned by redis-client.ts.
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }
}
