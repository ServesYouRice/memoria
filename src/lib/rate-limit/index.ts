/**
 * Rate Limiting Module
 *
 * Provides distributed rate limiting with Redis support and memory fallback.
 * Uses sliding window algorithm for accurate request counting.
 *
 * @module lib/rate-limit
 *
 * @example
 * ```typescript
 * // Create a rate limiter
 * const limiter = createRateLimiter({
 *   maxRequests: 100,
 *   windowSeconds: 60
 * });
 *
 * // Check rate limit
 * const result = await limiter.check('user-123');
 * if (!result.allowed) {
 *   throw new Error('Rate limit exceeded');
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Use preset configurations
 * import { RATE_LIMITS } from '@/lib/rate-limit';
 *
 * const limiter = createRateLimiter(RATE_LIMITS.auth);
 * // 5 requests per minute for auth endpoints
 * ```
 *
 * ## Configuration
 *
 * Set `REDIS_URL` to use the process-wide Redis client. Development without
 * Redis uses the in-memory store; production configuration validation requires
 * Redis.
 *
 * ## Preset Rate Limits
 *
 * - `RATE_LIMITS.api`: 100 requests/minute (general API)
 * - `RATE_LIMITS.auth`: 5 requests/minute (authentication)
 * - `RATE_LIMITS.passwordReset`: 3 requests/hour (password reset)
 * - `RATE_LIMITS.strict`: 10 requests/minute (expensive operations)
 *
 * @see {@link RateLimiter} for rate limiter interface
 * @see {@link RateLimitConfig} for configuration options
 * @see {@link RateLimitResult} for check result format
 */

import { logger } from "@/lib/logger";
import type {
  RateLimiter,
  RateLimitConfig,
  RateLimitResult,
  RateLimitStore,
} from "./types";
import { MemoryRateLimitStore } from "./stores/memory";
import { RedisRateLimitStore } from "./stores/redis";
import { incrementOperationalCounter } from "@/lib/operations/runtime-metrics";

let sharedStore: RateLimitStore | null = null;
const limiterCache = new Map<string, RateLimiter>();

/**
 * Sliding Window Rate Limiter
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private store: RateLimitStore;
  private config: RateLimitConfig;

  constructor(store: RateLimitStore, config: RateLimitConfig) {
    this.store = store;
    this.config = config;
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const key = this.getKey(identifier);
    const now = Date.now();

    try {
      const { count, ttl } = await this.store.increment(
        key,
        this.config.windowSeconds,
      );

      const resetAt = Math.floor(now / 1000) + ttl;
      const remaining = Math.max(0, this.config.maxRequests - count);
      const allowed = count <= this.config.maxRequests;

      const result: RateLimitResult = {
        allowed,
        current: count,
        limit: this.config.maxRequests,
        remaining,
        resetAt,
        resetIn: ttl,
      };

      if (!allowed) {
        logger.warn(
          { identifier, count, limit: this.config.maxRequests },
          "Rate limit exceeded",
        );
      }

      return result;
    } catch (error) {
      incrementOperationalCounter("redis_safety_failures_total");
      logger.error({ error, identifier }, "Rate limit check failed");

      // Production requires Redis. If that shared abuse control is unavailable,
      // fail closed rather than silently removing the protection.
      const failClosed = process.env.NODE_ENV === "production";
      return {
        allowed: !failClosed,
        current: 0,
        limit: this.config.maxRequests,
        remaining: failClosed ? 0 : this.config.maxRequests,
        resetAt: Math.floor(now / 1000) + this.config.windowSeconds,
        resetIn: this.config.windowSeconds,
      };
    }
  }

  async reset(identifier: string): Promise<void> {
    const key = this.getKey(identifier);
    await this.store.delete(key);
    logger.info({ identifier }, "Rate limit reset");
  }

  async status(identifier: string): Promise<RateLimitResult> {
    const key = this.getKey(identifier);
    const now = Date.now();

    try {
      const count = (await this.store.get(key)) || 0;
      const remaining = Math.max(0, this.config.maxRequests - count);

      return {
        allowed: count < this.config.maxRequests,
        current: count,
        limit: this.config.maxRequests,
        remaining,
        resetAt: Math.floor(now / 1000) + this.config.windowSeconds,
        resetIn: this.config.windowSeconds,
      };
    } catch (error) {
      logger.error({ error, identifier }, "Rate limit status check failed");

      return {
        allowed: true,
        current: 0,
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests,
        resetAt: Math.floor(now / 1000) + this.config.windowSeconds,
        resetIn: this.config.windowSeconds,
      };
    }
  }

  private getKey(identifier: string): string {
    const prefix = this.config.keyPrefix || "ratelimit";
    return `${prefix}:${identifier}`;
  }
}

/**
 * Create rate limiter based on environment configuration
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const cacheKey = JSON.stringify({
    maxRequests: config.maxRequests,
    windowSeconds: config.windowSeconds,
    keyPrefix: config.keyPrefix || "",
  });

  const existingLimiter = limiterCache.get(cacheKey);
  if (existingLimiter) {
    return existingLimiter;
  }

  const useRedis = process.env.REDIS_URL;

  let store = sharedStore;

  if (!store && useRedis) {
    logger.info("Using Redis for rate limiting");

    try {
      store = new RedisRateLimitStore({ keyPrefix: "ratelimit:" });
    } catch (error) {
      logger.warn(
        { error },
        "Failed to create Redis store, falling back to memory",
      );
      store = new MemoryRateLimitStore();
    }
  } else if (!store) {
    logger.info("Using in-memory rate limiting (development mode)");
    store = new MemoryRateLimitStore();
  }

  sharedStore = store;

  const limiter = new SlidingWindowRateLimiter(store, config);
  limiterCache.set(cacheKey, limiter);
  return limiter;
}

/**
 * Get client identifier from request
 * Uses IP address with X-Forwarded-For support
 */
export function getClientIdentifier(request: Request): string {
  // server.ts overwrites this from the TCP peer. Forwarding headers remain
  // untrusted because the reference deployment is directly reachable.
  return request.headers.get("x-memoria-client-ip") || "unknown";
}

/**
 * Default rate limit configurations for different endpoints
 */
export const RATE_LIMITS = {
  /**
   * General API endpoints
   * 100 requests per minute
   */
  api: {
    maxRequests: 100,
    windowSeconds: 60,
  },

  /**
   * Authentication endpoints (login, signup)
   * 5 requests per minute to prevent brute force
   */
  auth: {
    maxRequests: 5,
    windowSeconds: 60,
  },

  /**
   * Password reset endpoints
   * 3 requests per hour per IP
   */
  passwordReset: {
    maxRequests: 3,
    windowSeconds: 3600,
  },

  /**
   * Strict limit for expensive operations
   * 10 requests per minute
   */
  strict: {
    maxRequests: 10,
    windowSeconds: 60,
  },
} as const;

// Export types
export type { RateLimiter, RateLimitConfig, RateLimitResult, RateLimitStore };
