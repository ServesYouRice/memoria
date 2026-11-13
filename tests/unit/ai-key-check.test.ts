/**
 * IMP-102 — the one small request that tests a saved key, and the plain
 * reason it gives when the key does not work.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  runBudgetedAi: vi.fn(),
  assertSafeAiBaseUrl: vi.fn(),
}));

vi.mock("@/lib/ai/budget", () => ({ runBudgetedAi: mocks.runBudgetedAi }));
vi.mock("@/lib/ai/provider-resolution", () => ({
  assertSafeAiBaseUrl: mocks.assertSafeAiBaseUrl,
}));
vi.mock("@/lib/ai/providers", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getAiAdapter: () => ({ generateText: mocks.generateText }),
  };
});

import {
  AI_KEY_MESSAGES,
  checkAiKey,
  classifyKeyCheckError,
} from "@/lib/ai/key-check";
import { AiUpstreamError, hintFromErrorBody } from "@/lib/ai/providers";
import { AiBudgetError } from "@/lib/ai/errors";

const upstream = (status: number, hint?: "credit" | "model") =>
  new AiUpstreamError("openai-compatible", status, "x", null, hint);

afterEach(() => vi.clearAllMocks());

describe("classifyKeyCheckError (IMP-102)", () => {
  it.each([
    [upstream(401), "wrong-key"],
    [upstream(403), "wrong-key"],
    [upstream(402), "no-credit"],
    [upstream(429, "credit"), "no-credit"],
    [upstream(400, "credit"), "no-credit"],
    [upstream(404, "model"), "model-unavailable"],
    [upstream(400, "model"), "model-unavailable"],
    [upstream(404), "wrong-address"],
    [upstream(0), "wrong-address"],
    [upstream(429), "busy"],
    [upstream(503), "busy"],
    [upstream(400), "unknown"],
    [new AiBudgetError("AI_TOKEN_BUDGET", "used up", 60), "not-tested"],
    [new Error("boom"), "unknown"],
  ])("%s → %s", (error, problem) => {
    expect(classifyKeyCheckError(error)).toBe(problem);
  });

  it("reads only a reason word from a provider's error body", () => {
    const body = (text: string) => Buffer.from(text);
    expect(
      hintFromErrorBody(
        body('{"error":{"type":"insufficient_quota","message":"..."}}'),
      ),
    ).toBe("credit");
    expect(
      hintFromErrorBody(
        body('{"error":{"message":"Your credit balance is too low"}}'),
      ),
    ).toBe("credit");
    expect(
      hintFromErrorBody(
        body('{"error":{"message":"The model `gpt-9` does not exist"}}'),
      ),
    ).toBe("model");
    expect(hintFromErrorBody(body('{"error":"bad request"}'))).toBeUndefined();
    expect(hintFromErrorBody(null)).toBeUndefined();
  });
});

describe("checkAiKey (IMP-102)", () => {
  it("sends one tiny fixed request through the AI budget", async () => {
    mocks.runBudgetedAi.mockImplementation(
      async (_user: string, _input: unknown, run: () => Promise<unknown>) => ({
        value: await run(),
        usage: null,
      }),
    );
    mocks.generateText.mockResolvedValue("OK");

    const result = await checkAiKey({
      userId: "user-1",
      provider: "OPENAI",
      model: "gpt-5.4-mini",
      apiKey: "sk-test",
      baseUrl: null,
    });

    expect(result).toEqual({ ok: true, message: AI_KEY_MESSAGES.ok });
    expect(mocks.runBudgetedAi).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ maxOutputTokens: 5 }),
      expect.any(Function),
    );
    const [config, request] = mocks.generateText.mock.calls[0]!;
    expect(config).toMatchObject({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(request.maxTokens).toBe(5);
    expect(mocks.assertSafeAiBaseUrl).not.toHaveBeenCalled();
  });

  it("runs the address safety test on a custom address and stops there if it fails", async () => {
    mocks.assertSafeAiBaseUrl.mockRejectedValue(new Error("private"));
    const result = await checkAiKey({
      userId: "user-1",
      provider: "OPENAI_COMPAT",
      model: "custom",
      apiKey: "k",
      baseUrl: "http://10.0.0.5/v1",
    });
    expect(result).toMatchObject({ ok: false, problem: "wrong-address" });
    expect(mocks.runBudgetedAi).not.toHaveBeenCalled();
  });

  it("gives the plain reason when the provider refuses", async () => {
    mocks.runBudgetedAi.mockImplementation(
      async (_user: string, _input: unknown, run: () => Promise<unknown>) => ({
        value: await run(),
        usage: null,
      }),
    );
    mocks.generateText.mockRejectedValue(upstream(401));
    const result = await checkAiKey({
      userId: "user-1",
      provider: "ANTHROPIC",
      model: "claude-haiku-5-5",
      apiKey: "bad",
      baseUrl: null,
    });
    expect(result).toEqual({
      ok: false,
      problem: "wrong-key",
      message: AI_KEY_MESSAGES["wrong-key"],
    });
    expect(JSON.stringify(result)).not.toContain("bad");
  });
});
