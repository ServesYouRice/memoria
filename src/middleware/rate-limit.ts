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
  UPLOAD_RATE_LIMIT_WINDOW_MS,
  UPLOAD_RATE_LIMIT_MAX_REQUESTS,
  API_IP_RATE_LIMIT_MAX_REQUESTS,
  API_USER_RATE_LIMIT_MAX_REQUESTS,
  ASSET_IP_RATE_LIMIT_MAX_REQUESTS,
  ASSET_USER_RATE_LIMIT_MAX_REQUESTS,
  NOTIFICATIONS_IP_RATE_LIMIT_MAX_REQUESTS,
  NOTIFICATIONS_USER_RATE_LIMIT_MAX_REQUESTS,
  SEARCH_IP_RATE_LIMIT_MAX_REQUESTS,
  SEARCH_USER_RATE_LIMIT_MAX_REQUESTS,
  CANVASES_USER_RATE_LIMIT_MAX_REQUESTS,
  ITEMS_USER_RATE_LIMIT_MAX_REQUESTS,
} from "@/lib/constants";
import { createHash } from "node:crypto";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  AUTH_RATE_LIMIT_GROUPS,
  type AuthRateLimitGroup,
} from "./auth-rate-limit";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

function toSeconds(windowMs: number): number {
  return Math.ceil(windowMs / 1000);
}

function configuredMaxRequests(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function getClientIdentifier(request: NextRequest): string {
  // server.ts overwrites this header from req.socket.remoteAddress. Do not
  // fall back to caller-controlled forwarding headers.
  return request.headers.get("x-memoria-client-ip") || "unknown";
}

const SESSION_COOKIE_NAMES = [
  "memoria.session_token",
  "__Secure-memoria.session_token",
];

/**
 * Derive a per-user bucket key from the Better Auth session cookie.
 *
 * The proxy does not hit the database, so the cookie is not verified here: a
 * forged or rotated cookie only earns a fresh per-user bucket and is still
 * counted against the per-IP budget, which is always applied as well. The raw
 * token is hashed so it never lands in Redis keys.
 */
export function getSessionBucket(request: NextRequest): string | null {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = request.cookies.get(name)?.value;
    if (!value) continue;
    const token = value.split(".")[0];
    if (token.length < 8 || token.length > 512) continue;
    return createHash("sha256").update(token).digest("hex").slice(0, 32);
  }
  return null;
}

export function hasSessionCookie(request: NextRequest): boolean {
  return getSessionBucket(request) !== null;
}

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
 * Like `rateLimit`, but keyed by the caller's session instead of the IP.
 * Requests without a session cookie are not counted here (the per-IP budget
 * is their only limit).
 */
export function userRateLimit(config: RateLimitConfig) {
  const { maxRequests, windowMs, keyPrefix } = config;
  const limiter = createRateLimiter({
    maxRequests,
    windowSeconds: toSeconds(windowMs),
    keyPrefix,
  });

  return async function checkUserRateLimitMiddleware(
    request: NextRequest,
  ): Promise<NextResponseType | null> {
    const bucket = getSessionBucket(request);
    if (!bucket) return null;
    const result = await limiter.check(bucket);
    if (!result.allowed) {
      return rateLimitExceeded(result.resetAt, result.remaining);
    }
    return null;
  };
}

/**
 * Endpoint-specific rate limits
 */
/**
 * One per-IP bucket per strict auth route group (keyPrefix `auth-<group>`).
 * Each group reads `AUTH_<GROUP>_RATE_LIMIT_MAX_REQUESTS` and falls back to
 * AUTH_RATE_LIMIT_MAX_REQUESTS, so existing deployments keep their budget.
 */
const defaultAuthMaxRequests = configuredMaxRequests(
  "AUTH_RATE_LIMIT_MAX_REQUESTS",
  AUTH_RATE_LIMIT_MAX_REQUESTS,
);

export const authGroupRateLimits = Object.fromEntries(
  AUTH_RATE_LIMIT_GROUPS.map((group) => [
    group,
    rateLimit({
      maxRequests: configuredMaxRequests(
        `AUTH_${group.toUpperCase().replace(/-/g, "_")}_RATE_LIMIT_MAX_REQUESTS`,
        defaultAuthMaxRequests,
      ),
      windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      keyPrefix: `auth-${group}`,
    }),
  ]),
) as Record<
  AuthRateLimitGroup,
  (request: NextRequest) => Promise<NextResponseType | null>
>;

export const apiRateLimit = rateLimit({
  maxRequests: configuredMaxRequests(
    "API_RATE_LIMIT_MAX_REQUESTS",
    API_RATE_LIMIT_MAX_REQUESTS,
  ),
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  keyPrefix: "api",
});

export const uploadRateLimit = rateLimit({
  maxRequests: configuredMaxRequests(
    "UPLOAD_RATE_LIMIT_MAX_REQUESTS",
    UPLOAD_RATE_LIMIT_MAX_REQUESTS,
  ),
  windowMs: UPLOAD_RATE_LIMIT_WINDOW_MS,
  keyPrefix: "upload",
});

