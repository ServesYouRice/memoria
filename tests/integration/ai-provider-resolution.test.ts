import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/agents/crypto";
import {
  BUILTIN_AI_CAPABILITY,
  findAiProvider,
  getAiAvailability,
  markAiCredentialRejected,
} from "@/lib/ai/provider-resolution";
import { generateText } from "@/lib/ai/service";

async function seedBuiltin(secret: string) {
  const user = await prisma.user.create({
    data: { email: `ai-${randomBytes(6).toString("hex")}@example.com` },
  });
  return prisma.modelCredential.create({
    data: {
      userId: user.id,
      provider: "OPENAI",
      label: "Built-in AI",
      defaultModel: "gpt-4o-mini",
      encryptedSecret: encryptSecret(secret),
      secretFingerprint: `fp-${secret}`,
      capabilities: [BUILTIN_AI_CAPABILITY],
      status: "ACTIVE",
    },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("built-in AI credential lookup", () => {
  it("finds the tagged credential behind more than 25 newer agent credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const user = await prisma.user.create({
      data: { email: `ai-${randomBytes(6).toString("hex")}@example.com` },
    });
    const builtin = await prisma.modelCredential.create({
      data: {
        userId: user.id,
        provider: "OPENAI",
        label: "Built-in AI",
        defaultModel: "gpt-4o-mini",
        encryptedSecret: encryptSecret("sk-builtin"),
        secretFingerprint: "fp-builtin",
        capabilities: [BUILTIN_AI_CAPABILITY],
        status: "ACTIVE",
        updatedAt: new Date(Date.now() - 60_000),
      },
    });
    for (let index = 0; index < 30; index += 1) {
      await prisma.modelCredential.create({
        data: {
          userId: user.id,
          provider: "OPENAI",
          label: `Agent ${index}`,
          defaultModel: "gpt-4o-mini",
          encryptedSecret: encryptSecret(`sk-agent-${index}`),
          secretFingerprint: `fp-agent-${index}`,
          status: "UNVERIFIED",
        },
      });
    }

    const resolved = await findAiProvider(user.id);

    expect(resolved).toMatchObject({
      source: "user",
      credentialId: builtin.id,
      apiKey: "sk-builtin",
    });
    vi.unstubAllEnvs();
  });

  it("does not use the server key when the saved built-in credential was rejected", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server");
    const user = await prisma.user.create({
      data: { email: `ai-${randomBytes(6).toString("hex")}@example.com` },
    });
    await prisma.modelCredential.create({
      data: {
        userId: user.id,
        provider: "OPENAI",
        label: "Built-in AI",
        defaultModel: "gpt-4o-mini",
        encryptedSecret: encryptSecret("sk-rejected"),
        secretFingerprint: "fp-rejected",
        capabilities: [BUILTIN_AI_CAPABILITY],
        status: "ERROR",
      },
    });

    await expect(findAiProvider(user.id)).resolves.toBeNull();
    await expect(getAiAvailability(user.id)).resolves.toMatchObject({
      configured: false,
      reason: "saved-credential-unusable",
    });
    vi.unstubAllEnvs();
  });

  it("keeps the saved key on a provider 403 and flags it on a 401", async () => {
    const credential = await seedBuiltin(`sk-${randomBytes(4).toString("hex")}`);
    const respond = vi.fn(async () => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", respond);
    try {
      await expect(
        generateText({ prompt: "Hi", userId: credential.userId }),
      ).rejects.toMatchObject({ status: 502 });
      await expect(
        prisma.modelCredential.findUniqueOrThrow({ where: { id: credential.id } }),
      ).resolves.toMatchObject({ status: "ACTIVE" });

      respond.mockImplementation(async () => new Response("{}", { status: 401 }));
      await expect(
        generateText({ prompt: "Hi", userId: credential.userId }),
      ).rejects.toMatchObject({ status: 502 });
      await expect(
        prisma.modelCredential.findUniqueOrThrow({ where: { id: credential.id } }),
      ).resolves.toMatchObject({ status: "ERROR" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not flag a replacement key when a late rejection names the old one", async () => {
    const credential = await seedBuiltin(`sk-${randomBytes(4).toString("hex")}`);
    const resolved = await findAiProvider(credential.userId);
    expect(resolved?.credentialId).toBe(credential.id);

    await prisma.modelCredential.update({
      where: { id: credential.id },
      data: {
        encryptedSecret: encryptSecret("sk-replacement"),
        secretFingerprint: `fp-replacement-${credential.id}`,
        status: "UNVERIFIED",
      },
    });
    await markAiCredentialRejected(resolved!.credentialId!, resolved!.secretFingerprint!);

    await expect(
      prisma.modelCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).resolves.toMatchObject({ status: "UNVERIFIED" });
  });
});
