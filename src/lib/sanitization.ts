/**
 * Input Sanitization Utilities
 *
 * FIXED: Issue #38 - Added comprehensive JSDoc to complex functions
 *
 * Provides XSS protection for user input.
 * See CODE_AUDIT_REPORT.md Issue #18
 *
 * NOTE: For full XSS protection, install DOMPurify:
 *   pnpm add isomorphic-dompurify
 *
 * This module provides basic sanitization that works without external dependencies.
 * For production, consider using DOMPurify for more comprehensive sanitization.
 */

/**
 * Escapes HTML special characters to prevent XSS attacks
 *
 * Converts potentially dangerous characters to their HTML entity equivalents:
 * - `&` → `&amp;`
 * - `<` → `&lt;`
 * - `>` → `&gt;`
 * - `"` → `&quot;`
 * - `'` → `&#039;`
 *
 * @param unsafe - The string to escape
 * @returns HTML-safe string with special characters escaped
 * @example
 * ```typescript
 * escapeHtml('<script>alert("XSS")</script>');
 * // Returns: '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
 * ```
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Removes all HTML tags from input text
 *
 * Use this for user input fields that should never contain HTML markup.
 * This is more restrictive than escapeHtml() - it completely removes tags
 * instead of encoding them.
 *
 * @param input - The text to sanitize
 * @returns Plain text with all HTML tags removed and whitespace trimmed
 * @example
 * ```typescript
 * sanitizePlainText('Hello <b>World</b>!  ');
 * // Returns: 'Hello World!'
 * ```
 */
export function sanitizePlainText(input: string): string {
  // Remove all HTML tags and trim whitespace
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * Validates and sanitizes URLs to prevent XSS attacks via dangerous protocols
 *
 * Blocks dangerous URL protocols including:
 * - `javascript:` (executes JavaScript)
 * - `data:` (can contain executable code)
 * - `vbscript:` (VBScript execution)
 * - `file:` (local file access)
 * - `about:` (browser-specific URIs)
 *
 * Only allows:
 * - `http://` and `https://` (web URLs)
 * - `mailto:` (email links)
 * - Relative URLs (`/`, `./`, `../`)
 *
 * @param url - The URL to validate and sanitize
 * @returns The sanitized URL, or null if the URL is potentially dangerous
 * @example
 * ```typescript
 * sanitizeUrl('https://example.com'); // Returns: 'https://example.com'
 * sanitizeUrl('javascript:alert(1)'); // Returns: null
 * sanitizeUrl('/path/to/page');       // Returns: '/path/to/page'
 * ```
 */
export function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();

  // Check for dangerous protocols
  const dangerousProtocols = [
    'javascript:',
    'data:',
    'vbscript:',
    'file:',
    'about:',
  ];

  const lowerUrl = trimmed.toLowerCase();
  if (dangerousProtocols.some(protocol => lowerUrl.startsWith(protocol))) {
    return null;
  }

  // Only allow http, https, mailto, and relative URLs
  const allowedProtocolPattern = /^(https?:|mailto:|\/|\.\/|\.\.\/)/i;
  if (!trimmed.match(allowedProtocolPattern) && trimmed.includes(':')) {
    return null;
  }

  return trimmed;
}

/**
 * Sanitize markdown content
 * Basic sanitization for markdown - removes script tags and dangerous attributes
 */
export function sanitizeMarkdown(markdown: string): string {
  return markdown
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove event handlers
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/on\w+\s*=\s*[^\s>]*/gi, '')
    // Remove javascript: URLs
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
    .replace(/src\s*=\s*["']javascript:[^"']*["']/gi, 'src=""')
    .trim();
}

/**
 * Sanitize comment content
 * Allows basic formatting but removes dangerous HTML
 */
export function sanitizeComment(content: string): string {
  // For now, use plain text sanitization
  // In production, use DOMPurify with limited allowed tags:
  // return DOMPurify.sanitize(content, {
  //   ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre'],
  //   ALLOWED_ATTR: [],
  // });

  return sanitizePlainText(content);
}

/**
 * Sanitize note content (JSON)
 * Validates and sanitizes note content structure
 */
export function sanitizeNoteContent(content: unknown): { text: string } | null {
  if (typeof content !== 'object' || content === null) {
    return null;
  }

  const note = content as Record<string, unknown>;

  if (typeof note.text !== 'string') {
    return null;
  }

  return {
    text: sanitizePlainText(note.text),
  };
}

/**
 * Sanitize bookmark content (JSON)
 * Validates and sanitizes bookmark content structure
 */
export function sanitizeBookmarkContent(
  content: unknown
): { url: string; title: string; description?: string } | null {
  if (typeof content !== 'object' || content === null) {
    return null;
  }

  const bookmark = content as Record<string, unknown>;

  if (typeof bookmark.url !== 'string' || typeof bookmark.title !== 'string') {
    return null;
  }

  const sanitizedUrl = sanitizeUrl(bookmark.url);
  if (!sanitizedUrl) {
    return null;
  }

  const result: { url: string; title: string; description?: string } = {
    url: sanitizedUrl,
    title: sanitizePlainText(bookmark.title),
  };

  if (typeof bookmark.description === 'string') {
    result.description = sanitizePlainText(bookmark.description);
  }

  return result;
}

/**
 * Validate and sanitize email address
 */
export function sanitizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();

  // Basic email validation
  const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  if (!emailPattern.test(trimmed)) {
    return null;
  }

  // Check length limits
  if (trimmed.length > 254) {
    return null;
  }

  return trimmed;
}

/**
 * Sanitize search query
 * Prevents SQL injection and other attacks in search queries
 */
export function sanitizeSearchQuery(query: string): string {
  return query
    .trim()
    // Remove SQL injection attempts
    .replace(/[;'"\\]/g, '')
    // Limit length
    .slice(0, 100);
}

/**
 * Strip dangerous characters from filename
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 255);
}

/*
 * ============================================================================
 * PRODUCTION IMPLEMENTATION WITH DOMPURIFY
 * ============================================================================
 *
 * For production use, install DOMPurify for comprehensive XSS protection:
 *
 * 1. Install dependency:
 *    pnpm add isomorphic-dompurify
 *
 * 2. Replace the basic functions above with DOMPurify:
 *
 * ```typescript
 * import DOMPurify from 'isomorphic-dompurify';
 *
 * export function sanitizeComment(content: string): string {
 *   return DOMPurify.sanitize(content, {
 *     ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li'],
 *     ALLOWED_ATTR: [],
 *   });
 * }
 *
 * export function sanitizeMarkdown(markdown: string): string {
 *   // Convert markdown to HTML first (using a markdown library)
 *   // then sanitize with DOMPurify
 *   return DOMPurify.sanitize(markdown, {
 *     ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote'],
 *     ALLOWED_ATTR: ['href', 'title'],
 *     ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
 *   });
 * }
 * ```
 *
 * Benefits of DOMPurify:
 * - ✅ Battle-tested against XSS attacks
 * - ✅ Regular security updates
 * - ✅ Configurable allowed tags and attributes
 * - ✅ Works in both browser and Node.js (isomorphic)
 * - ✅ Actively maintained
 * - ✅ Used by major companies
 *
 * See: https://github.com/cure53/DOMPurify
 */
