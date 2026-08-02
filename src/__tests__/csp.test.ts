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
});
