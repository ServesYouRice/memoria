/**
 * Endpoint-Specific Rate Limit Configuration
 *
 * Provides fine-grained rate limiting per endpoint.
 *
 * @module lib/rate-limit/endpoint-limits
 */

export interface EndpointLimit {
    /** Maximum requests allowed */
    max: number;
    /** Window duration in seconds */
    windowSec: number;
    /** Whether to apply per-user (vs per-IP) limiting */
    perUser?: boolean;
}

/**
 * Rate limits by endpoint pattern
 */
export const ENDPOINT_LIMITS: Record<string, EndpointLimit> = {
    // Canvas operations - generous limits
    '/api/v1/canvases': { max: 50, windowSec: 60, perUser: true },
    '/api/v1/canvas': { max: 100, windowSec: 60, perUser: true },

    // Canvas items - high frequency for real-time editing
    '/api/v1/canvas-items': { max: 200, windowSec: 60, perUser: true },

    // File uploads - stricter limits
    '/api/v1/upload': { max: 10, windowSec: 60, perUser: true },
    '/api/upload': { max: 10, windowSec: 60, perUser: true },

    // Templates - moderate limits
    '/api/v1/templates': { max: 30, windowSec: 60, perUser: true },

    // Comments - moderate limits
    '/api/v1/comments': { max: 50, windowSec: 60, perUser: true },

    // Search - prevent abuse
    '/api/v1/search': { max: 20, windowSec: 60, perUser: true },

    // Authentication - strict to prevent brute force
    '/api/auth/signin': { max: 10, windowSec: 60, perUser: false },
    '/api/auth/register': { max: 5, windowSec: 60, perUser: false },
    '/api/auth/password-reset': { max: 3, windowSec: 300, perUser: false },

    // Share links - prevent enumeration
    '/api/v1/share': { max: 20, windowSec: 60, perUser: true },

    // Version history
    '/api/v1/versions': { max: 30, windowSec: 60, perUser: true },

    // Default fallback
    'default': { max: 100, windowSec: 60, perUser: false },
};

/**
 * Get rate limit configuration for a given endpoint
 */
export function getEndpointLimit(pathname: string): EndpointLimit {
    // Try exact match first
    if (ENDPOINT_LIMITS[pathname]) {
        return ENDPOINT_LIMITS[pathname];
    }

    // Try prefix match
    for (const [pattern, limit] of Object.entries(ENDPOINT_LIMITS)) {
        if (pattern !== 'default' && pathname.startsWith(pattern)) {
            return limit;
        }
    }

    return ENDPOINT_LIMITS['default'];
}

/**
 * Generate rate limit key for an endpoint
 */
export function getRateLimitKey(
    pathname: string,
    identifier: string,
    perUser: boolean
): string {
    const prefix = perUser ? 'user' : 'ip';
    const normalizedPath = pathname.replace(/\/[a-zA-Z0-9-]+$/, ''); // Remove trailing ID
    return `ratelimit:${prefix}:${normalizedPath}:${identifier}`;
}

/**
 * Format rate limit headers for response
 */
export function getRateLimitHeaders(
    limit: EndpointLimit,
    remaining: number,
    resetAt: number
): Record<string, string> {
    return {
        'X-RateLimit-Limit': String(limit.max),
        'X-RateLimit-Remaining': String(Math.max(0, remaining)),
        'X-RateLimit-Reset': String(resetAt),
        'X-RateLimit-Window': String(limit.windowSec),
    };
}
