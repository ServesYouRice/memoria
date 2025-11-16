/**
 * SSRF (Server-Side Request Forgery) Protection Utilities
 *
 * Implements ADR-0003: SSRF-Protected Unfurling
 * Prevents malicious URLs from accessing internal resources
 */

import { URL } from 'url';

// Private IP ranges to block
const PRIVATE_IP_PATTERNS = [
  /^10\./,                     // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,               // 192.168.0.0/16
  /^127\./,                    // 127.0.0.0/8 (localhost)
  /^169\.254\./,               // 169.254.0.0/16 (link-local)
  /^0\./,                      // 0.0.0.0/8
  /^224\./,                    // 224.0.0.0/4 (multicast)
  /^240\./,                    // 240.0.0.0/4 (reserved)
  /^255\.255\.255\.255$/,      // broadcast
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  'localhost',
  '0.0.0.0',
];

/**
 * Check if a hostname is a private/internal IP or hostname
 */
function isPrivateOrLocalHost(hostname: string): boolean {
  // Check for blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    return true;
  }

  // Check for private IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  // Check for IPv6 localhost
  if (hostname === '::1' || hostname === '::ffff:127.0.0.1') {
    return true;
  }

  // Check for IPv6 link-local (fe80::/10)
  if (hostname.toLowerCase().startsWith('fe80:')) {
    return true;
  }

  // Check for IPv6 unique local addresses (fc00::/7)
  if (hostname.toLowerCase().startsWith('fc') || hostname.toLowerCase().startsWith('fd')) {
    return true;
  }

  return false;
}

/**
 * Validate a URL for SSRF protection
 * Returns true if the URL is safe to fetch
 */
export function validateUrlForSsrf(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    // Only allow HTTP and HTTPS
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
    }

    // Check hostname
    const hostname = url.hostname.toLowerCase();

    // Check for private/internal addresses
    if (isPrivateOrLocalHost(hostname)) {
      return { valid: false, error: 'Cannot fetch URLs from private or local addresses' };
    }

    // Check for suspicious userinfo in URL (e.g., http://user:pass@example.com)
    if (url.username || url.password) {
      return { valid: false, error: 'URLs with authentication are not allowed' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Fetch a URL with SSRF protection
 * Follows redirects but validates each redirect URL
 */
export async function safeFetch(
  urlString: string,
  options: {
    maxRedirects?: number;
    timeout?: number;
    maxSize?: number;
  } = {}
): Promise<{ ok: boolean; status: number; data?: string; error?: string }> {
  const { maxRedirects = 5, timeout = 10000, maxSize = 1024 * 1024 } = options; // 1MB default max size

  let currentUrl = urlString;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    // Validate current URL
    const validation = validateUrlForSsrf(currentUrl);
    if (!validation.valid) {
      return { ok: false, status: 400, error: validation.error };
    }

    try {
      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Fetch the URL
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual', // Handle redirects manually for validation
        signal: controller.signal,
        headers: {
          'User-Agent': 'CanvasCollect/1.0 (Link Preview Bot)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      clearTimeout(timeoutId);

      // Handle redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { ok: false, status: response.status, error: 'Redirect without location header' };
        }

        // Resolve relative URLs
        const redirectUrl = new URL(location, currentUrl);
        currentUrl = redirectUrl.toString();
        redirectCount++;
        continue;
      }

      // Check response status
      if (!response.ok) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}` };
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        return { ok: false, status: 413, error: 'Response too large' };
      }

      // Read response body with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        return { ok: false, status: 500, error: 'No response body' };
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > maxSize) {
          reader.cancel();
          return { ok: false, status: 413, error: 'Response too large' };
        }

        chunks.push(value);
      }

      // Combine chunks and decode
      const allChunks = new Uint8Array(totalSize);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }

      const text = new TextDecoder('utf-8').decode(allChunks);

      return { ok: true, status: response.status, data: text };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { ok: false, status: 408, error: 'Request timeout' };
        }
        return { ok: false, status: 500, error: error.message };
      }
      return { ok: false, status: 500, error: 'Unknown error' };
    }
  }

  return { ok: false, status: 310, error: 'Too many redirects' };
}
