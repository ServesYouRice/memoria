import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  API_RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_MAX_REQUESTS,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX_REQUESTS,
} from '@/lib/constants';

const logger = createLogger('rate-limit');

// In-memory store for rate limiting (DEVELOPMENT ONLY - use Redis in production)
// This implementation is NOT suitable for:
// - Production deployments
// - Serverless/Edge environments (Vercel, AWS Lambda)
// - Multi-instance deployments
// See CODE_AUDIT_REPORT.md Issue #5 for Redis implementation
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Lazy cleanup of expired entries
 * Called on each rate limit check to avoid memory leaks in serverless
 *
 * IMPORTANT: This replaces the previous setInterval approach which caused
 * memory leaks in serverless environments (Issue #2)
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach(key => rateLimitStore.delete(key));

  if (keysToDelete.length > 0) {
    logger.debug({ cleaned: keysToDelete.length }, 'Cleaned up expired rate limit entries');
  }
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

/**
 * Rate limiting middleware
 *
 * DEVELOPMENT ONLY: This in-memory implementation is suitable for development only.
 * For production, use Redis-based rate limiting (see below for implementation)
 *
 * Production alternatives:
 * 1. Upstash Redis: https://upstash.com/
 * 2. Vercel Edge Config: https://vercel.com/docs/storage/edge-config
 * 3. Redis Cloud: https://redis.com/
 */
export function rateLimit(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyPrefix = 'rl' } = config;

  return function checkRateLimit(request: NextRequest): NextResponse | null {
    // Cleanup expired entries (lazy cleanup to avoid memory leaks)
    cleanupExpiredEntries();

    // Get identifier (IP or user ID)
    const identifier =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

    const key = keyPrefix + ':' + identifier;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      // Create new entry
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };
      rateLimitStore.set(key, entry);
      return null; // Allow request
    }

    if (entry.count >= maxRequests) {
      logger.warn({ identifier, key }, 'Rate limit exceeded');
      return NextResponse.json(
        {
          error: 'Too many requests',
          retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        },
        { status: 429 }
      );
    }

    entry.count++;
    return null; // Allow request
  };
}

/**
 * Endpoint-specific rate limits
 */
export const authRateLimit = rateLimit({
  maxRequests: AUTH_RATE_LIMIT_MAX_REQUESTS,
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  keyPrefix: 'auth',
});

export const apiRateLimit = rateLimit({
  maxRequests: API_RATE_LIMIT_MAX_REQUESTS,
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  keyPrefix: 'api',
});

/*
 * ============================================================================
 * PRODUCTION-READY REDIS IMPLEMENTATION (Recommended for Production)
 * ============================================================================
 *
 * To migrate to Redis-based rate limiting, follow these steps:
 *
 * 1. Install dependencies:
 *    pnpm add @upstash/redis @upstash/ratelimit
 *
 * 2. Add environment variables to .env:
 *    UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
 *    UPSTASH_REDIS_REST_TOKEN=your_token_here
 *
 * 3. Replace this file with the implementation below:
 *
 * ```typescript
 * import { Ratelimit } from '@upstash/ratelimit';
 * import { Redis } from '@upstash/redis';
 * import { NextRequest, NextResponse } from 'next/server';
 *
 * // Initialize Redis client
 * const redis = new Redis({
 *   url: process.env.UPSTASH_REDIS_REST_URL!,
 *   token: process.env.UPSTASH_REDIS_REST_TOKEN!,
 * });
 *
 * // Create rate limiters
 * const authRateLimiter = new Ratelimit({
 *   redis,
 *   limiter: Ratelimit.slidingWindow(5, '15 m'), // 5 requests per 15 minutes
 *   analytics: true,
 *   prefix: 'auth',
 * });
 *
 * const apiRateLimiter = new Ratelimit({
 *   redis,
 *   limiter: Ratelimit.slidingWindow(100, '15 m'), // 100 requests per 15 minutes
 *   analytics: true,
 *   prefix: 'api',
 * });
 *
 * // Middleware function
 * export async function checkRateLimit(
 *   request: NextRequest,
 *   limiter: Ratelimit
 * ): Promise<NextResponse | null> {
 *   const identifier =
 *     request.headers.get('x-forwarded-for') ||
 *     request.headers.get('x-real-ip') ||
 *     'unknown';
 *
 *   const { success, limit, remaining, reset } = await limiter.limit(identifier);
 *
 *   if (!success) {
 *     return NextResponse.json(
 *       {
 *         error: 'Too many requests',
 *         retryAfter: Math.ceil((reset - Date.now()) / 1000),
 *       },
 *       {
 *         status: 429,
 *         headers: {
 *           'X-RateLimit-Limit': limit.toString(),
 *           'X-RateLimit-Remaining': remaining.toString(),
 *           'X-RateLimit-Reset': reset.toString(),
 *         },
 *       }
 *     );
 *   }
 *
 *   return null; // Allow request
 * }
 *
 * // Export rate limit functions
 * export const authRateLimit = (request: NextRequest) =>
 *   checkRateLimit(request, authRateLimiter);
 *
 * export const apiRateLimit = (request: NextRequest) =>
 *   checkRateLimit(request, apiRateLimiter);
 * ```
 *
 * Benefits of Redis-based rate limiting:
 * - ✅ Works across multiple server instances
 * - ✅ Persists across deployments
 * - ✅ No memory leaks in serverless
 * - ✅ Accurate rate limiting in distributed systems
 * - ✅ Built-in analytics and monitoring
 * - ✅ Sliding window algorithm for better accuracy
 *
 * See: https://upstash.com/docs/oss/sdks/ts/ratelimit/overview
 */
