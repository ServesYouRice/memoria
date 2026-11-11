/**
 * TASK-151 — a failed follow-up usage read must not discard AI output that
 * was already generated and paid for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  eval: vi.fn(async () => [0]),
  hgetall: vi.fn(async (): Promise<Record<string, string>> => {
    throw Object.assign(new Error("read timed out"), { name: "ReadError" });
  }),
  zcount: vi.fn(async () => 0),
}));
const metrics = vi.hoisted(() => ({ increment: vi.fn() }));

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => redis }));
vi.mock("@/lib/operations/runtime-metrics", () => ({
  incrementOperationalCounter: metrics.increment,
}));

import {
  getAiUsage,
  resetAiBudgetForTests,
  runBudgetedAi,
} from "@/lib/ai/budget";
import { AiBudgetStoreError } from "@/lib/ai/errors";

describe("runBudgetedAi usage read failure", () => {
  beforeEach(() => {
    resetAiBudgetForTests();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "1000");
    vi.stubEnv("AI_DAILY_COST_MICRO_USD", "1000");
    vi.stubEnv("AI_MAX_CONCURRENT_PER_USER", "1");
    vi.stubEnv("AI_MAX_PROMPT_BYTES", "1024");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAiBudgetForTests();
  });

  it("returns the generated value with usage null", async () => {
    const result = await runBudgetedAi(
      "user-a",
      { prompt: "hello", maxOutputTokens: 10 },
      async () => "generated",
    );
    expect(result).toEqual({ value: "generated", usage: null });
    expect(metrics.increment).toHaveBeenCalledWith(
      "redis_safety_failures_total",
    );
    // The lease was still released.
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it("still throws from getAiUsage when called directly", async () => {
    await expect(getAiUsage("user-a")).rejects.toBeInstanceOf(
      AiBudgetStoreError,
    );
  });

  it("still rejects on a reservation store failure", async () => {
    redis.eval.mockRejectedValueOnce(new Error("down"));
    const operation = vi.fn(async () => "never");
    await expect(
      runBudgetedAi("user-a", { prompt: "hi", maxOutputTokens: 1 }, operation),
    ).rejects.toBeInstanceOf(AiBudgetStoreError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("still rejects when the operation fails", async () => {
    await expect(
      runBudgetedAi(
        "user-a",
        { prompt: "hi", maxOutputTokens: 1 },
        async () => {
          throw new Error("provider failed");
        },
      ),
    ).rejects.toThrow("provider failed");
  });
});
