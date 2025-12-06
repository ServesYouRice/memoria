/**
 * Unit Tests for Sanitization Utilities
 *
 * Tests XSS protection functions in src/lib/sanitization.ts
 */

import { describe, test, expect } from 'vitest';
import {
    escapeHtml,
    stripHtml,
    sanitizeUrl,
    sanitizeBookmarkMetadata,
    sanitizeNoteContent,
    sanitizeContent,
} from '@/lib/sanitization';

describe('escapeHtml', () => {
    test('escapes ampersands', () => {
        expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    test('escapes less than signs', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    test('escapes quotes', () => {
        expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#039;world&#039;');
    });

    test('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    test('blocks XSS attempts', () => {
        const xss = '<script>alert("XSS")</script>';
        const result = escapeHtml(xss);
        expect(result).not.toContain('<script>');
        expect(result).toContain('&lt;script&gt;');
    });
});

describe('stripHtml', () => {
    test('removes HTML tags', () => {
        expect(stripHtml('<p>Hello</p>')).toBe('Hello');
    });

    test('removes script tags', () => {
        expect(stripHtml('<script>alert("xss")</script>')).toBe('');
    });

    test('handles nested tags', () => {
        expect(stripHtml('<div><p><strong>Text</strong></p></div>')).toBe('Text');
    });

    test('trims whitespace', () => {
        expect(stripHtml('  <p>Hello</p>  ')).toBe('Hello');
    });

    test('handles empty string', () => {
        expect(stripHtml('')).toBe('');
    });
});

describe('sanitizeUrl', () => {
    test('allows https URLs', () => {
        expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    });

    test('allows http URLs', () => {
        expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
    });

    test('allows relative URLs', () => {
        expect(sanitizeUrl('/path/to/page')).toBe('/path/to/page');
    });

    test('blocks javascript: URLs', () => {
        expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    });

    test('blocks javascript: with encoding', () => {
        expect(sanitizeUrl('javascript%3Aalert(1)')).toBeNull();
    });

    test('blocks data: URLs', () => {
        expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    });

    test('blocks vbscript: URLs', () => {
        expect(sanitizeUrl('vbscript:msgbox("xss")')).toBeNull();
    });

    test('handles empty string', () => {
        expect(sanitizeUrl('')).toBeNull();
    });
});

describe('sanitizeBookmarkMetadata', () => {
    test('sanitizes URL, title, and description', () => {
        const result = sanitizeBookmarkMetadata({
            url: 'https://example.com',
            title: '<script>XSS</script>Safe Title',
            description: 'Safe desc',
        });
        expect(result.title).not.toContain('<script>');
        expect(result.url).toBe('https://example.com');
    });

    test('rejects javascript: URLs', () => {
        const result = sanitizeBookmarkMetadata({
            url: 'javascript:alert(1)',
            title: 'Test',
            description: 'Test',
        });
        expect(result.url).toBe('');
    });
});

describe('sanitizeNoteContent', () => {
    test('allows safe HTML', () => {
        const result = sanitizeNoteContent('<p>Hello <strong>World</strong></p>');
        expect(result).toContain('<strong>World</strong>');
    });

    test('strips dangerous tags', () => {
        const result = sanitizeNoteContent('<script>alert("xss")</script><p>Safe</p>');
        expect(result).not.toContain('<script>');
        expect(result).toContain('Safe');
    });
});

describe('sanitizeContent', () => {
    test('sanitizes object with nested content', () => {
        const input = {
            text: '<script>alert(1)</script>Hello',
            nested: {
                value: '<img src=x onerror=alert(1)>',
            },
        };
        const result = sanitizeContent(input);
        expect(JSON.stringify(result)).not.toContain('<script>');
    });
});
