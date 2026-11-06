import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const authMocks = vi.hoisted(() => ({ auth: vi.fn() }));

const prismaMocks = vi.hoisted(() => {
  const modelCredential = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return {
    modelCredential,
    agentProfileCount: vi.fn(),
    transaction: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: authMocks.auth }));

vi.mock("@/lib/db", () => ({
  prisma: {
    modelCredential: prismaMocks.modelCredential,
    agentProfile: { count: prismaMocks.agentProfileCount },
    $transaction: prismaMocks.transaction,
  },
}));

import { DELETE, GET, PUT } from "@/app/api/v1/ai/provider/route";
import { decryptSecret, fingerprintSecret } from "@/lib/agents/crypto";
import { BUILTIN_AI_CAPABILITY } from "@/lib/ai/provider-resolution";

function createRequest(method: string, body?: unknown): NextRequest {
  const url = "http://localhost/api/v1/ai/provider";
  const req = new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

const savedRow = {
  id: "cred-1",
  provider: "ANTHROPIC",
  baseUrl: null,
  defaultModel: "claude-sonnet-5-5",
  capabilities: [BUILTIN_AI_CAPABILITY],
  status: "UNVERIFIED",
  lastVerifiedAt: null,
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  encryptedSecret: "v1.secret-ciphertext",
};

describe("/api/v1/ai/provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    authMocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    prismaMocks.modelCredential.findMany.mockResolvedValue([]);
    prismaMocks.modelCredential.findFirst.mockResolvedValue(null);
    prismaMocks.transaction.mockImplementation(
      async (run: (tx: unknown) => Promise<unknown>) =>
        run({ modelCredential: prismaMocks.modelCredential }),
    );
  });

  it("requires a session", async () => {
    authMocks.auth.mockResolvedValue(null);
    expect((await GET(createRequest("GET"), {} as never)).status).toBe(401);
    expect(
      (
        await PUT(
          createRequest("PUT", {
            provider: "OPENAI",
            model: "gpt-5.4-mini",
            apiKey: "sk",
          }),
          {} as never,
        )
      ).status,
    ).toBe(401);
    expect(prismaMocks.modelCredential.create).not.toHaveBeenCalled();
  });

  it("lists providers and the saved choice without any key material", async () => {
    prismaMocks.modelCredential.findMany.mockResolvedValue([savedRow]);

    const res = await GET(createRequest("GET"), {} as never);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain("secret-ciphertext");
    expect(text).not.toContain("encryptedSecret");
    const body = JSON.parse(text);
    expect(body.current).toMatchObject({
      provider: "ANTHROPIC",
      model: "claude-sonnet-5-5",
      hasKey: true,
    });
    const anthropic = body.providers.find(
      (p: { provider: string }) => p.provider === "ANTHROPIC",
    );
    expect(anthropic.suggestedModels).toEqual([
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-haiku-5-5",
    ]);
  });

  it("encrypts and tags a newly saved key", async () => {
    prismaMocks.modelCredential.create.mockResolvedValue({ id: "cred-new" });

    const res = await PUT(
      createRequest("PUT", {
        provider: "ANTHROPIC",
        model: "claude-opus-5-5",
        apiKey: "sk-ant-new",
      }),
      {} as never,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("sk-ant-new");
    const data = prismaMocks.modelCredential.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "user-1",
      provider: "ANTHROPIC",
      defaultModel: "claude-opus-5-5",
      baseUrl: null,
      secretFingerprint: fingerprintSecret("sk-ant-new"),
      capabilities: [BUILTIN_AI_CAPABILITY],
      status: "UNVERIFIED",
    });
    expect(data.encryptedSecret).not.toContain("sk-ant-new");
    expect(decryptSecret(data.encryptedSecret)).toBe("sk-ant-new");
  });

  it("reuses an existing row with the same key instead of violating the unique index", async () => {
    prismaMocks.modelCredential.findFirst.mockResolvedValue({
      id: "agent-cred",
      capabilities: ["chat"],
    });

    await PUT(
      createRequest("PUT", {
        provider: "OPENAI",
        model: "gpt-5.4-mini",
        apiKey: "sk-shared",
      }),
      {} as never,
    );

    expect(prismaMocks.modelCredential.create).not.toHaveBeenCalled();
    expect(prismaMocks.modelCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-cred" },
        data: expect.objectContaining({
          capabilities: ["chat", BUILTIN_AI_CAPABILITY],
        }),
      }),
    );
  });

  it("updates the model without a new key only for the same provider", async () => {
    prismaMocks.modelCredential.findMany.mockResolvedValue([savedRow]);

    const ok = await PUT(
      createRequest("PUT", {
        provider: "ANTHROPIC",
        model: "claude-haiku-5-5",
      }),
      {} as never,
    );
    expect(ok.status).toBe(200);
    expect(prismaMocks.modelCredential.update).toHaveBeenCalledWith({
      where: { id: "cred-1" },
      data: { defaultModel: "claude-haiku-5-5", baseUrl: null },
    });

    const switched = await PUT(
      createRequest("PUT", { provider: "OPENAI", model: "gpt-5.4" }),
      {} as never,
    );
    expect(switched.status).toBe(400);
  });

  it("requires a key when nothing is saved yet", async () => {
    const res = await PUT(
      createRequest("PUT", { provider: "OPENAI", model: "gpt-5.4" }),
      {} as never,
    );
    expect(res.status).toBe(400);
  });

  it("rejects OpenAI-compatible providers without a base URL and private base URLs", async () => {
    const missing = await PUT(
      createRequest("PUT", {
        provider: "OPENAI_COMPAT",
        model: "llama3",
        apiKey: "k",
      }),
      {} as never,
    );
    expect(missing.status).toBe(400);

    vi.stubEnv("AI_ALLOW_PRIVATE_BASE_URLS", "");
    const privateUrl = await PUT(
      createRequest("PUT", {
        provider: "OPENAI_COMPAT",
        model: "llama3",
        baseUrl: "http://169.254.169.254/v1",
        apiKey: "k",
      }),
      {} as never,
    );
    expect(privateUrl.status).toBe(400);
    expect(prismaMocks.modelCredential.create).not.toHaveBeenCalled();
  });

  it("deletes the saved key unless an agent profile still uses it", async () => {
    prismaMocks.modelCredential.findMany.mockResolvedValue([savedRow]);
    prismaMocks.agentProfileCount.mockResolvedValue(0);

    expect((await DELETE(createRequest("DELETE"), {} as never)).status).toBe(
      200,
    );
    expect(prismaMocks.modelCredential.delete).toHaveBeenCalledWith({
      where: { id: "cred-1" },
    });

    vi.clearAllMocks();
    prismaMocks.modelCredential.findMany.mockResolvedValue([savedRow]);
    prismaMocks.agentProfileCount.mockResolvedValue(1);
    await DELETE(createRequest("DELETE"), {} as never);
    expect(prismaMocks.modelCredential.delete).not.toHaveBeenCalled();
    expect(prismaMocks.modelCredential.update).toHaveBeenCalledWith({
      where: { id: "cred-1" },
      data: { capabilities: [] },
    });
  });
});
