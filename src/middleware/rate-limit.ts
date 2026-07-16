import {
  NextResponse,
  type NextRequest,
  type NextResponse as NextResponseType,
} from "next/server";
import {
  API_RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_MAX_REQUESTS,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX_REQUESTS,
} from "@/lib/constants";
import { createRateLimiter } from "@/lib/rate-limit";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

function toSeconds(windowMs: number): number {
  return Math.ceil(windowMs / 1000);
}

function getClientIdentifier(request: NextRequest): string {
  // server.ts overwrites this header from req.socket.remoteAddress. Do not
  // fall back to caller-controlled forwarding headers.
  return request.headers.get("x-memoria-client-ip") || "unknown";
}

function rateLimitExceeded(resetAt: number, remaining: number = 0) {
  return NextResponse.json(
    {
      type: "https://canvascollect.com/errors/rate-limit-exceeded",
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
        "Retry-After": Math.max(
          0,
          Math.ceil(resetAt - Date.now() / 1000),
        ).toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": resetAt.toString(),
      },
    },
  );
}

/**
 * Rate limiting middleware backed by the shared Redis store in production
 * and the bounded, expiring memory store in development/test.
 */
export function rateLimit(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyPrefix } = config;
  const limiter = createRateLimiter({
    maxRequests,
    windowSeconds: toSeconds(windowMs),
    keyPrefix,
  });

  return async function checkRateLimitMiddleware(
    request: NextRequest,
  ): Promise<NextResponseType | null> {
    const result = await limiter.check(getClientIdentifier(request));

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
  keyPrefix: "auth",
});

export const apiRateLimit = rateLimit({
  maxRequests: API_RATE_LIMIT_MAX_REQUESTS,
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  keyPrefix: "api",
});

export const uploadRateLimit = rateLimit({
  maxRequests: 10, // 10 uploads per hour
  windowMs: 60 * 60 * 1000,
  keyPrefix: "upload",
});

export const canvasesRateLimit = rateLimit({
  maxRequests: 50,
  windowMs: 60 * 1000,
  keyPrefix: "canvases",
});

export const itemsRateLimit = rateLimit({
  maxRequests: 200,
  windowMs: 60 * 1000,
  keyPrefix: "items",
});

export const agentRateLimit = rateLimit({
  maxRequests: 60,
  windowMs: 60 * 1000,
  keyPrefix: "agent",
});

export const sensitiveEndpointRateLimit = rateLimit({
  maxRequests: 20,
  windowMs: 60 * 1000,
  keyPrefix: "sensitive",
});
