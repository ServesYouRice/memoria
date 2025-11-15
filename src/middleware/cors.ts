/**
 * CORS Configuration Middleware
 *
 * FIXED: Issue #15 - Missing CORS configuration
 *
 * Implements a secure CORS policy for API routes.
 * Follows best practices from OWASP and ADR-0012: Security Headers & CORS Policy.
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * CORS Configuration
 *
 * Environment variables:
 * - CORS_ALLOWED_ORIGINS: Comma-separated list of allowed origins
 *   Example: "https://app.example.com,https://admin.example.com"
 * - CORS_ALLOWED_METHODS: Comma-separated list of allowed methods
 *   Default: "GET,POST,PUT,PATCH,DELETE,OPTIONS"
 * - CORS_ALLOW_CREDENTIALS: Whether to allow credentials (cookies, auth headers)
 *   Default: "true"
 * - CORS_MAX_AGE: How long (in seconds) preflight responses can be cached
 *   Default: "86400" (24 hours)
 */
interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  allowCredentials: boolean;
  maxAge: number;
}

function getCorsConfig(): CorsConfig {
  // Default to same-origin in production, all origins in development
  const defaultOrigins =
    process.env.NODE_ENV === 'production'
      ? [process.env.NEXTAUTH_URL || 'https://localhost:3000']
      : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
    : defaultOrigins;

  const allowedMethods = process.env.CORS_ALLOWED_METHODS
    ? process.env.CORS_ALLOWED_METHODS.split(',').map((method) => method.trim())
    : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

  const allowedHeaders = [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
  ];

  const allowCredentials = process.env.CORS_ALLOW_CREDENTIALS !== 'false';

  const maxAge = parseInt(process.env.CORS_MAX_AGE || '86400', 10);

  return {
    allowedOrigins,
    allowedMethods,
    allowedHeaders,
    allowCredentials,
    maxAge,
  };
}

/**
 * Check if an origin is allowed
 */
function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) {
    // Allow requests with no origin (e.g., mobile apps, curl, Postman)
    // In production, you might want to be stricter
    return process.env.NODE_ENV === 'development';
  }

  // Check for exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Check for wildcard subdomain patterns (e.g., "*.example.com")
  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin.startsWith('*.')) {
      const domain = allowedOrigin.slice(2); // Remove "*."
      return origin.endsWith(domain);
    }
    return false;
  });
}

/**
 * Apply CORS headers to a response
 *
 * Usage:
 * ```typescript
 * const response = NextResponse.next();
 * applyCors(request, response);
 * return response;
 * ```
 */
export function applyCors(request: NextRequest, response: NextResponse): void {
  const config = getCorsConfig();
  const origin = request.headers.get('origin');

  // Check if origin is allowed
  if (isOriginAllowed(origin, config.allowedOrigins)) {
    // Set allowed origin (never use "*" with credentials)
    if (origin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }

    // Allow credentials (cookies, authorization headers)
    if (config.allowCredentials) {
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }

    // Set allowed methods
    response.headers.set('Access-Control-Allow-Methods', config.allowedMethods.join(', '));

    // Set allowed headers
    response.headers.set('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));

    // Set max age for preflight cache
    response.headers.set('Access-Control-Max-Age', String(config.maxAge));

    // Expose headers that the client can access
    response.headers.set('Access-Control-Expose-Headers', 'Content-Length, X-Request-Id');
  }
}

/**
 * Handle CORS preflight requests (OPTIONS)
 *
 * Usage in middleware:
 * ```typescript
 * if (request.method === 'OPTIONS') {
 *   return handleCorsPreFlight(request);
 * }
 * ```
 */
export function handleCorsPreflight(request: NextRequest): NextResponse | null {
  const config = getCorsConfig();
  const origin = request.headers.get('origin');

  // Only handle preflight if origin is allowed
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    return NextResponse.json(
      { error: 'CORS policy: Origin not allowed' },
      { status: 403 }
    );
  }

  const response = new NextResponse(null, { status: 204 });

  // Set CORS headers
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }

  if (config.allowCredentials) {
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  response.headers.set('Access-Control-Allow-Methods', config.allowedMethods.join(', '));
  response.headers.set('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
  response.headers.set('Access-Control-Max-Age', String(config.maxAge));

  return response;
}

/**
 * Validate CORS configuration on startup
 */
export function validateCorsConfig(): void {
  const config = getCorsConfig();

  if (process.env.NODE_ENV === 'production') {
    // Warn if using wildcard in production
    if (config.allowedOrigins.some((origin) => origin === '*')) {
      console.warn(
        'WARNING: CORS is configured to allow all origins (*) in production. ' +
          'This is a security risk. Set CORS_ALLOWED_ORIGINS environment variable.'
      );
    }

    // Warn if allowing credentials with wildcard
    if (
      config.allowCredentials &&
      config.allowedOrigins.some((origin) => origin === '*')
    ) {
      console.error(
        'ERROR: CORS cannot allow credentials with wildcard origin (*). ' +
          'This configuration will not work. Set specific origins in CORS_ALLOWED_ORIGINS.'
      );
    }

    // Warn if no NEXTAUTH_URL is set
    if (!process.env.NEXTAUTH_URL && !process.env.CORS_ALLOWED_ORIGINS) {
      console.warn(
        'WARNING: Neither NEXTAUTH_URL nor CORS_ALLOWED_ORIGINS is set. ' +
          'CORS may not work correctly in production.'
      );
    }
  }

  console.log('CORS configuration loaded:', {
    allowedOrigins: config.allowedOrigins,
    allowedMethods: config.allowedMethods,
    allowCredentials: config.allowCredentials,
  });
}
