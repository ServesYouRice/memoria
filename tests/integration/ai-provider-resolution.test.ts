import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/agents/crypto";
import {
  BUILTIN_AI_CAPABILITY,
  findAiProvider,
} from "@/lib/ai/provider-resolution";

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
});
