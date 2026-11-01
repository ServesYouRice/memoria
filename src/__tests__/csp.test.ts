import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCSP, generateNonce } from "../middleware/csp";

describe("CSP Middleware", () => {
  describe("generateNonce", () => {
    it("should generate a nonce", () => {
      const nonce = generateNonce();
      expect(nonce).toBeTruthy();
      expect(typeof nonce).toBe("string");
      expect(nonce.length).toBeGreaterThan(0);
    });

    it("should generate unique nonces", () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe("buildCSP", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env["NODE_ENV"];
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        vi.stubEnv("NODE_ENV", originalEnv);
      } else {
        vi.unstubAllEnvs();
      }
    });

    it("should build a valid CSP string", () => {
      const nonce = "test-nonce-123";
      const csp = buildCSP(nonce);

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("'nonce-test-nonce-123'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
    });

    it("should not allow unsafe-inline in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      const csp = buildCSP("nonce");
      expect(csp).not.toContain("'unsafe-inline'");
    });

    it("should not allow unsafe-eval in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      const csp = buildCSP("nonce");
      expect(csp).not.toContain("'unsafe-eval'");
    });

    it("should include strict-dynamic in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      const csp = buildCSP("nonce");
      expect(csp).toContain("'strict-dynamic'");
    });
  });

  describe("allowed origins", () => {
    function directive(csp: string, name: string): string[] {
      const entry = csp.split("; ").find((part) => part.startsWith(name + " "));
      return entry ? entry.split(" ").slice(1) : [];
    }

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("limits connect-src to the app, its sockets and Sentry ingest", () => {
      vi.stubEnv("AUTH_URL", "https://memoria.example.com/");
      vi.stubEnv(
        "NEXT_PUBLIC_SENTRY_DSN",
        "https://publickey@o123.ingest.de.sentry.io/456",
      );

      const connect = directive(buildCSP("n"), "connect-src");

      expect(connect).toEqual([
        "'self'",
        "wss://memoria.example.com",
        "https://o123.ingest.de.sentry.io",
      ]);
      expect(connect).not.toContain("https:");
      expect(connect).not.toContain("wss:");
      expect(connect.join(" ")).not.toContain("publickey");
    });

    it("uses a plain ws origin for a local http app", () => {
      vi.stubEnv("AUTH_URL", "http://localhost:3000");
      vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");

      expect(directive(buildCSP("n"), "connect-src")).toEqual([
        "'self'",
        "ws://localhost:3000",
      ]);
    });

    it("falls back to NEXTAUTH_URL and skips unusable values", () => {
      vi.stubEnv("AUTH_URL", undefined as unknown as string);
      vi.stubEnv("NEXTAUTH_URL", "https://legacy.example.com");
      vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "not a url");

      expect(directive(buildCSP("n"), "connect-src")).toEqual([
        "'self'",
        "wss://legacy.example.com",
      ]);
    });

    it("names the public upload bucket in img-src", () => {
      vi.stubEnv("UPLOADS_PUBLIC_URL", "https://cdn.memoria.example.com/up");

      const img = directive(buildCSP("n"), "img-src");

      expect(img).toContain("https://cdn.memoria.example.com");
      expect(img).toContain("'self'");
      // Bookmark previews and external image items still load third-party
      // HTTPS images; plain http and ws hosts stay blocked.
      expect(img).toContain("https:");
      expect(img).not.toContain("http:");
    });
  });
});
