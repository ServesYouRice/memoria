import { type NextRequest, type NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitExceeded,
} from '@/lib/rate-limit/middleware';
import {
  API_RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_MAX_REQUESTS,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX_REQUESTS,
} from '@/lib/constants';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

function toSeconds(windowMs: number): number {
  return Math.ceil(windowMs / 1000);
}

/**
 * Rate limiting middleware backed by shared rate limiter
 */
export function rateLimit(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyPrefix } = config;

  return async function checkRateLimitMiddleware(request: NextRequest): Promise<NextResponse | null> {
    const result = await checkRateLimit(request, {
      maxRequests,
      windowSeconds: toSeconds(windowMs),
      ...(keyPrefix ? { keyPrefix } : {}),
    });

    if (!result.allowed) {
      return rateLimitExceeded(result.resetAt, result.remaining);
    }

    return null;
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

export const uploadRateLimit = rateLimit({
  maxRequests: 10, // 10 uploads per hour
  windowMs: 60 * 60 * 1000,
  keyPrefix: 'upload',
});

export const canvasesRateLimit = rateLimit({
  maxRequests: 50,
  windowMs: 60 * 1000,
  keyPrefix: 'canvases',
});

export const itemsRateLimit = rateLimit({
  maxRequests: 200,
  windowMs: 60 * 1000,
  keyPrefix: 'items',
});
