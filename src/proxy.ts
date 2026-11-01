import { type NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { applyCSP, generateNonce } from "./middleware/csp";
import { applySecurityHeaders } from "./middleware/security-headers";
import {
  apiRateLimit,
  authRateLimit,
  uploadRateLimit,
  canvasesRateLimit,
  itemsRateLimit,
  agentRateLimit,
  sensitiveEndpointRateLimit,
  apiSessionIpRateLimit,
  apiUserRateLimit,
  canvasesUserRateLimit,
  itemsUserRateLimit,
  classifyReadBudget,
  readBudgetLimiters,
  hasSessionCookie,
  imageProxyRateLimit,
} from "./middleware/rate-limit";
import { applyCors, handleCorsPreflight } from "./middleware/cors";
import { shouldApplyStrictAuthRateLimit } from "./middleware/auth-rate-limit";
import { getVersionHeaders, validateApiVersion } from "./lib/api/versioning";
import { createRequestLogger } from "./lib/logger";
import { resolveEmbedFramingOrigins } from "./lib/embeds/framing";

export function isUploadWriteRequest(
  pathname: string,
  method: string,
): boolean {
  return method === "POST" && pathname === "/api/v1/upload";
}

export async function proxy(request: NextRequest) {
  // Generate or extract request ID for tracing (Issue #24)
  const suppliedRequestId = request.headers.get("x-request-id");
  const requestId =
    suppliedRequestId && /^[A-Za-z0-9_-]{8,64}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : nanoid(16);

  const logger = createRequestLogger(requestId);

  // Handle CORS preflight requests (Issue #15)
  if (request.method === "OPTIONS") {
    const preflightResponse = handleCorsPreflight(request);
    if (preflightResponse) {
      return preflightResponse;
    }
  }

  // Log incoming request with request ID
  logger.info(
    {
      requestId,
      method: request.method,
      pathname: request.nextUrl.pathname,
      userAgent: request.headers.get("user-agent"),
    },
    "Incoming request",
  );

  // Validate API version (Issue #23)
  const pathname = request.nextUrl.pathname;
  let specificRateLimitApplied = false;
  if (pathname.startsWith("/api/v")) {
    const versionError = validateApiVersion(pathname);
    if (versionError) {
      const errorResponse = NextResponse.json(
        {
          type: "https://memoria.local/errors/unsupported-version",
          title: "Unsupported API Version",
          status: 400,
          detail: versionError,
        },
        { status: 400 },
      );
      errorResponse.headers.set("x-request-id", requestId);
      return errorResponse;
    }
  }

  // Apply rate limiting for authentication routes (Issue #19)
  // Stricter rate limits to prevent brute force attacks
  if (shouldApplyStrictAuthRateLimit(pathname, request.method)) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await authRateLimit(request);
    if (rateLimitResponse) {
      logger.warn(
        {
          pathname: request.nextUrl.pathname,
          ip: request.headers.get("x-memoria-client-ip"),
        },
        "Auth rate limit exceeded",
      );
      return rateLimitResponse;
    }
  }

  if (pathname.startsWith("/api/agent")) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await agentRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
  }

  if (
    pathname === "/api/csp-report" ||
    pathname.startsWith("/api/setup") ||
    pathname.startsWith("/api/oauth")
  ) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await sensitiveEndpointRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
  }

  if (pathname === "/api/v1/image-proxy") {
    specificRateLimitApplied = true;
    const rateLimitResponse = await imageProxyRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
  }

  // Apply rate limiting for file uploads (stricter)
  if (isUploadWriteRequest(request.nextUrl.pathname, request.method)) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await uploadRateLimit(request);
    if (rateLimitResponse) {
      logger.warn(
        {
          pathname: request.nextUrl.pathname,
          ip: request.headers.get("x-memoria-client-ip"),
        },
        "Upload rate limit exceeded",
      );
      return rateLimitResponse;
    }
  }

  // Apply rate limiting for canvas operations
  if (request.nextUrl.pathname.startsWith("/api/v1/canvases")) {
    specificRateLimitApplied = true;
    const rateLimitResponse =
      (await canvasesRateLimit(request)) ??
      (await canvasesUserRateLimit(request));
    if (rateLimitResponse) return rateLimitResponse;
  }

  // Apply rate limiting for item operations
  if (
    request.nextUrl.pathname.startsWith("/api/v1/canvas-items") ||
    request.nextUrl.pathname.startsWith("/api/v1/items")
  ) {
    specificRateLimitApplied = true;
    const rateLimitResponse =
      (await itemsRateLimit(request)) ?? (await itemsUserRateLimit(request));
    if (rateLimitResponse) return rateLimitResponse;
  }

  // Asset GETs, the notification poll and search have their own budgets, so
  // they neither exhaust nor are starved by the general API budget.
  const readBudget = classifyReadBudget(pathname, request.method);
  if (readBudget && !specificRateLimitApplied) {
    specificRateLimitApplied = true;
    for (const limiter of readBudgetLimiters[readBudget]) {
      const rateLimitResponse = await limiter(request);
      if (rateLimitResponse) return rateLimitResponse;
    }
  }

  // Apply rate limiting for general API routes
  if (
    request.nextUrl.pathname.startsWith("/api/v1") &&
    !specificRateLimitApplied
  ) {
    // Session-bearing requests are limited per user plus a larger per-IP
    // ceiling; requests without a session keep the strict anonymous budget.
    const rateLimitResponse = hasSessionCookie(request)
      ? ((await apiSessionIpRateLimit(request)) ??
        (await apiUserRateLimit(request)))
      : await apiRateLimit(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);

  // Continue with request
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Add request ID to response headers (Issue #24)
  response.headers.set("x-request-id", requestId);

  // Apply CORS headers (Issue #15)
  applyCors(request, response);

  // Only a live, verified embed page may be framed, and only by its origins.
  const embedOrigins = await resolveEmbedFramingOrigins(pathname);

  // Apply security headers
  applySecurityHeaders(response, { allowFraming: embedOrigins !== null });

  // Apply CSP
  applyCSP(response, nonce, embedOrigins ?? undefined);
  if (embedOrigins) {
    // Revocation and expiry must take effect on the next request.
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }

  // Add API version headers for API routes (Issue #23)
  if (pathname.startsWith("/api/v")) {
    const versionHeaders = getVersionHeaders(pathname);
    Object.entries(versionHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
