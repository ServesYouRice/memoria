/**
 * SSRF (Server-Side Request Forgery) Protection Utilities
 *
 * Implements ADR-0003: SSRF-Protected Unfurling
 * Prevents malicious URLs from accessing internal resources with pinned DNS lookups
 */

import { URL } from "url";
import { promises as dns } from "dns";
import net from "net";
import http from "http";
import https from "https";

// Private IP ranges to block
const PRIVATE_IP_PATTERNS = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^127\./, // 127.0.0.0/8 (localhost)
  /^169\.254\./, // 169.254.0.0/16 (link-local)
  /^0\./, // 0.0.0.0/8
  /^224\./, // 224.0.0.0/4 (multicast)
  /^240\./, // 240.0.0.0/4 (reserved)
  /^255\.255\.255\.255$/, // broadcast
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = ["localhost", "0.0.0.0"];

/**
 * Check if a hostname is a private/internal IP or hostname
 */
function isPrivateOrLocalHost(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  // Check for blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    return true;
  }

  if (net.isIP(hostname)) {
    return isPrivateIp(hostname);
  }

  // Check for private IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  // Check for IPv6 localhost
  if (hostname === "::1" || hostname === "::ffff:127.0.0.1") {
    return true;
  }

  // Check for IPv6 link-local (fe80::/10)
  if (hostname.toLowerCase().startsWith("fe80:")) {
    return true;
  }

  // Check for IPv6 unique local addresses (fc00::/7)
  if (
    hostname.toLowerCase().startsWith("fc") ||
    hostname.toLowerCase().startsWith("fd")
  ) {
    return true;
  }

  return false;
}

export function isPrivateIp(address: string): boolean {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map((part) => parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }

    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::1") return true;
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.replace("::ffff:", "");
      const ipv4 = mapped.includes(".")
        ? mapped
        : (() => {
            const [high, low] = mapped
              .split(":")
              .map((part) => parseInt(part, 16));
            if (!Number.isFinite(high) || !Number.isFinite(low))
              return "invalid";
            return `${high! >> 8}.${high! & 255}.${low! >> 8}.${low! & 255}`;
          })();
      return isPrivateIp(ipv4);
    }
    return false;
  }

  return true;
}

export async function validateUrlForSsrfWithDns(
  urlString: string,
): Promise<{ valid: boolean; error?: string; pinnedIp?: string; targetUrl?: URL }> {
  const base = validateUrlForSsrf(urlString);
  if (!base.valid) {
    return base;
  }

  const url = new URL(urlString);
  const hostname = url.hostname.toLowerCase();

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return {
        valid: false,
        error: "Cannot fetch URLs from private or local addresses",
      };
    }
    return { valid: true, pinnedIp: hostname, targetUrl: url };
  }

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) {
      return { valid: false, error: "Hostname did not resolve" };
    }

    for (const record of records) {
      if (isPrivateIp(record.address)) {
        return { valid: false, error: "Resolved to a private address" };
      }
    }

    return { valid: true, pinnedIp: records[0].address, targetUrl: url };
  } catch {
    return { valid: false, error: "Hostname resolution failed" };
  }
}

/**
 * Validate a URL for SSRF protection
 * Returns true if the URL is safe to fetch
 */
export function validateUrlForSsrf(urlString: string): {
  valid: boolean;
  error?: string;
} {
  try {
    const url = new URL(urlString);

    // Only allow HTTP and HTTPS
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        valid: false,
        error: "Only HTTP and HTTPS protocols are allowed",
      };
    }

    // Check hostname
    const hostname = url.hostname.toLowerCase();

    // Check for private/internal addresses
    if (isPrivateOrLocalHost(hostname)) {
      return {
        valid: false,
        error: "Cannot fetch URLs from private or local addresses",
      };
    }

    // Check for suspicious userinfo in URL (e.g., http://user:pass@example.com)
    if (url.username || url.password) {
      return {
        valid: false,
        error: "URLs with authentication are not allowed",
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

/**
 * Execute an HTTP request pinned to a validated IP to prevent DNS rebinding TOCTOU attacks
 */
export function pinnedHttpRequest(
  targetUrl: URL,
  pinnedIp: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    maxSize?: number;
  } = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  ok: boolean;
}> {
  return new Promise((resolve, reject) => {
    const isHttps = targetUrl.protocol === "https:";
    const lib = isHttps ? https : http;
    const isIpv6 = net.isIP(pinnedIp) === 6;
    const timeout = options.timeout ?? 10000;
    const maxSize = options.maxSize ?? 1024 * 1024;

    const reqOptions: http.RequestOptions = {
      protocol: targetUrl.protocol,
      hostname: isIpv6 ? `[${pinnedIp}]` : pinnedIp,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: options.method || "GET",
      headers: {
        Host: targetUrl.host,
        "User-Agent": "Memoria/1.0 (Link Preview Bot)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...options.headers,
      },
      lookup: (_hostname, _opts, callback) => {
        callback(null, pinnedIp, net.isIP(pinnedIp));
      },
      timeout,
    };

    if (isHttps) {
      (reqOptions as https.RequestOptions).servername = targetUrl.hostname;
    }

    const req = lib.request(reqOptions, (res) => {
      const contentLength = res.headers["content-length"];
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        req.destroy();
        return reject(new Error("Response too large"));
      }

      let totalSize = 0;
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          req.destroy();
          return reject(new Error("Response too large"));
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode || 200,
          ok: (res.statusCode || 200) >= 200 && (res.statusCode || 200) < 300,
          headers: res.headers,
          body: bodyBuffer.toString("utf8"),
        });
      });

      res.on("error", (err) => reject(err));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.on("error", (err) => reject(err));

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Fetch a URL with SSRF protection and connection pinning
 * Follows redirects but validates and pins each redirect URL
 */
export async function safeFetch(
  urlString: string,
  options: {
    maxRedirects?: number;
    timeout?: number;
    maxSize?: number;
  } = {},
): Promise<{ ok: boolean; status: number; data?: string; error?: string }> {
  const { maxRedirects = 5, timeout = 10000, maxSize = 1024 * 1024 } = options; // 1MB default max size

  let currentUrl = urlString;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    // Validate current URL and resolve pinned IP
    const validation = await validateUrlForSsrfWithDns(currentUrl);
    if (!validation.valid || !validation.pinnedIp || !validation.targetUrl) {
      return { ok: false, status: 400, error: validation.error };
    }

    try {
      const response = await pinnedHttpRequest(
        validation.targetUrl,
        validation.pinnedIp,
        {
          timeout,
          maxSize,
        },
      );

      // Handle redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers["location"];
        if (!location || typeof location !== "string") {
          return {
            ok: false,
            status: response.status,
            error: "Redirect without location header",
          };
        }

        // Resolve relative URLs
        const redirectUrl = new URL(location, currentUrl);
        currentUrl = redirectUrl.toString();
        redirectCount++;
        continue;
      }

      // Check response status
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}`,
        };
      }

      return { ok: true, status: response.status, data: response.body };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("timeout")) {
          return { ok: false, status: 408, error: "Request timeout" };
        }
        if (error.message.includes("too large")) {
          return { ok: false, status: 413, error: "Response too large" };
        }
        return { ok: false, status: 500, error: error.message };
      }
      return { ok: false, status: 500, error: "Unknown error" };
    }
  }

  return { ok: false, status: 310, error: "Too many redirects" };
}
