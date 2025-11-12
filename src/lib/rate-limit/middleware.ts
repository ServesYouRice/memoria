/**
 * Rate Limiting Middleware
 * Helper to apply rate limiting to API routes
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createRateLimiter, getClientIdentifier, RATE_LIMITS } from './index';
import type { RateLimitConfig } from './types';

/**
 * Rate limit error response
 */
function rateLimitExceeded(resetAt: number, remaining: number = 0) {
  return NextResponse.json(
    {
      type: 'https://canvascollect.com/errors/rate-limit-exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Rate limit exceeded. Please try again later.',
      extensions: {
        resetAt,
        remaining,
      },
    },
    {
      status: 429,
      headers: {
        'Retry-After': Math.ceil((resetAt - Date.now() / 1000)).toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': resetAt.toString(),
      },
    }
  );
}

/**
 * Apply rate limiting to a request handler
 *
 * @example
 * ```ts
 * export async function POST(request: Request) {
 *   const rateLimit = await checkRateLimit(request, RATE_LIMITS.auth);
 *   if (!rateLimit.allowed) {
 *     return rateLimitExceeded(rateLimit.resetAt, rateLimit.remaining);
 *   }
 *
 *   // Handle request...
 * }
 * ```
 */
export async function checkRateLimit(request: Request, config: RateLimitConfig) {
  const identifier = config.identifier
    ? await config.identifier(request)
    : getClientIdentifier(request);

  const limiter = createRateLimiter(config);
  const result = await limiter.check(identifier);

  logger.debug(
    {
      identifier,
      allowed: result.allowed,
      current: result.current,
      limit: result.limit,
      remaining: result.remaining,
    },
    'Rate limit check'
  );

  return result;
}

/**
 * Higher-order function to wrap API route handlers with rate limiting
 *
 * @example
 * ```ts
 * export const POST = withRateLimit(
 *   RATE_LIMITS.auth,
 *   async (request: Request) => {
 *     // Handle request...
 *     return NextResponse.json({ success: true });
 *   }
 * );
 * ```
 */
export function withRateLimit<T extends any[]>(
  config: RateLimitConfig,
  handler: (request: Request, ...args: T) => Promise<NextResponse>
) {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    const result = await checkRateLimit(request, config);

    // Add rate limit headers to response
    const addRateLimitHeaders = (response: NextResponse): NextResponse => {
      response.headers.set('X-RateLimit-Limit', result.limit.toString());
      response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
      response.headers.set('X-RateLimit-Reset', result.resetAt.toString());
      return response;
    };

    if (!result.allowed) {
      return rateLimitExceeded(result.resetAt, result.remaining);
    }

    try {
      const response = await handler(request, ...args);
      return addRateLimitHeaders(response);
    } catch (error) {
      // Re-throw error to be handled by global error handler
      throw error;
    }
  };
}

/**
 * Rate limit by user ID instead of IP
 * Useful for authenticated endpoints
 */
export async function checkRateLimitByUser(
  userId: string,
  config: Omit<RateLimitConfig, 'identifier'>
) {
  const fullConfig: RateLimitConfig = {
    ...config,
    identifier: async () => `user:${userId}`,
  };

  // Create temporary request object for identifier extraction
  const request = new Request('http://localhost');
  return checkRateLimit(request, fullConfig);
}

/**
 * Preset rate limiters for common use cases
 */
export const rateLimitPresets = {
  /**
   * Apply to general API endpoints
   */
  api: (handler: (request: Request, ...args: any[]) => Promise<NextResponse>) =>
    withRateLimit(RATE_LIMITS.api, handler),

  /**
   * Apply to authentication endpoints
   */
  auth: (handler: (request: Request, ...args: any[]) => Promise<NextResponse>) =>
    withRateLimit(RATE_LIMITS.auth, handler),

  /**
   * Apply to password reset endpoints
   */
  passwordReset: (handler: (request: Request, ...args: any[]) => Promise<NextResponse>) =>
    withRateLimit(RATE_LIMITS.passwordReset, handler),

  /**
   * Apply strict rate limiting
   */
  strict: (handler: (request: Request, ...args: any[]) => Promise<NextResponse>) =>
    withRateLimit(RATE_LIMITS.strict, handler),
};

export { rateLimitExceeded };
