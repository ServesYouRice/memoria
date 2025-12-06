/**
 * Bookmark Metadata Service
 *
 * Fetches and parses metadata from URLs for bookmark items.
 *
 * @module lib/services/bookmark-metadata
 */

import { sanitizeUrl } from '@/lib/sanitization';
import { logger } from '@/lib/logger';

export interface BookmarkMetadata {
    url: string;
    title: string | null;
    description: string | null;
    favicon: string | null;
    image: string | null;
    siteName: string | null;
    type: string | null;
}

/**
 * Fetch metadata from a URL
 */
export async function fetchBookmarkMetadata(url: string): Promise<BookmarkMetadata> {
    const sanitizedUrl = sanitizeUrl(url);
    if (!sanitizedUrl) {
        throw new Error('Invalid URL');
    }

    const defaultMetadata: BookmarkMetadata = {
        url: sanitizedUrl,
        title: null,
        description: null,
        favicon: null,
        image: null,
        siteName: null,
        type: null,
    };

    try {
        // Use a proxy endpoint to fetch metadata (avoids CORS)
        const response = await fetch(`/api/v1/bookmarks/metadata?url=${encodeURIComponent(sanitizedUrl)}`);

        if (!response.ok) {
            logger.warn({ url: sanitizedUrl, status: response.status }, 'Failed to fetch metadata');
            return defaultMetadata;
        }

        const data = await response.json();
        return {
            url: sanitizedUrl,
            title: data.title || null,
            description: data.description || null,
            favicon: data.favicon || getFaviconUrl(sanitizedUrl),
            image: data.image || null,
            siteName: data.siteName || null,
            type: data.type || null,
        };
    } catch (error) {
        logger.error({ error, url: sanitizedUrl }, 'Error fetching bookmark metadata');
        return {
            ...defaultMetadata,
            favicon: getFaviconUrl(sanitizedUrl),
        };
    }
}

/**
 * Get favicon URL using Google's favicon service
 */
export function getFaviconUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
    } catch {
        return '';
    }
}

/**
 * Get domain from URL
 */
export function getDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

/**
 * Parse Open Graph meta tags from HTML
 */
export function parseOpenGraph(html: string): Partial<BookmarkMetadata> {
    const metadata: Partial<BookmarkMetadata> = {};

    // Title
    const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i)
        || html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) {
        metadata.title = decodeHtmlEntities(titleMatch[1]);
    }

    // Description
    const descMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i)
        || html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
    if (descMatch) {
        metadata.description = decodeHtmlEntities(descMatch[1]);
    }

    // Image
    const imageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i);
    if (imageMatch) {
        metadata.image = imageMatch[1];
    }

    // Site name
    const siteMatch = html.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]*)"[^>]*>/i);
    if (siteMatch) {
        metadata.siteName = decodeHtmlEntities(siteMatch[1]);
    }

    // Type
    const typeMatch = html.match(/<meta[^>]*property="og:type"[^>]*content="([^"]*)"[^>]*>/i);
    if (typeMatch) {
        metadata.type = typeMatch[1];
    }

    return metadata;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
    const textarea = typeof document !== 'undefined' ? document.createElement('textarea') : null;
    if (textarea) {
        textarea.innerHTML = text;
        return textarea.value;
    }
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'");
}
