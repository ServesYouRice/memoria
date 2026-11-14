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
        "SENTRY_BROWSER_DSN",
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
      vi.stubEnv("SENTRY_BROWSER_DSN", "");

      expect(directive(buildCSP("n"), "connect-src")).toEqual([
        "'self'",
        "ws://localhost:3000",
      ]);
    });

    it("falls back to NEXTAUTH_URL and skips unusable values", () => {
      vi.stubEnv("AUTH_URL", undefined as unknown as string);
      vi.stubEnv("NEXTAUTH_URL", "https://legacy.example.com");
      vi.stubEnv("SENTRY_BROWSER_DSN", "not a url");

      expect(directive(buildCSP("n"), "connect-src")).toEqual([
        "'self'",
        "wss://legacy.example.com",
      ]);
    });

    describe("direct upload bucket (IMP-152)", () => {
      function s3(endpoint: string) {
        vi.stubEnv("AUTH_URL", "https://memoria.example.com");
        vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
        vi.stubEnv("UPLOAD_STORAGE", "s3");
        vi.stubEnv("UPLOAD_DIRECT_UPLOADS", "");
        vi.stubEnv("S3_BUCKET", "memoria-uploads");
        vi.stubEnv("S3_REGION", "eu-central-1");
        vi.stubEnv("S3_ENDPOINT", endpoint);
        vi.stubEnv("S3_PUBLIC_ENDPOINT", "");
      }

      it("lets the browser PUT to an R2 bucket's own host", () => {
        s3("https://0123abcd.r2.cloudflarestorage.com");
        expect(directive(buildCSP("n"), "connect-src")).toEqual([
          "'self'",
          "wss://memoria.example.com",
          "https://memoria-uploads.0123abcd.r2.cloudflarestorage.com",
        ]);
      });

      it("uses the endpoint origin of a path-style store", () => {
        s3("https://s3.memoria.example.com/");
        expect(directive(buildCSP("n"), "connect-src")).toContain(
          "https://s3.memoria.example.com",
        );
      });

      it("prefers the browser-facing S3_PUBLIC_ENDPOINT", () => {
        s3("http://seaweedfs:8333");
        vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://files.memoria.example.com");
        const connect = directive(buildCSP("n"), "connect-src");
        expect(connect).toContain("https://files.memoria.example.com");
        expect(connect).not.toContain("http://seaweedfs:8333");
      });

      it("names the regional AWS bucket host without an endpoint", () => {
        s3("");
        expect(directive(buildCSP("n"), "connect-src")).toContain(
          "https://memoria-uploads.s3.eu-central-1.amazonaws.com",
        );
      });

      it("adds nothing with local storage or direct uploads off", () => {
        s3("https://s3.memoria.example.com");
        vi.stubEnv("UPLOAD_DIRECT_UPLOADS", "false");
        expect(directive(buildCSP("n"), "connect-src")).toEqual([
          "'self'",
          "wss://memoria.example.com",
        ]);
        vi.stubEnv("UPLOAD_DIRECT_UPLOADS", "");
        vi.stubEnv("UPLOAD_STORAGE", "local");
        expect(directive(buildCSP("n"), "connect-src")).toEqual([
          "'self'",
          "wss://memoria.example.com",
        ]);
      });
    });

    it("names the public upload bucket in img-src", () => {
      vi.stubEnv("UPLOADS_PUBLIC_URL", "https://cdn.memoria.example.com/up");

      const img = directive(buildCSP("n"), "img-src");

      expect(img).toContain("https://cdn.memoria.example.com");
      expect(img).toContain("'self'");
      // Remote images load through the same-origin image proxy (IMP-057),
      // so no scheme-wide source remains.
      expect(img).not.toContain("https:");
      expect(img).not.toContain("http:");
    });
  });
});
