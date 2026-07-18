/**
 * Rate Limiting Middleware
 *
 * Provides middleware and helper functions for applying rate limiting to API routes.
 * Supports both IP-based and user-based rate limiting with automatic header management.
 *
 * @module lib/rate-limit/middleware
 *
 * @example
 * ```typescript
 * // Simple rate limit check in API route
 * export async function POST(request: Request) {
 *   const rateLimit = await checkRateLimit(request, RATE_LIMITS.auth);
 *   if (!rateLimit.allowed) {
 *     return rateLimitExceeded(rateLimit.resetAt, rateLimit.remaining);
 *   }
 *   // Handle request...
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Higher-order function wrapper
 * export const POST = withRateLimit(
 *   RATE_LIMITS.auth,
 *   async (request: Request) => {
 *     return NextResponse.json({ success: true });
 *   }
 * );
 * ```
 *
 * @example
 * ```typescript
 * // User-based rate limiting
 * const result = await checkRateLimitByUser(userId, {
 *   maxRequests: 10,
 *   windowSeconds: 60
 * });
 * ```
 *
 * @see {@link RateLimitConfig} for configuration options
 * @see {@link RATE_LIMITS} for preset configurations
 */

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { createRateLimiter, getClientIdentifier, RATE_LIMITS } from "./index";
import type { RateLimitConfig } from "./types";

/**
 * Create a 429 Too Many Requests error response
 *
 * Returns a properly formatted error response with rate limit headers
 * following RFC 6585 and best practices.
 *
 * @param resetAt - Unix timestamp (in seconds) when the rate limit resets
 * @param remaining - Number of requests remaining (typically 0 when exceeded)
 * @returns NextResponse with 429 status and rate limit headers
 *
 * @example
 * ```typescript
 * if (!rateLimit.allowed) {
 *   return rateLimitExceeded(rateLimit.resetAt, rateLimit.remaining);
 * }
 * ```
 */
function rateLimitExceeded(resetAt: number, remaining: number = 0) {
  return NextResponse.json(
    {
      type: "https://memoria.local/errors/rate-limit-exceeded",
      title: "Too Many Requests",
      status: 429,
      detail: "Rate limit exceeded. Please try again later.",
      extensions: {
        resetAt,
        remaining,
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": Math.ceil(resetAt - Date.now() / 1000).toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": resetAt.toString(),
      },
    },
  );
}

/**
 * Check rate limit for a request
 *
 * Performs a rate limit check based on client identifier (IP address by default,
 * or custom identifier from config). Returns rate limit status including whether
 * the request is allowed and when the limit resets.
 *
 * @param request - The incoming request object
 * @param config - Rate limit configuration
 * @returns Promise resolving to rate limit result
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const rateLimit = await checkRateLimit(request, RATE_LIMITS.auth);
 *   if (!rateLimit.allowed) {
 *     return rateLimitExceeded(rateLimit.resetAt, rateLimit.remaining);
 *   }
 *   // Handle request...
 * }
 * ```
 */
export async function checkRateLimit(
  request: Request,
  config: RateLimitConfig,
) {
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
    "Rate limit check",
  );

  return result;
}

/**
 * Higher-order function to wrap API route handlers with rate limiting
 *
 * Wraps an API route handler with automatic rate limit checking and header management.
 * If rate limit is exceeded, returns 429 response. Otherwise, calls the handler and
 * adds rate limit headers to the response.
 *
 * @param config - Rate limit configuration (or use RATE_LIMITS presets)
 * @param handler - The API route handler function to wrap
 * @returns Wrapped handler with rate limiting applied
 *
 * @example
 * ```typescript
 * export const POST = withRateLimit(
 *   RATE_LIMITS.auth,
 *   async (request: Request) => {
 *     // Handle request...
 *     return NextResponse.json({ success: true });
 *   }
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Custom configuration
 * export const POST = withRateLimit(
 *   { maxRequests: 50, windowSeconds: 300 },
 *   async (request: Request) => {
 *     return NextResponse.json({ data: 'expensive operation' });
 *   }
 * );
 * ```
 */
export function withRateLimit<T extends any[]>(
  config: RateLimitConfig,
  handler: (request: Request, ...args: T) => Promise<NextResponse>,
) {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    const result = await checkRateLimit(request, config);

    // Add rate limit headers to response
    const addRateLimitHeaders = (response: NextResponse): NextResponse => {
      response.headers.set("X-RateLimit-Limit", result.limit.toString());
      response.headers.set(
        "X-RateLimit-Remaining",
        result.remaining.toString(),
      );
      response.headers.set("X-RateLimit-Reset", result.resetAt.toString());
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
 * Check rate limit by user ID instead of IP address
 *
 * Useful for authenticated endpoints where you want to rate limit per user
 * rather than per IP. This prevents users from bypassing limits by switching IPs.
 *
 * @param userId - The user's unique identifier
 * @param config - Rate limit configuration (without identifier function)
 * @returns Promise resolving to rate limit result
 *
 * @example
 * ```typescript
 * const session = await getServerSession(authOptions);
 * if (session?.user?.id) {
 *   const result = await checkRateLimitByUser(session.user.id, {
 *     maxRequests: 100,
 *     windowSeconds: 3600
 *   });
 *   if (!result.allowed) {
 *     return rateLimitExceeded(result.resetAt, result.remaining);
 *   }
 * }
 * ```
 */
export async function checkRateLimitByUser(
  userId: string,
  config: Omit<RateLimitConfig, "identifier">,
) {
  const fullConfig: RateLimitConfig = {
    ...config,
    identifier: async () => `user:${userId}`,
  };

  // Create temporary request object for identifier extraction
  const request = new Request("http://localhost");
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
  auth: (
    handler: (request: Request, ...args: any[]) => Promise<NextResponse>,
  ) => withRateLimit(RATE_LIMITS.auth, handler),

  /**
   * Apply to password reset endpoints
   */
  passwordReset: (
    handler: (request: Request, ...args: any[]) => Promise<NextResponse>,
  ) => withRateLimit(RATE_LIMITS.passwordReset, handler),

  /**
   * Apply strict rate limiting
   */
  strict: (
    handler: (request: Request, ...args: any[]) => Promise<NextResponse>,
  ) => withRateLimit(RATE_LIMITS.strict, handler),
};

export { rateLimitExceeded };
