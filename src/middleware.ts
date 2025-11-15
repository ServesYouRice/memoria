import { NextRequest, NextResponse } from 'next/server';
import { applyCSP } from './middleware/csp';
import { applySecurityHeaders } from './middleware/security-headers';
import { apiRateLimit, authRateLimit } from './middleware/rate-limit';
import { applyCors, handleCorsPreflight } from './middleware/cors';
import { getVersionHeaders, validateApiVersion } from './lib/api/versioning';
import { createRequestLogger } from './lib/logger';

export function middleware(request: NextRequest) {
  const logger = createRequestLogger();

  // Handle CORS preflight requests (Issue #15)
  if (request.method === 'OPTIONS') {
    const preflightResponse = handleCorsPreflight(request);
    if (preflightResponse) {
      return preflightResponse;
    }
  }

  // Log incoming request
  logger.info(
    {
      method: request.method,
      url: request.url,
      userAgent: request.headers.get('user-agent'),
    },
    'Incoming request'
  );

  // Validate API version (Issue #23)
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith('/api/v')) {
    const versionError = validateApiVersion(pathname);
    if (versionError) {
      return NextResponse.json(
        {
          type: 'https://canvascollect.com/errors/unsupported-version',
          title: 'Unsupported API Version',
          status: 400,
          detail: versionError,
        },
        { status: 400 }
      );
    }
  }

  // Apply rate limiting for authentication routes (Issue #19)
  // Stricter rate limits to prevent brute force attacks
  if (
    request.nextUrl.pathname.startsWith('/api/v1/auth') ||
    request.nextUrl.pathname.startsWith('/api/auth')
  ) {
    const rateLimitResponse = authRateLimit(request);
    if (rateLimitResponse) {
      logger.warn(
        {
          pathname: request.nextUrl.pathname,
          ip: request.headers.get('x-forwarded-for'),
        },
        'Auth rate limit exceeded'
      );
      return rateLimitResponse;
    }
  }

  // Apply rate limiting for general API routes
  if (request.nextUrl.pathname.startsWith('/api/v1')) {
    const rateLimitResponse = apiRateLimit(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  // Continue with request
  const response = NextResponse.next();

  // Apply CORS headers (Issue #15)
  applyCors(request, response);

  // Apply security headers
  applySecurityHeaders(response);

  // Apply CSP
  applyCSP(request, response);

  // Add API version headers for API routes (Issue #23)
  if (pathname.startsWith('/api/v')) {
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
