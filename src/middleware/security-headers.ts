import { NextResponse } from 'next/server';

/**
 * Apply security headers following ADR-0012
 */
export function applySecurityHeaders(response: NextResponse): void {
  // Referrer Policy: Only send origin on cross-origin requests
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // X-Content-Type-Options: Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // X-Frame-Options: Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // X-XSS-Protection: Legacy XSS protection (deprecated but harmless)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Permissions-Policy: Minimize feature access
  const permissionsPolicy = [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'magnetometer=()',
    'gyroscope=()',
    'accelerometer=()',
  ].join(', ');
  response.headers.set('Permissions-Policy', permissionsPolicy);

  // Strict-Transport-Security: Force HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
}
