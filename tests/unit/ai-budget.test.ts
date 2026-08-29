import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAiUsage,
  resetAiBudgetForTests,
  runBudgetedAi,
} from "@/lib/ai/budget";
import { AiDisabledError } from "@/lib/ai/errors";
import type { AiBudgetError } from "@/lib/ai/errors";

describe("AI resource budgets", () => {
  beforeEach(() => {
    resetAiBudgetForTests();
    vi.stubEnv("REDIS_URL", "");
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

  it("reserves a worst-case token and cost allowance before execution", async () => {
    const result = await runBudgetedAi(
      "user-a",
      { prompt: "12345678", maxOutputTokens: 10 },
      async () => "ok",
    );

    expect(result.value).toBe("ok");
    expect(result.usage.tokensUsed).toBe(12);
    expect(result.usage.costMicroUsdUsed).toBeGreaterThan(0);
    expect((await getAiUsage("user-a")).activeRequests).toBe(0);
  });

  it("atomically rejects a second request at the per-user concurrency limit", async () => {
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const first = runBudgetedAi(
      "user-a",
      { prompt: "first", maxOutputTokens: 10 },
      async () => {
        await firstGate;
        return "first";
      },
    );
    await vi.waitFor(async () => {
      expect((await getAiUsage("user-a")).activeRequests).toBe(1);
    });

    await expect(
      runBudgetedAi(
        "user-a",
        { prompt: "second", maxOutputTokens: 10 },
        async () => "second",
      ),
    ).rejects.toMatchObject<Partial<AiBudgetError>>({
      status: 429,
      extensions: expect.objectContaining({ code: "AI_CONCURRENCY_BUDGET" }),
    });

    resolveFirst();
    await expect(first).resolves.toMatchObject({ value: "first" });
    expect((await getAiUsage("user-a")).rejections).toBe(1);
  });

  it("releases concurrency even when the provider fails", async () => {
    await expect(
      runBudgetedAi(
        "user-a",
        { prompt: "failure", maxOutputTokens: 10 },
        async () => {
          throw new Error("provider failed");
        },
      ),
    ).rejects.toThrow("provider failed");

    expect((await getAiUsage("user-a")).activeRequests).toBe(0);
  });

  it("enforces the operator switch before executing user code", async () => {
    vi.stubEnv("AI_ENABLED", "false");
    const operation = vi.fn();

    await expect(
      runBudgetedAi(
        "user-a",
        { prompt: "hello", maxOutputTokens: 10 },
        operation,
      ),
    ).rejects.toBeInstanceOf(AiDisabledError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("rejects prompts above the configured byte ceiling", async () => {
    vi.stubEnv("AI_MAX_PROMPT_BYTES", "4");

    await expect(
      runBudgetedAi(
        "user-a",
        { prompt: "12345", maxOutputTokens: 1 },
        async () => "never",
      ),
    ).rejects.toMatchObject<Partial<AiBudgetError>>({ status: 429 });
  });
});
