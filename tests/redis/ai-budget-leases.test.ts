/**
 * TASK-152: AI concurrency slots are expiring leases on the Redis backend
 * too, so a lost release frees its slot within the lease, not at UTC
 * midnight. Touches only its own user's keys.
 */
import { randomBytes } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { closeRedisConnection, getRedisClient } from "@/lib/cache/redis-client";
import {
  getAiUsage,
  resetAiBudgetForTests,
  runBudgetedAi,
} from "@/lib/ai/budget";

const appUrl = process.env.REDIS_ACL_TEST_URL;
if (!appUrl) {
  throw new Error("REDIS_ACL_TEST_URL is required; run `pnpm test:redis`.");
}
process.env.REDIS_URL = appUrl;

const userId = `lease-${randomBytes(6).toString("hex")}`;

async function cleanup() {
  const redis = getRedisClient();
  if (!redis) return;
  const prefix = redis.options.keyPrefix ?? "";
  const keys = await redis.keys(`${prefix}ai:*${userId}*`);
  if (keys.length > 0) {
    await redis.del(...keys.map((key) => key.slice(prefix.length)));
  }
}

describe("AI concurrency leases on Redis", () => {
  beforeEach(async () => {
    resetAiBudgetForTests();
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_MAX_CONCURRENT_PER_USER", "2");
    vi.stubEnv("NODE_ENV", "production");
    await cleanup();
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await cleanup();
  });
  afterAll(async () => {
    await closeRedisConnection();
  });

  it("frees slots whose release never happens once their leases expire", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
    for (let i = 0; i < 2; i += 1) {
      void runBudgetedAi(
        userId,
        { prompt: `stuck ${i}`, maxOutputTokens: 10 },
        () => new Promise<string>(() => undefined),
      );
    }
    await vi.waitFor(async () => {
      expect((await getAiUsage(userId)).activeRequests).toBe(2);
    });
    await expect(
      runBudgetedAi(
        userId,
        { prompt: "third", maxOutputTokens: 10 },
        async () => "third",
      ),
    ).rejects.toMatchObject({
      extensions: expect.objectContaining({ code: "AI_CONCURRENCY_BUDGET" }),
    });

    vi.setSystemTime(new Date("2026-11-11T12:10:00.000Z"));
    expect((await getAiUsage(userId)).activeRequests).toBe(0);
    await expect(
      runBudgetedAi(
        userId,
        { prompt: "after", maxOutputTokens: 10 },
        async () => "after",
      ),
    ).resolves.toMatchObject({ value: "after" });
    // A normal release frees its slot at once.
    expect((await getAiUsage(userId)).activeRequests).toBe(0);
  });
});
