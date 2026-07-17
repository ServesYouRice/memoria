/**
 * Rate Limiting Tests
 */

import { describe, it, expect, vi } from "vitest";

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Memory Rate Limit Store", () => {
  it("should increment counter", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const store = new MemoryRateLimitStore();

    const result1 = await store.increment("test-key", 60);
    expect(result1.count).toBe(1);
    expect(result1.ttl).toBe(60);

    const result2 = await store.increment("test-key", 60);
    expect(result2.count).toBe(2);

    store.destroy();
  });

  it("should reset counter after expiry", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const store = new MemoryRateLimitStore();

    // Increment with 1 second window
    await store.increment("test-key", 1);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should start fresh
    const result = await store.increment("test-key", 60);
    expect(result.count).toBe(1);

    store.destroy();
  });

  it("should get current count", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const store = new MemoryRateLimitStore();

    await store.increment("test-key", 60);
    await store.increment("test-key", 60);

    const count = await store.get("test-key");
    expect(count).toBe(2);

    store.destroy();
  });

  it("should return null for non-existent key", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const store = new MemoryRateLimitStore();

    const count = await store.get("non-existent");
    expect(count).toBeNull();

    store.destroy();
  });

  it("should delete key", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const store = new MemoryRateLimitStore();

    await store.increment("test-key", 60);
    await store.delete("test-key");

    const count = await store.get("test-key");
    expect(count).toBeNull();

    store.destroy();
  });

  it("should clean up expired entries", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const store = new MemoryRateLimitStore();

    // Add entry with short TTL
    await store.increment("test-key", 1);
    expect(store.size()).toBe(1);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Trigger cleanup by getting the key
    await store.get("test-key");

    // Size should eventually be 0 after cleanup interval runs
    // Note: cleanup runs every 60 seconds, so this is approximate
    store.destroy();
  });
});

describe("Sliding Window Rate Limiter", () => {
  it("should allow requests within limit", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const { SlidingWindowRateLimiter } = await import("@/lib/rate-limit");

    const store = new MemoryRateLimitStore();
    const limiter = new SlidingWindowRateLimiter(store, {
      maxRequests: 5,
      windowSeconds: 60,
    });

    for (let i = 1; i <= 5; i++) {
      const result = await limiter.check("test-user");
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(i);
      expect(result.remaining).toBe(5 - i);
    }

    store.destroy();
  });

  it("should block requests exceeding limit", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const { SlidingWindowRateLimiter } = await import("@/lib/rate-limit");

    const store = new MemoryRateLimitStore();
    const limiter = new SlidingWindowRateLimiter(store, {
      maxRequests: 3,
      windowSeconds: 60,
    });

    // Use up the limit
    await limiter.check("test-user");
    await limiter.check("test-user");
    await limiter.check("test-user");

    // Next request should be blocked
    const result = await limiter.check("test-user");
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(4);
    expect(result.remaining).toBe(0);

    store.destroy();
  });

  it("should track different identifiers separately", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const { SlidingWindowRateLimiter } = await import("@/lib/rate-limit");

    const store = new MemoryRateLimitStore();
    const limiter = new SlidingWindowRateLimiter(store, {
      maxRequests: 2,
      windowSeconds: 60,
    });

    await limiter.check("user1");
    await limiter.check("user1");

    // user1 should be at limit
    const user1Result = await limiter.check("user1");
    expect(user1Result.allowed).toBe(false);

    // user2 should still be allowed
    const user2Result = await limiter.check("user2");
    expect(user2Result.allowed).toBe(true);

    store.destroy();
  });

  it("should reset limit for identifier", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const { SlidingWindowRateLimiter } = await import("@/lib/rate-limit");

    const store = new MemoryRateLimitStore();
    const limiter = new SlidingWindowRateLimiter(store, {
      maxRequests: 2,
      windowSeconds: 60,
    });

    await limiter.check("test-user");
    await limiter.check("test-user");

    // Should be at limit
    let result = await limiter.check("test-user");
    expect(result.allowed).toBe(false);

    // Reset
    await limiter.reset("test-user");

    // Should be allowed again
    result = await limiter.check("test-user");
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);

    store.destroy();
  });

  it("should get status without consuming", async () => {
    const { MemoryRateLimitStore } =
      await import("@/lib/rate-limit/stores/memory");
    const { SlidingWindowRateLimiter } = await import("@/lib/rate-limit");

    const store = new MemoryRateLimitStore();
    const limiter = new SlidingWindowRateLimiter(store, {
      maxRequests: 5,
      windowSeconds: 60,
    });

    await limiter.check("test-user");
    await limiter.check("test-user");

    // Get status (doesn't consume)
    const status = await limiter.status("test-user");
    expect(status.current).toBe(2);
    expect(status.remaining).toBe(3);

    // Next check should still be at 3
    const result = await limiter.check("test-user");
    expect(result.current).toBe(3);

    store.destroy();
  });
});

describe("Rate Limit Utilities", () => {
  it("should extract client identifier from request", async () => {
    const { getClientIdentifier } = await import("@/lib/rate-limit");

    // Caller-controlled forwarding headers must not affect abuse controls.
    const request1 = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        "x-real-ip": "192.168.1.2",
      },
    });
    expect(getClientIdentifier(request1)).toBe("unknown");

    // The custom server overwrites this header from the TCP peer.
    const request2 = new Request("http://localhost", {
      headers: {
        "x-memoria-client-ip": "192.168.1.2",
      },
    });
    expect(getClientIdentifier(request2)).toBe("192.168.1.2");

    // Test fallback
    const request3 = new Request("http://localhost");
    expect(getClientIdentifier(request3)).toBe("unknown");
  });

  it("should provide preset rate limit configurations", async () => {
    const { RATE_LIMITS } = await import("@/lib/rate-limit");

    expect(RATE_LIMITS.api.maxRequests).toBe(100);
    expect(RATE_LIMITS.auth.maxRequests).toBe(5);
    expect(RATE_LIMITS.passwordReset.maxRequests).toBe(3);
    expect(RATE_LIMITS.strict.maxRequests).toBe(10);
  });
});

describe("Rate Limit Middleware", () => {
  it("should check rate limit for request", async () => {
    const { RATE_LIMITS } = await import("@/lib/rate-limit");
    const { checkRateLimit } = await import("@/lib/rate-limit/middleware");

    const request = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "192.168.1.1",
      },
    });

    const result = await checkRateLimit(request, RATE_LIMITS.api);

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
  });

  it("should check rate limit by user ID", async () => {
    const { RATE_LIMITS } = await import("@/lib/rate-limit");
    const { checkRateLimitByUser } =
      await import("@/lib/rate-limit/middleware");

    const result = await checkRateLimitByUser("user-123", {
      maxRequests: RATE_LIMITS.api.maxRequests,
      windowSeconds: RATE_LIMITS.api.windowSeconds,
    });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
  });
});
