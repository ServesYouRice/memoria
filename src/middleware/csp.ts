import { type NextResponse } from "next/server";
import { nanoid } from "nanoid";

/**
 * Generate a nonce for CSP
 */
export function generateNonce(): string {
  return nanoid(32);
}

/**
 * Build a strict Content Security Policy with nonce-based script/style allowlist
 * Following ADR-0002: Nonce-Based Strict CSP
 */
export function buildCSP(nonce: string): string {
  const directives = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'nonce-" + nonce + "'",
      ...(process.env.NODE_ENV === "development"
        ? ["'unsafe-eval'"]
        : ["'strict-dynamic'"]),
    ],
    "style-src": ["'self'", "'nonce-" + nonce + "'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "connect-src": ["'self'", "wss:", "https:"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "report-uri": ["/api/csp-report"],
  };

  return Object.entries(directives)
    .map(([key, values]) => {
      if (Array.isArray(values) && values.length === 0) {
        return key;
      }
      return key + " " + values.join(" ");
    })
    .join("; ");
}

/**
 * Middleware to add CSP header with nonce
 */
export function applyCSP(response: NextResponse, nonce: string): void {
  response.headers.set("x-nonce", nonce);
  const csp = buildCSP(nonce);
  response.headers.set("Content-Security-Policy", csp);
}
