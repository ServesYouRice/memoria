import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    modelCredential: {
      findMany: prismaMocks.findMany,
      update: prismaMocks.update,
    },
  },
}));

import { encryptSecret } from "@/lib/agents/crypto";
import {
  AI_NOT_CONFIGURED_DETAIL,
  BUILTIN_AI_CAPABILITY,
  assertSafeAiBaseUrl,
  getAiAvailability,
  resolveAiProvider,
} from "@/lib/ai/provider-resolution";
import { ServiceUnavailableError } from "@/lib/errors";

function credential(overrides: Record<string, unknown> = {}) {
  return {
    id: "cred-1",
    provider: "ANTHROPIC",
    baseUrl: null,
    defaultModel: "claude-sonnet-5-5",
    encryptedSecret: encryptSecret("sk-ant-user"),
    capabilities: [BUILTIN_AI_CAPABILITY],
    ...overrides,
  };
}

describe("AI provider lookup order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_MODEL", "");
    vi.stubEnv("ANTHROPIC_MODEL", "");
    prismaMocks.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the user's saved credential before any server key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server");
    prismaMocks.findMany.mockResolvedValue([credential()]);

    const resolved = await resolveAiProvider("user-1");

    expect(resolved).toMatchObject({
      source: "user",
      provider: "ANTHROPIC",
      model: "claude-sonnet-5-5",
      apiKey: "sk-ant-user",
      baseUrl: "https://api.anthropic.com",
      credentialId: "cred-1",
    });
    expect(resolved.adapter.id).toBe("anthropic");
    expect(prismaMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          status: { in: ["ACTIVE", "UNVERIFIED"] },
        },
      }),
    );
  });

  it("uses the provider's OpenAI-compatible endpoint when no base URL is saved", async () => {
    prismaMocks.findMany.mockResolvedValue([
      credential({ provider: "OPENROUTER", defaultModel: "openai/gpt-5.4" }),
    ]);
    const resolved = await resolveAiProvider("user-1");
    expect(resolved.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(resolved.adapter.id).toBe("openai-compatible");
  });

  it("ignores credentials not saved for built-in AI", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server");
    prismaMocks.findMany.mockResolvedValue([
      credential({ id: "agent-cred", capabilities: ["chat"] }),
    ]);
    const resolved = await resolveAiProvider("user-1");
    expect(resolved.source).toBe("env");
    expect(resolved.credentialId).toBeNull();
  });

  it("skips a saved credential that cannot be decrypted", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server");
    prismaMocks.findMany.mockResolvedValue([
      credential({ encryptedSecret: "not-a-payload" }),
    ]);
    const resolved = await resolveAiProvider("user-1");
    expect(resolved).toMatchObject({ source: "env", provider: "ANTHROPIC" });
  });

  it("falls back to OPENAI_API_KEY before ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server");
    vi.stubEnv("AI_MODEL", "gpt-5.4-mini");

    const resolved = await resolveAiProvider("user-1");

    expect(resolved).toMatchObject({
      source: "env",
      provider: "OPENAI",
      model: "gpt-5.4-mini",
      apiKey: "sk-server",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("falls back to ANTHROPIC_API_KEY with the default Claude model", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server");
    const resolved = await resolveAiProvider();
    expect(resolved).toMatchObject({
      source: "env",
      provider: "ANTHROPIC",
      model: "claude-haiku-5-5",
    });
    expect(prismaMocks.findMany).not.toHaveBeenCalled();
  });

  it("treats the placeholder dummy key as unset", async () => {
    vi.stubEnv("OPENAI_API_KEY", "dummy-key");
    await expect(resolveAiProvider("user-1")).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it("throws a clear 'AI not configured' error when nothing is set", async () => {
    const error = await resolveAiProvider("user-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ServiceUnavailableError).status).toBe(503);
    expect((error as ServiceUnavailableError).detail).toBe(
      AI_NOT_CONFIGURED_DETAIL,
    );
    expect(AI_NOT_CONFIGURED_DETAIL).toMatch(/^AI not configured/);
  });

  it("reports availability without exposing the key", async () => {
    prismaMocks.findMany.mockResolvedValue([credential()]);
    const availability = await getAiAvailability("user-1");
    expect(availability).toEqual({
      configured: true,
      source: "user",
      provider: "ANTHROPIC",
      model: "claude-sonnet-5-5",
      capabilities: {
        chat: true,
        speechToText: false,
        readImage: true,
        embeddings: false,
      },
    });
    expect(JSON.stringify(availability)).not.toContain("sk-ant-user");

    prismaMocks.findMany.mockResolvedValue([]);
    await expect(getAiAvailability("user-1")).resolves.toMatchObject({
      configured: false,
      source: null,
    });
  });
});

describe("assertSafeAiBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks loopback and private hosts by default", async () => {
    vi.stubEnv("AI_ALLOW_PRIVATE_BASE_URLS", "");
    await expect(
      assertSafeAiBaseUrl("http://127.0.0.1:11434/v1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(
      assertSafeAiBaseUrl("http://localhost:11434/v1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("allows a local endpoint when the operator opts in", async () => {
    vi.stubEnv("AI_ALLOW_PRIVATE_BASE_URLS", "true");
    await expect(
      assertSafeAiBaseUrl("http://localhost:11434/v1"),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeAiBaseUrl("ftp://localhost/v1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
