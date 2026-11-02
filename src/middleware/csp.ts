import { type NextResponse } from "next/server";
import { nanoid } from "nanoid";

/**
 * Generate a nonce for CSP
 */
export function generateNonce(): string {
  return nanoid(32);
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The WebSocket origin of the app itself. Browsers that follow CSP Level 3
 * already let 'self' cover same-host ws/wss, but older engines do not, so the
 * collaboration (/api/collaboration/*) and sync sockets are named explicitly.
 */
function appSocketOrigin(): string | null {
  const origin = originOf(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL);
  return origin ? origin.replace(/^http/, "ws") : null;
}

/** The Sentry ingest host the browser SDK posts envelopes to, if enabled. */
function sentryIngestOrigin(): string | null {
  return originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);
}

/** A public upload bucket (S3/R2) that serves images straight to browsers. */
function publicUploadsOrigin(): string | null {
  return originOf(process.env.UPLOADS_PUBLIC_URL);
}

function present(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

/**
 * Build a strict Content Security Policy with nonce-based script/style allowlist
 * Following ADR-0002: Nonce-Based Strict CSP
 */
export function buildCSP(
  nonce: string,
  frameAncestors: readonly string[] = ["'none'"],
): string {
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
    // Remote images (favicons, link previews, image items, avatars) load
    // through the same-origin /api/v1/image-proxy (IMP-057), so img-src never
    // lists a scheme-wide https:. Only a public upload bucket is added.
    "img-src": present(["'self'", "data:", "blob:", publicUploadsOrigin()]),
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    // Browser code only talks to this app (HTTP and its WebSockets) and,
    // when configured, Sentry. No other host may receive data.
    "connect-src": present(["'self'", appSocketOrigin(), sentryIngestOrigin()]),
    "frame-ancestors": frameAncestors.length > 0 ? frameAncestors : ["'none'"],
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
export function applyCSP(
  response: NextResponse,
  nonce: string,
  frameAncestors?: readonly string[],
): void {
  response.headers.set("x-nonce", nonce);
  const csp = buildCSP(nonce, frameAncestors);
  response.headers.set("Content-Security-Policy", csp);
}
