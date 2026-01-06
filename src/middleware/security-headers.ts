import { type NextResponse } from 'next/server';
import { SECURITY_HEADERS } from '@/lib/security/headers';
import { HSTS_MAX_AGE_SECONDS } from '@/lib/constants';

/**
 * Apply security headers following ADR-0012
 */
export function applySecurityHeaders(response: NextResponse): void {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Strict-Transport-Security: Force HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains; preload`
    );
  }
}
