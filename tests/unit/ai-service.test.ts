import { beforeEach, describe, expect, it, vi } from "vitest";

const resolutionMocks = vi.hoisted(() => ({
  resolveAiProvider: vi.fn(),
  markAiCredentialRejected: vi.fn(),
  assertSafeAiBaseUrl: vi.fn(),
}));

vi.mock("@/lib/ai/provider-resolution", () => resolutionMocks);

import { generateTags, generateText, summarizeCanvas } from "@/lib/ai/service";
import { AiUpstreamError } from "@/lib/ai/providers";
import { AiProviderError } from "@/lib/ai/errors";
import { ServiceUnavailableError } from "@/lib/errors";

function resolved(overrides: Record<string, unknown> = {}) {
  const adapter = {
    id: "anthropic",
    capabilities: {},
    generateText: vi.fn().mockResolvedValue("hello"),
  };
  return {
    source: "user",
    provider: "ANTHROPIC",
    model: "claude-sonnet-5-5",
    apiKey: "sk-ant",
    baseUrl: "https://api.anthropic.com",
    credentialId: "cred-1",
    adapter,
    capabilities: adapter.capabilities,
    ...overrides,
  };
}

describe("generateText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the user's provider and calls its adapter", async () => {
    const provider = resolved();
    resolutionMocks.resolveAiProvider.mockResolvedValue(provider);

    await expect(
      generateText({ prompt: "Hi", system: "Sys", userId: "user-1" }),
    ).resolves.toBe("hello");

    expect(resolutionMocks.resolveAiProvider).toHaveBeenCalledWith("user-1");
    expect(resolutionMocks.assertSafeAiBaseUrl).not.toHaveBeenCalled();
    expect(provider.adapter.generateText).toHaveBeenCalledWith(provider, {
      prompt: "Hi",
      system: "Sys",
      temperature: 0.7,
      maxTokens: 500,
      signal: undefined,
    });
  });

  it("validates a custom saved base URL before calling it", async () => {
    resolutionMocks.resolveAiProvider.mockResolvedValue(
      resolved({
        provider: "OPENAI_COMPAT",
        baseUrl: "https://llm.example.com/v1",
      }),
    );
    resolutionMocks.assertSafeAiBaseUrl.mockRejectedValue(
      new ServiceUnavailableError("blocked"),
    );

    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(resolutionMocks.assertSafeAiBaseUrl).toHaveBeenCalledWith(
      "https://llm.example.com/v1",
    );
  });

  it("propagates 'AI not configured'", async () => {
    resolutionMocks.resolveAiProvider.mockRejectedValue(
      new ServiceUnavailableError("AI not configured."),
    );
    await expect(generateText({ prompt: "Hi" })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it("flags a saved key the provider rejects", async () => {
    const provider = resolved();
    provider.adapter.generateText.mockRejectedValue(
      new AiUpstreamError("anthropic", 401, "Provider returned HTTP 401"),
    );
    resolutionMocks.resolveAiProvider.mockResolvedValue(provider);

    const error = await generateText({ prompt: "Hi", userId: "user-1" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).detail).toMatch(/Settings/);
    expect(resolutionMocks.markAiCredentialRejected).toHaveBeenCalledWith(
      "cred-1",
    );
  });

  it("maps other upstream failures to a 502 without flagging the key", async () => {
    const provider = resolved();
    provider.adapter.generateText.mockRejectedValue(
      new AiUpstreamError("anthropic", 529, "Provider returned HTTP 529"),
    );
    resolutionMocks.resolveAiProvider.mockResolvedValue(provider);

    await expect(
      generateText({ prompt: "Hi", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 502 });
    expect(resolutionMocks.markAiCredentialRejected).not.toHaveBeenCalled();
  });

  it("passes the user through tags and summaries", async () => {
    const provider = resolved();
    provider.adapter.generateText.mockResolvedValue("a, b");
    resolutionMocks.resolveAiProvider.mockResolvedValue(provider);

    await expect(generateTags("content", "user-2")).resolves.toEqual([
      "a",
      "b",
    ]);
    await summarizeCanvas(
      [{ type: "NOTE", content: { text: "note" } }],
      "user-3",
    );
    expect(resolutionMocks.resolveAiProvider).toHaveBeenNthCalledWith(
      1,
      "user-2",
    );
    expect(resolutionMocks.resolveAiProvider).toHaveBeenNthCalledWith(
      2,
      "user-3",
    );
  });
});
