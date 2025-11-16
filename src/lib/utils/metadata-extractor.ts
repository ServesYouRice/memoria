/**
 * Metadata Extractor
 *
 * Extracts Open Graph and meta tags from HTML for bookmark unfurling
 */

import * as cheerio from 'cheerio';

export interface ExtractedMetadata {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
  url?: string;
}

/**
 * Extract metadata from HTML content
 * Prioritizes Open Graph tags, falls back to standard meta tags
 */
export function extractMetadata(html: string, baseUrl: string): ExtractedMetadata {
  const $ = cheerio.load(html);
  const metadata: ExtractedMetadata = {};

  // Title
  // Priority: og:title > twitter:title > <title> tag
  metadata.title =
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('title').text().trim() ||
    undefined;

  // Description
  // Priority: og:description > twitter:description > meta description
  metadata.description =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="twitter:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    undefined;

  // Image
  // Priority: og:image > twitter:image > first <img> tag
  const ogImage = $('meta[property="og:image"]').attr('content');
  const twitterImage = $('meta[name="twitter:image"]').attr('content');
  const firstImg = $('img').first().attr('src');

  const imageUrl = ogImage || twitterImage || firstImg;
  if (imageUrl) {
    try {
      // Resolve relative URLs
      const resolvedUrl = new URL(imageUrl, baseUrl);
      metadata.image = resolvedUrl.toString();
    } catch {
      // If URL resolution fails, skip the image
      metadata.image = undefined;
    }
  }

  // Favicon
  // Try various favicon link types
  const faviconSelectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
  ];

  for (const selector of faviconSelectors) {
    const faviconHref = $(selector).attr('href');
    if (faviconHref) {
      try {
        const resolvedUrl = new URL(faviconHref, baseUrl);
        metadata.favicon = resolvedUrl.toString();
        break;
      } catch {
        continue;
      }
    }
  }

  // Fallback: try /favicon.ico
  if (!metadata.favicon) {
    try {
      const url = new URL(baseUrl);
      metadata.favicon = `${url.protocol}//${url.host}/favicon.ico`;
    } catch {
      // Ignore if base URL is invalid
    }
  }

  // Site name
  metadata.siteName =
    $('meta[property="og:site_name"]').attr('content') ||
    undefined;

  // Canonical URL
  const canonicalUrl =
    $('link[rel="canonical"]').attr('href') ||
    $('meta[property="og:url"]').attr('content');

  if (canonicalUrl) {
    try {
      const resolvedUrl = new URL(canonicalUrl, baseUrl);
      metadata.url = resolvedUrl.toString();
    } catch {
      metadata.url = baseUrl;
    }
  } else {
    metadata.url = baseUrl;
  }

  // Truncate long values
  if (metadata.title && metadata.title.length > 200) {
    metadata.title = metadata.title.substring(0, 197) + '...';
  }
  if (metadata.description && metadata.description.length > 500) {
    metadata.description = metadata.description.substring(0, 497) + '...';
  }

  return metadata;
}

/**
 * Clean and validate extracted metadata
 */
export function validateMetadata(metadata: ExtractedMetadata): ExtractedMetadata {
  const cleaned: ExtractedMetadata = {};

  // Ensure all string values are properly trimmed and non-empty
  if (metadata.title?.trim()) {
    cleaned.title = metadata.title.trim();
  }
  if (metadata.description?.trim()) {
    cleaned.description = metadata.description.trim();
  }
  if (metadata.image?.trim()) {
    cleaned.image = metadata.image.trim();
  }
  if (metadata.favicon?.trim()) {
    cleaned.favicon = metadata.favicon.trim();
  }
  if (metadata.siteName?.trim()) {
    cleaned.siteName = metadata.siteName.trim();
  }
  if (metadata.url?.trim()) {
    cleaned.url = metadata.url.trim();
  }

  return cleaned;
}
