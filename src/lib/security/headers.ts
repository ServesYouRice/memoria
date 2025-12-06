/**
 * Security Headers Utility
 *
 * Provides security headers for API responses, especially file uploads.
 *
 * @module lib/security/headers
 */

import { NextResponse } from 'next/server';

/**
 * Security headers to apply to all responses
 */
export const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} as const;

/**
 * Additional headers for file downloads/uploads
 */
export const FILE_HEADERS = {
    ...SECURITY_HEADERS,
    'Content-Disposition': 'attachment',
    'Cache-Control': 'no-store, max-age=0',
} as const;

/**
 * Headers for public static assets
 */
export const ASSET_HEADERS = {
    ...SECURITY_HEADERS,
    'Cache-Control': 'public, max-age=31536000, immutable',
} as const;

/**
 * Apply security headers to a response
 */
export function applySecurityHeaders<T>(response: NextResponse<T>): NextResponse<T> {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        response.headers.set(key, value);
    }
    return response;
}

/**
 * Apply file security headers to a response
 */
export function applyFileHeaders<T>(response: NextResponse<T>, filename?: string): NextResponse<T> {
    for (const [key, value] of Object.entries(FILE_HEADERS)) {
        response.headers.set(key, value);
    }

    if (filename) {
        // Sanitize filename for Content-Disposition header
        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        response.headers.set('Content-Disposition', `attachment; filename="${safeFilename}"`);
    }

    return response;
}

/**
 * Create a response with security headers pre-applied
 */
export function secureJson<T>(data: T, init?: ResponseInit): NextResponse<T> {
    const response = NextResponse.json(data, init);
    return applySecurityHeaders(response);
}

/**
 * Create a file response with security headers
 */
export function secureFile(
    body: BodyInit,
    filename: string,
    contentType: string,
    init?: ResponseInit
): NextResponse {
    const response = new NextResponse(body, init);
    response.headers.set('Content-Type', contentType);
    return applyFileHeaders(response, filename);
}
