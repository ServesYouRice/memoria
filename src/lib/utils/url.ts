/**
 * URL Utilities
 *
 * Helpers for URL manipulation and query parameters.
 *
 * @module lib/utils/url
 */

/**
 * Build URL with query parameters
 */
export function buildUrl(base: string, params?: Record<string, string | number | boolean | undefined | null>): string {
    if (!params) return base;

    const url = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    }

    return url.pathname + url.search;
}

/**
 * Parse query parameters from URL
 */
export function parseQueryParams(url: string): Record<string, string> {
    try {
        const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        const params: Record<string, string> = {};
        parsed.searchParams.forEach((value, key) => {
            params[key] = value;
        });
        return params;
    } catch {
        return {};
    }
}

/**
 * Update query parameter in current URL
 */
export function updateQueryParam(key: string, value: string | null): string {
    if (typeof window === 'undefined') return '';

    const url = new URL(window.location.href);
    if (value === null) {
        url.searchParams.delete(key);
    } else {
        url.searchParams.set(key, value);
    }
    return url.pathname + url.search;
}

/**
 * Get single query parameter from URL
 */
export function getQueryParam(url: string, key: string): string | null {
    try {
        const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        return parsed.searchParams.get(key);
    } catch {
        return null;
    }
}

/**
 * Check if URL is external
 */
export function isExternalUrl(url: string): boolean {
    if (!url.startsWith('http')) return false;
    try {
        const parsed = new URL(url);
        const currentHost = typeof window !== 'undefined' ? window.location.host : '';
        return parsed.host !== currentHost;
    } catch {
        return false;
    }
}

/**
 * Get path segments from URL
 */
export function getPathSegments(url: string): string[] {
    try {
        const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        return parsed.pathname.split('/').filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Join URL paths safely
 */
export function joinPaths(...paths: string[]): string {
    return paths
        .map((p, i) => {
            if (i === 0) return p.replace(/\/+$/, '');
            return p.replace(/^\/+|\/+$/g, '');
        })
        .filter(Boolean)
        .join('/');
}

/**
 * Create share URL for canvas
 */
export function createShareUrl(canvasId: string, token?: string): string {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    if (token) {
        return `${base}/share/${token}`;
    }
    return `${base}/canvas/${canvasId}`;
}

/**
 * Parse canvas ID from URL
 */
export function parseCanvasIdFromUrl(url: string): string | null {
    const segments = getPathSegments(url);
    const canvasIndex = segments.indexOf('canvas');
    if (canvasIndex !== -1 && segments[canvasIndex + 1]) {
        return segments[canvasIndex + 1];
    }
    return null;
}
