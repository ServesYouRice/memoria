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

function isPrivateIpv4Octets([a, b, c]: number[]): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  if (a! >= 224) return true;
  if (a === 100 && b! >= 64 && b! <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  return false;
}

function isPrivateIpv4Hextets(high: number, low: number): boolean {
  return isPrivateIpv4Octets([high >> 8, high & 255, low >> 8, low & 255]);
}

/**
 * The eight 16-bit groups of a valid IPv6 address, expanding `::` and a
 * trailing dotted quad. Null when the text does not parse.
 */
function expandIpv6(address: string): number[] | null {
  let text = address;
  const tail: number[] = [];
  if (text.includes(".")) {
    const split = text.lastIndexOf(":");
    const quad = text.slice(split + 1);
    if (net.isIP(quad) !== 4) return null;
    const [a, b, c, d] = quad.split(".").map((part) => parseInt(part, 10));
    tail.push((a! << 8) | b!, (c! << 8) | d!);
    text = text.slice(0, split + 1);
    if (!text.endsWith("::")) text = text.slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string | undefined) =>
    part ? part.split(":").map((group) => parseInt(group, 16)) : [];
  const head = groups(halves[0]);
  const rest = groups(halves[1]);
  const wanted = 8 - tail.length;
  const zeros = wanted - head.length - rest.length;
  if (halves.length === 1 ? zeros !== 0 : zeros < 0) return null;
  const hextets = [...head, ...Array<number>(zeros).fill(0), ...rest, ...tail];
  if (
    hextets.length !== 8 ||
    hextets.some((group) => !Number.isInteger(group) || group < 0)
  )
    return null;
  return hextets;
}

export function isPrivateIp(address: string): boolean {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map((part) => parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }
    return isPrivateIpv4Octets(parts);
  }

  if (net.isIP(address) === 6) {
    // A zone id names an interface, which no public address needs.
    if (address.includes("%")) return true;
    const h = expandIpv6(address.toLowerCase());
    if (!h) return true;
    const zeroUntil = (end: number) => h.slice(0, end).every((g) => g === 0);
    // ::, ::1 and IPv4-compatible ::/96.
    if (zeroUntil(6)) return true;
    // IPv4-mapped ::ffff:0:0/96.
    if (zeroUntil(5) && h[5] === 0xffff)
      return isPrivateIpv4Hextets(h[6]!, h[7]!);
    const first = h[0]!;
    if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((first & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
    if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
    // NAT64 64:ff9b::/96 and 6to4 2002::/16 reach the embedded IPv4 address.
    if (first === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((g) => !g))
      return isPrivateIpv4Hextets(h[6]!, h[7]!);
    if (first === 0x2002) return isPrivateIpv4Hextets(h[1]!, h[2]!);
    return false;
  }

  return true;
}

export async function validateUrlForSsrfWithDns(urlString: string): Promise<{
  valid: boolean;
  error?: string;
  pinnedIp?: string;
  targetUrl?: URL;
}> {
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
    body?: string | Buffer;
    timeout?: number;
    maxSize?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  rawBody: Buffer;
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
      // `status` lets callers keep status-based error mapping for an
      // oversized error body.
      const tooLarge = () =>
        Object.assign(new Error("Response too large"), {
          status: res.statusCode || 0,
        });
      const contentLength = res.headers["content-length"];
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        req.destroy();
        return reject(tooLarge());
      }

      let totalSize = 0;
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          req.destroy();
          return reject(tooLarge());
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
          rawBody: bodyBuffer,
        });
      });

      res.on("error", (err) => reject(err));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.on("error", (err) => reject(err));

    const abort = () => req.destroy(new Error("Request aborted"));
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    req.once("close", () =>
      options.signal?.removeEventListener("abort", abort),
    );

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export interface SafeFetchOptions {
  maxRedirects?: number;
  timeout?: number;
  maxSize?: number;
  signal?: AbortSignal;
  /** Extra request headers, e.g. an `Accept` suited to the expected body. */
  headers?: Record<string, string>;
  /**
   * Wall-clock limit for the whole fetch: DNS checks and every redirect hop.
   * `timeout` only fires when the socket is idle, so a server that drips
   * bytes would otherwise hold the request open. Defaults to
   * `timeout * (maxRedirects + 1)`.
   */
  deadlineMs?: number;
}

/**
 * Settle with `promise`, or reject with "Request aborted" as soon as `signal`
 * aborts. For work that cannot itself be cancelled, such as dns.lookup.
 */
export function raceAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Request aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Request aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Fetch a URL with SSRF protection and connection pinning, keeping the body
 * as raw bytes. Follows redirects but validates and pins each redirect URL.
 */
export async function safeFetchBuffer(
  urlString: string,
  options: SafeFetchOptions = {},
): Promise<{
  ok: boolean;
  status: number;
  body?: Buffer;
  headers?: http.IncomingHttpHeaders;
  error?: string;
}> {
  const {
    maxRedirects = 5,
    timeout = 10000,
    maxSize = 1024 * 1024,
    signal,
    headers,
    deadlineMs = timeout * (maxRedirects + 1),
  } = options; // 1MB default max size

  const deadline = AbortSignal.timeout(deadlineMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const aborted = () =>
    signal?.aborted
      ? { ok: false, status: 499, error: "Request aborted" }
      : { ok: false, status: 408, error: "Request timeout" };

  let currentUrl = urlString;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    // Validate current URL and resolve pinned IP
    if (combined.aborted) return aborted();
    let validation: Awaited<ReturnType<typeof validateUrlForSsrfWithDns>>;
    try {
      validation = await raceAbortSignal(
        validateUrlForSsrfWithDns(currentUrl),
        combined,
      );
    } catch {
      return aborted();
    }
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
          signal: combined,
          headers,
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

      return {
        ok: true,
        status: response.status,
        body: response.rawBody,
        headers: response.headers,
      };
    } catch (error) {
      if (combined.aborted) return aborted();
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

/**
 * Fetch a URL with SSRF protection and connection pinning
 * Follows redirects but validates and pins each redirect URL
 */
export async function safeFetch(
  urlString: string,
  options: Omit<SafeFetchOptions, "headers"> = {},
): Promise<{ ok: boolean; status: number; data?: string; error?: string }> {
  const result = await safeFetchBuffer(urlString, options);
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error };
  }
  return {
    ok: true,
    status: result.status,
    data: (result.body ?? Buffer.alloc(0)).toString("utf8"),
  };
}
