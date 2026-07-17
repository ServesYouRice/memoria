import { afterEach, describe, expect, it } from "vitest";

import { shouldApplyStrictAuthRateLimit } from "@/middleware/auth-rate-limit";
import { isOriginAllowed, validateCorsConfig } from "@/middleware/cors";
import { SlidingWindowRateLimiter } from "@/lib/rate-limit";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("request-boundary security", () => {
  it("matches wildcard CORS entries only at a subdomain boundary", () => {
    expect(isOriginAllowed("https://app.example.com", ["*.example.com"])).toBe(
      true,
    );
    expect(
      isOriginAllowed("https://deep.app.example.com", ["*.example.com"]),
    ).toBe(true);
    expect(isOriginAllowed("https://example.com", ["*.example.com"])).toBe(
      false,
    );
    expect(isOriginAllowed("https://notexample.com", ["*.example.com"])).toBe(
      false,
    );
  });

  it("rejects malformed origins instead of suffix matching raw text", () => {
    expect(isOriginAllowed("not-a-url.example.com", ["*.example.com"])).toBe(
      false,
    );
  });

  it("refuses wildcard credentials in production", () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGINS = "*";
    process.env.CORS_ALLOW_CREDENTIALS = "true";

    expect(() => validateCorsConfig()).toThrow(/cannot allow credentials/i);
  });

  it("limits credential mutations but not Auth.js background reads", () => {
    expect(
      shouldApplyStrictAuthRateLimit("/api/auth/callback/credentials", "POST"),
    ).toBe(true);
    expect(
      shouldApplyStrictAuthRateLimit("/api/v1/auth/reset-password", "POST"),
    ).toBe(true);
    expect(shouldApplyStrictAuthRateLimit("/api/auth/session", "GET")).toBe(
      false,
    );
    expect(shouldApplyStrictAuthRateLimit("/api/auth/providers", "GET")).toBe(
      false,
    );
    expect(shouldApplyStrictAuthRateLimit("/api/auth/csrf", "GET")).toBe(false);
  });

  it("fails closed in production when the shared limiter is unavailable", async () => {
    process.env.NODE_ENV = "production";
    const unavailableStore = {
      increment: async () => {
        throw new Error("Redis unavailable");
      },
      get: async () => null,
      delete: async () => undefined,
    };
    const limiter = new SlidingWindowRateLimiter(unavailableStore, {
      maxRequests: 5,
      windowSeconds: 60,
    });

    await expect(limiter.check("client-1")).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });
});
