/**
 * Rate Limiting Service
 * Provides request rate limiting using sliding window algorithm
 * Following ADR pattern for service abstraction
 */

import { logger } from '@/lib/logger';
import type { RateLimiter, RateLimitConfig, RateLimitResult, RateLimitStore } from './types';
import { MemoryRateLimitStore } from './stores/memory';
import { RedisRateLimitStore } from './stores/redis';

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
      const { count, ttl } = await this.store.increment(key, this.config.windowSeconds);

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
        logger.warn({ identifier, count, limit: this.config.maxRequests }, 'Rate limit exceeded');
      }

      return result;
    } catch (error) {
      logger.error({ error, identifier }, 'Rate limit check failed');

      // Fail open - allow request on error
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

  async reset(identifier: string): Promise<void> {
    const key = this.getKey(identifier);
    await this.store.delete(key);
    logger.info({ identifier }, 'Rate limit reset');
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
      logger.error({ error, identifier }, 'Rate limit status check failed');

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
    const prefix = this.config.keyPrefix || 'ratelimit';
    return `${prefix}:${identifier}`;
  }
}

/**
 * Create rate limiter based on environment configuration
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const useRedis = process.env.REDIS_URL || process.env.REDIS_HOST;

  let store: RateLimitStore;

  if (useRedis) {
    logger.info('Using Redis for rate limiting');

    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      keyPrefix: 'ratelimit:',
    };

    try {
      store = new RedisRateLimitStore(redisConfig);
    } catch (error) {
      logger.warn({ error }, 'Failed to create Redis store, falling back to memory');
      store = new MemoryRateLimitStore();
    }
  } else {
    logger.info('Using in-memory rate limiting (development mode)');
    store = new MemoryRateLimitStore();
  }

  return new SlidingWindowRateLimiter(store, config);
}

/**
 * Get client identifier from request
 * Uses IP address with X-Forwarded-For support
 */
export function getClientIdentifier(request: Request): string {
  // Check for forwarded IP (from proxy/load balancer)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take first IP if multiple
    return forwardedFor.split(',')[0].trim();
  }

  // Check for real IP header
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback - this may not work in all environments
  return 'unknown';
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
