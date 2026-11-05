import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelProvider } from "@/generated/prisma/enums";

const mocks = vi.hoisted(() => ({ findAiProvider: vi.fn() }));
vi.mock("@/lib/ai/provider-resolution", () => ({
  findAiProvider: mocks.findAiProvider,
  assertSafeAiBaseUrl: vi.fn(),
}));

import {
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  embedText,
  embeddingModelFor,
} from "@/lib/ai/embeddings";
import { resetAiBudgetForTests } from "@/lib/ai/budget";
import {
  anthropicAdapter,
  openAiCompatibleAdapter,
  type AiProviderAdapter,
} from "@/lib/ai/providers";
import type { ResolvedAiProvider } from "@/lib/ai/provider-resolution";

function resolved(
  provider: ModelProvider,
  adapter: AiProviderAdapter = openAiCompatibleAdapter,
): ResolvedAiProvider {
  return {
    source: "env",
    provider,
    model: "chat-model",
    apiKey: "sk",
    baseUrl: "https://api.openai.com/v1",
    credentialId: null,
    adapter,
    capabilities: adapter.capabilities,
  };
}

beforeEach(() => {
  resetAiBudgetForTests();
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_EMBEDDING_MODEL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("embeddingModelFor", () => {
  it("uses OpenAI's default model and needs a configured one elsewhere", () => {
    expect(embeddingModelFor(resolved(ModelProvider.OPENAI))).toBe(
      DEFAULT_OPENAI_EMBEDDING_MODEL,
    );
    expect(embeddingModelFor(resolved(ModelProvider.GEMINI))).toBeNull();
    expect(
      embeddingModelFor(resolved(ModelProvider.ANTHROPIC, anthropicAdapter)),
    ).toBeNull();
    vi.stubEnv("AI_EMBEDDING_MODEL", "nomic-embed-text");
    expect(embeddingModelFor(resolved(ModelProvider.OPENAI_COMPAT))).toBe(
      "nomic-embed-text",
    );
  });
});

describe("embedText", () => {
  it("returns not-configured without a provider that can embed", async () => {
    mocks.findAiProvider.mockResolvedValue(
      resolved(ModelProvider.ANTHROPIC, anthropicAdapter),
    );
    await expect(embedText({ userId: "u1", text: "hi" })).resolves.toEqual({
      ok: false,
      reason: "not-configured",
    });
  });

  it("embeds within the AI budget and skips quietly when it is spent", async () => {
    const provider = resolved(ModelProvider.OPENAI);
    mocks.findAiProvider.mockResolvedValue(provider);
    const embed = vi
      .spyOn(openAiCompatibleAdapter, "embed")
      .mockResolvedValue([[0.1, 0.2]]);
    await expect(embedText({ userId: "u1", text: "hi" })).resolves.toEqual({
      ok: true,
      provider: "OPENAI",
      model: DEFAULT_OPENAI_EMBEDDING_MODEL,
      vector: [0.1, 0.2],
    });
    expect(embed).toHaveBeenCalledWith(provider, {
      model: DEFAULT_OPENAI_EMBEDDING_MODEL,
      input: ["hi"],
      signal: undefined,
    });

    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "1");
    await expect(embedText({ userId: "u2", text: "hi" })).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
