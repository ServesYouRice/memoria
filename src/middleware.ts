import { NextRequest, NextResponse } from 'next/server';
import { applyCSP } from './middleware/csp';
import { applySecurityHeaders } from './middleware/security-headers';
import { apiRateLimit, authRateLimit } from './middleware/rate-limit';
import { createRequestLogger } from './lib/logger';

export function middleware(request: NextRequest) {
  const logger = createRequestLogger();

  // Log incoming request
  logger.info(
    {
      method: request.method,
      url: request.url,
      userAgent: request.headers.get('user-agent'),
    },
    'Incoming request'
  );

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

  // Apply security headers
  applySecurityHeaders(response);

  // Apply CSP
  applyCSP(request, response);

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
