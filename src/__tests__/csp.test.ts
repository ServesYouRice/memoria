import { describe, it, expect } from 'vitest';
import { buildCSP, generateNonce } from '../middleware/csp';

describe('CSP Middleware', () => {
  describe('generateNonce', () => {
    it('should generate a nonce', () => {
      const nonce = generateNonce();
      expect(nonce).toBeTruthy();
      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBeGreaterThan(0);
    });

    it('should generate unique nonces', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('buildCSP', () => {
    it('should build a valid CSP string', () => {
      const nonce = 'test-nonce-123';
      const csp = buildCSP(nonce);

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("'nonce-test-nonce-123'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
    });

    it('should not allow unsafe-inline in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const csp = buildCSP('nonce');
      expect(csp).not.toContain("'unsafe-inline'");

      process.env.NODE_ENV = originalEnv;
    });

    it('should not allow unsafe-eval in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const csp = buildCSP('nonce');
      expect(csp).not.toContain("'unsafe-eval'");

      process.env.NODE_ENV = originalEnv;
    });

    it('should include strict-dynamic in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const csp = buildCSP('nonce');
      expect(csp).toContain("'strict-dynamic'");

      process.env.NODE_ENV = originalEnv;
    });
  });
});
