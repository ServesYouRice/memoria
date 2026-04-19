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

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

function toSeconds(windowMs: number): number {
  return Math.ceil(windowMs / 1000);
}

type EdgeRateLimitEntry = {
  timestamps: number[];
};

const edgeRateLimitStore =
  (
    globalThis as typeof globalThis & {
      __memoriaEdgeRateLimitStore?: Map<string, EdgeRateLimitEntry>;
    }
  ).__memoriaEdgeRateLimitStore || new Map<string, EdgeRateLimitEntry>();

(
  globalThis as typeof globalThis & {
    __memoriaEdgeRateLimitStore?: Map<string, EdgeRateLimitEntry>;
  }
).__memoriaEdgeRateLimitStore = edgeRateLimitStore;

function getClientIdentifier(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
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

async function checkRateLimit(
  request: NextRequest,
  config: { maxRequests: number; windowSeconds: number; keyPrefix?: string },
) {
  const identifier = getClientIdentifier(request);
  const key = `${config.keyPrefix || "ratelimit"}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;
  const entry = edgeRateLimitStore.get(key) || { timestamps: [] };
  const validTimestamps = entry.timestamps.filter(
    (timestamp) => timestamp > windowStart,
  );

  if (validTimestamps.length >= config.maxRequests) {
    const oldestTimestamp = validTimestamps[0] || now;
    return {
      allowed: false,
      remaining: 0,
      resetAt: Math.ceil(
        (oldestTimestamp + config.windowSeconds * 1000) / 1000,
      ),
    };
  }

  validTimestamps.push(now);
  edgeRateLimitStore.set(key, { timestamps: validTimestamps });

  return {
    allowed: true,
    remaining: Math.max(0, config.maxRequests - validTimestamps.length),
    resetAt: Math.ceil((now + config.windowSeconds * 1000) / 1000),
  };
}

/**
 * Rate limiting middleware backed by shared rate limiter
 */
export function rateLimit(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyPrefix } = config;

  return async function checkRateLimitMiddleware(
    request: NextRequest,
  ): Promise<NextResponseType | null> {
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
