import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/redis-client", () => ({
  getRedisClient: () => ({
    get: vi.fn().mockRejectedValue(new Error("redis down")),
  }),
}));

describe("production lockout store failure", () => {
  it("fails closed instead of resetting attempts", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getLoginDelay, LockoutStoreUnavailableError } =
      await import("@/lib/auth/account-lockout");
    await expect(getLoginDelay("user@example.com")).rejects.toBeInstanceOf(
      LockoutStoreUnavailableError,
    );
  });
});
