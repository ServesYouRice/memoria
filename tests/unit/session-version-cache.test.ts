import { beforeEach, describe, expect, it, vi } from "vitest";

const { redis, findUnique } = vi.hoisted(() => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
  findUnique: vi.fn(),
}));

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => redis }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import {
  getCachedSessionVersion,
  invalidateSessionVersion,
  SESSION_VERSION_CACHE_SECONDS,
} from "@/lib/api/session-cache";

describe("session-version cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.set.mockResolvedValue("OK");
    redis.del.mockResolvedValue(1);
  });

  it("uses a valid cached version without querying PostgreSQL", async () => {
    redis.get.mockResolvedValue("7");
    await expect(getCachedSessionVersion("user-1")).resolves.toBe(7);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("repairs malformed cache data from PostgreSQL with the declared TTL", async () => {
    redis.get.mockResolvedValue("not-a-version");
    findUnique.mockResolvedValue({ sessionVersion: 3 });
    await expect(getCachedSessionVersion("user-1")).resolves.toBe(3);
    expect(redis.set).toHaveBeenCalledWith(
      "session-version:user-1",
      "3",
      "EX",
      SESSION_VERSION_CACHE_SECONDS,
    );
  });

  it("invalidates the shared version immediately", async () => {
    await invalidateSessionVersion("user-1");
    expect(redis.del).toHaveBeenCalledWith("session-version:user-1");
  });
});
