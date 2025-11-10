import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rate-limit');

// In-memory store for rate limiting (use Redis in production)
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  },
  5 * 60 * 1000
);

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

/**
 * Rate limiting middleware
 * In production, this should be replaced with a Redis-based solution
 */
export function rateLimit(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyPrefix = 'rl' } = config;

  return function checkRateLimit(request: NextRequest): NextResponse | null {
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
  maxRequests: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyPrefix: 'auth',
});

export const apiRateLimit = rateLimit({
  maxRequests: 100,
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyPrefix: 'api',
});
