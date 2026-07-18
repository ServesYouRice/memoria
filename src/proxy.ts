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
} from "./middleware/rate-limit";
import { applyCors, handleCorsPreflight } from "./middleware/cors";
import { shouldApplyStrictAuthRateLimit } from "./middleware/auth-rate-limit";
import { getVersionHeaders, validateApiVersion } from "./lib/api/versioning";
import { createRequestLogger } from "./lib/logger";

export async function proxy(request: NextRequest) {
  // Generate or extract request ID for tracing (Issue #24)
  const requestId = request.headers.get("x-request-id") || nanoid(16);

  const logger = createRequestLogger();

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

  if (pathname === "/api/csp-report" || pathname.startsWith("/api/setup")) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await sensitiveEndpointRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
  }

  // Apply rate limiting for file uploads (stricter)
  if (request.nextUrl.pathname.startsWith("/api/v1/upload")) {
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
    const rateLimitResponse = await canvasesRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
  }

  // Apply rate limiting for item operations
  if (
    request.nextUrl.pathname.startsWith("/api/v1/canvas-items") ||
    request.nextUrl.pathname.startsWith("/api/v1/items")
  ) {
    specificRateLimitApplied = true;
    const rateLimitResponse = await itemsRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;
  }

  // Apply rate limiting for general API routes
  if (
    request.nextUrl.pathname.startsWith("/api/v1") &&
    !specificRateLimitApplied
  ) {
    const rateLimitResponse = await apiRateLimit(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

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
  applySecurityHeaders(response);

  // Apply CSP
  applyCSP(response, nonce);

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
