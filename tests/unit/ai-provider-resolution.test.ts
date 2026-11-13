import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    modelCredential: {
      findMany: prismaMocks.findMany,
      update: prismaMocks.update,
      updateMany: prismaMocks.updateMany,
    },
  },
}));

import { encryptSecret } from "@/lib/agents/crypto";
import {
  AI_NOT_CONFIGURED_DETAIL,
  BUILTIN_AI_CAPABILITY,
  assertSafeAiBaseUrl,
  findAiProvider,
  getAiAvailability,
  markAiCredentialRejected,
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
          capabilities: { array_contains: [BUILTIN_AI_CAPABILITY] },
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

  it("does not fall back to a server key when the saved credential cannot be decrypted", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server");
    vi.stubEnv("OPENAI_API_KEY", "sk-server");
    prismaMocks.findMany.mockResolvedValue([
      credential({ encryptedSecret: "not-a-payload" }),
    ]);
    await expect(findAiProvider("user-1")).resolves.toBeNull();
    await expect(resolveAiProvider("user-1")).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    await expect(getAiAvailability("user-1")).resolves.toMatchObject({
      configured: false,
      reason: "saved-credential-unusable",
    });
  });

  it("does not fall back to a server key for an OpenAI-compatible credential with no base URL", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server");
    prismaMocks.findMany.mockResolvedValue([
      credential({ provider: "OPENAI_COMPAT", baseUrl: null }),
    ]);
    await expect(findAiProvider("user-1")).resolves.toBeNull();
    await expect(getAiAvailability("user-1")).resolves.toMatchObject({
      configured: false,
      reason: "saved-credential-unusable",
    });
  });

  it("does not fall back to a server key when the saved credential was rejected", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server");
    // The usable-status query finds nothing; the any-status query finds the
    // rejected built-in row.
    prismaMocks.findMany.mockImplementation(
      async (args: { where: { status?: unknown } }) =>
        args.where.status
          ? []
          : [{ id: "cred-1", ...credential({ status: "ERROR" }) }],
    );
    await expect(findAiProvider("user-1")).resolves.toBeNull();
    await expect(getAiAvailability("user-1")).resolves.toMatchObject({
      configured: false,
      reason: "saved-credential-unusable",
    });
  });

  it("still uses the server key for a user with no saved built-in credential", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server");
    await expect(findAiProvider("user-1")).resolves.toMatchObject({
      source: "env",
    });
    const availability = await getAiAvailability("user-1");
    expect(availability).toMatchObject({ configured: true, source: "env" });
    expect(availability.reason).toBeUndefined();
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
    // IMP-102: the response names the set-up page so the feature links to it.
    expect((error as ServiceUnavailableError).toProblemDetail()).toMatchObject({
      code: "AI_NOT_SET_UP",
      setupUrl: "/settings/ai",
    });
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

describe("markAiCredentialRejected", () => {
  it("flags the row only while it holds the failing secret and is usable", async () => {
    prismaMocks.updateMany.mockResolvedValue({ count: 0 });
    await markAiCredentialRejected("cred-1", "fp-old");
    expect(prismaMocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cred-1",
        secretFingerprint: "fp-old",
        status: { in: ["ACTIVE", "UNVERIFIED"] },
      },
      data: { status: "ERROR" },
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
    ).resolves.toBeNull();
    await expect(
      assertSafeAiBaseUrl("ftp://localhost/v1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
