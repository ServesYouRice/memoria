import { type NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { applyCSP, buildCSP, generateNonce } from "./middleware/csp";
import { applySecurityHeaders } from "./middleware/security-headers";
import { finalizeEarlyResponse } from "./middleware/finalize-response";
import {
  apiRateLimit,
  authGroupRateLimits,
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
import { strictAuthRateLimitGroup } from "./middleware/auth-rate-limit";
import { getVersionHeaders, validateApiVersion } from "./lib/api/versioning";
import { createRequestLogger, redactTokenPath } from "./lib/logger";
import { resolveEmbedFramingOrigins } from "./lib/embeds/framing";

export function isUploadWriteRequest(
  pathname: string,
  method: string,
): boolean {
  return method === "POST" && pathname === "/api/v1/upload";
}

export function isShareTargetSaveRequest(
  pathname: string,
  method: string,
): boolean {
  return (
    pathname === "/share-target/save" &&
    (method === "POST" || method === "PATCH")
  );
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
      pathname: redactTokenPath(request.nextUrl.pathname),
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
      return finalizeEarlyResponse(request, errorResponse, requestId);
    }
  }

  // Apply rate limiting for authentication routes (Issue #19)
  // Stricter rate limits to prevent brute force attacks
  const authGroup = strictAuthRateLimitGroup(pathname, request.method);
  if (authGroup) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await authGroupRateLimits[authGroup](request);
    if (rateLimitResponse) {
      logger.warn(
        {
          pathname: redactTokenPath(request.nextUrl.pathname),
          ip: request.headers.get("x-memoria-client-ip"),
        },
        "Auth rate limit exceeded",
      );
      return finalizeEarlyResponse(request, rateLimitResponse, requestId);
    }
  }

  if (pathname.startsWith("/api/agent")) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await agentRateLimit(request);
    if (rateLimitResponse)
      return finalizeEarlyResponse(request, rateLimitResponse, requestId);
  }

  if (
    pathname === "/api/csp-report" ||
    pathname.startsWith("/api/setup") ||
    pathname.startsWith("/api/oauth")
  ) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await sensitiveEndpointRateLimit(request);
    if (rateLimitResponse)
      return finalizeEarlyResponse(request, rateLimitResponse, requestId);
  }

  if (pathname === "/api/v1/image-proxy") {
    specificRateLimitApplied = true;
    const rateLimitResponse = await imageProxyRateLimit(request);
    if (rateLimitResponse)
      return finalizeEarlyResponse(request, rateLimitResponse, requestId);
  }

  // Apply rate limiting for file uploads (stricter)
  if (isUploadWriteRequest(request.nextUrl.pathname, request.method)) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await uploadRateLimit(request);
    if (rateLimitResponse) {
      logger.warn(
        {
          pathname: redactTokenPath(request.nextUrl.pathname),
          ip: request.headers.get("x-memoria-client-ip"),
        },
        "Upload rate limit exceeded",
      );
      return finalizeEarlyResponse(request, rateLimitResponse, requestId);
    }
  }

  // Apply rate limiting for canvas operations. Thumbnail GETs are asset
  // reads and take the assets budget below instead.
  const readBudget = classifyReadBudget(pathname, request.method);
  if (
    request.nextUrl.pathname.startsWith("/api/v1/canvases") &&
    readBudget !== "assets"
  ) {
    specificRateLimitApplied = true;
    const rateLimitResponse =
      (await canvasesRateLimit(request)) ??
      (await canvasesUserRateLimit(request));
    if (rateLimitResponse)
      return finalizeEarlyResponse(request, rateLimitResponse, requestId);
  }

  // Apply rate limiting for item operations. The share-target save (IMP-062)
  // writes Inbox items outside /api/v1, so it shares the item budget.
  if (
    request.nextUrl.pathname.startsWith("/api/v1/canvas-items") ||
    request.nextUrl.pathname.startsWith("/api/v1/items") ||
    isShareTargetSaveRequest(pathname, request.method)
  ) {
    specificRateLimitApplied = true;
    const rateLimitResponse =
      (await itemsRateLimit(request)) ?? (await itemsUserRateLimit(request));
    if (rateLimitResponse)
      return finalizeEarlyResponse(request, rateLimitResponse, requestId);
  }

  // Asset GETs, the notification poll and search have their own budgets, so
  // they neither exhaust nor are starved by the general API budget.
  if (readBudget && !specificRateLimitApplied) {
    specificRateLimitApplied = true;
    for (const limiter of readBudgetLimiters[readBudget]) {
      const rateLimitResponse = await limiter(request);
      if (rateLimitResponse)
        return finalizeEarlyResponse(request, rateLimitResponse, requestId);
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
      return finalizeEarlyResponse(request, rateLimitResponse, requestId);
    }
  }

  // Only a live, verified embed page may be framed, and only by its origins.
  const embedOrigins = await resolveEmbedFramingOrigins(pathname);

  const nonce = generateNonce();
  const csp = buildCSP(nonce, embedOrigins ?? undefined);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  // Next.js reads the nonce for its framework scripts from the request CSP.
  requestHeaders.set("Content-Security-Policy", csp);

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

  // Apply security headers
  applySecurityHeaders(response, { allowFraming: embedOrigins !== null });

  // Apply CSP
  applyCSP(response, nonce, embedOrigins ?? undefined, csp);
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