export const canvasesRateLimit = rateLimit({
  maxRequests: configuredMaxRequests("CANVASES_RATE_LIMIT_MAX_REQUESTS", 50),
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

/**
 * Browsers post CSP violation reports on their own, so they get a bucket of
 * their own and cannot spend the OAuth/setup budget above.
 */
export const cspReportRateLimit = rateLimit({
  maxRequests: configuredMaxRequests("CSP_REPORT_RATE_LIMIT_MAX_REQUESTS", 20),
  windowMs: 60 * 1000,
  keyPrefix: "csp-report",
});

const MINUTE_MS = 60 * 1000;

/**
 * Anonymous-or-unverified callers keep the strict general API budget
 * (`apiRateLimit`). Requests that carry a session cookie are limited per user
 * and against a larger shared-NAT-friendly per-IP ceiling instead.
 */
export const apiSessionIpRateLimit = rateLimit({
  maxRequests: configuredMaxRequests(
    "API_IP_RATE_LIMIT_MAX_REQUESTS",
    API_IP_RATE_LIMIT_MAX_REQUESTS,
  ),
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  keyPrefix: "api-session-ip",
});

export const apiUserRateLimit = userRateLimit({
  maxRequests: configuredMaxRequests(
    "API_USER_RATE_LIMIT_MAX_REQUESTS",
    API_USER_RATE_LIMIT_MAX_REQUESTS,
  ),
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  keyPrefix: "api-user",
});

/** Asset GETs: one request per image on a canvas. */
export const assetIpRateLimit = rateLimit({
  maxRequests: ASSET_IP_RATE_LIMIT_MAX_REQUESTS,
  windowMs: MINUTE_MS,
  keyPrefix: "asset-ip",
});
export const assetUserRateLimit = userRateLimit({
  maxRequests: ASSET_USER_RATE_LIMIT_MAX_REQUESTS,
  windowMs: MINUTE_MS,
  keyPrefix: "asset-user",
});

/** Unread-notification poll (30s per open tab) and notification list. */
export const notificationsIpRateLimit = rateLimit({
  maxRequests: NOTIFICATIONS_IP_RATE_LIMIT_MAX_REQUESTS,
  windowMs: MINUTE_MS,
  keyPrefix: "notifications-ip",
});
export const notificationsUserRateLimit = userRateLimit({
  maxRequests: NOTIFICATIONS_USER_RATE_LIMIT_MAX_REQUESTS,
  windowMs: MINUTE_MS,
  keyPrefix: "notifications-user",
});

export const searchIpRateLimit = rateLimit({
  maxRequests: SEARCH_IP_RATE_LIMIT_MAX_REQUESTS,
  windowMs: MINUTE_MS,
  keyPrefix: "search-ip",
});
export const searchUserRateLimit = userRateLimit({
  maxRequests: SEARCH_USER_RATE_LIMIT_MAX_REQUESTS,
  windowMs: MINUTE_MS,
  keyPrefix: "search-user",
});

export const canvasesUserRateLimit = userRateLimit({
  maxRequests: CANVASES_USER_RATE_LIMIT_MAX_REQUESTS,
  windowMs: MINUTE_MS,
  keyPrefix: "canvases-user",
});
export const itemsUserRateLimit = userRateLimit({
  maxRequests: ITEMS_USER_RATE_LIMIT_MAX_REQUESTS,
  windowMs: MINUTE_MS,
  keyPrefix: "items-user",
});

/**
 * Per-IP ceilings for session-bearing canvas and item requests. They default
 * to twice the per-user budgets so one user can spend their whole budget and
 * a shared NAT has room for more; anonymous callers keep the smaller
 * `canvasesRateLimit` / `itemsRateLimit`. A forged or rotated cookie is still
 * bounded here.
 */
export const canvasesSessionIpRateLimit = rateLimit({
  maxRequests: configuredMaxRequests(
    "CANVASES_SESSION_IP_RATE_LIMIT_MAX_REQUESTS",
    2 * CANVASES_USER_RATE_LIMIT_MAX_REQUESTS,
  ),
  windowMs: MINUTE_MS,
  keyPrefix: "canvases-session-ip",
});
export const itemsSessionIpRateLimit = rateLimit({
  maxRequests: configuredMaxRequests(
    "ITEMS_SESSION_IP_RATE_LIMIT_MAX_REQUESTS",
    2 * ITEMS_USER_RATE_LIMIT_MAX_REQUESTS,
  ),
  windowMs: MINUTE_MS,
  keyPrefix: "items-session-ip",
});

export type ReadBudget = "assets" | "notifications" | "search";

/**
 * Safe reads that get their own budget instead of the general API one.
 * Matching is exact so sub-routes (e.g. notification preferences) and
 * writes keep the general budget.
 */
export function classifyReadBudget(
  pathname: string,
  method: string,
): ReadBudget | null {
  if (method !== "GET") return null;
  if (/^\/api\/v1\/uploads\/[^/]+$/.test(pathname)) return "assets";
  // Dashboard cards each load one, so they must not spend the canvases budget.
  if (/^\/api\/v1\/canvases\/[^/]+\/thumbnail$/.test(pathname)) {
    return "assets";
  }
  if (pathname === "/api/v1/notifications") return "notifications";
  if (pathname === "/api/v1/search") return "search";
  return null;
}

export const readBudgetLimiters: Record<
  ReadBudget,
  Array<(request: NextRequest) => Promise<NextResponseType | null>>
> = {
  assets: [assetIpRateLimit, assetUserRateLimit],
  notifications: [notificationsIpRateLimit, notificationsUserRateLimit],
  search: [searchIpRateLimit, searchUserRateLimit],
};
/**
 * Same-origin image proxy (IMP-057). A canvas with many bookmarks requests a
 * favicon per item, so it has its own budget instead of draining the general
 * API limit; the cap still bounds use of the server as a fetch relay.
 */
export const imageProxyRateLimit = rateLimit({
  maxRequests: configuredMaxRequests(
    "IMAGE_PROXY_RATE_LIMIT_MAX_REQUESTS",
    300,
  ),
  windowMs: 60 * 1000,
  keyPrefix: "image-proxy",
});
