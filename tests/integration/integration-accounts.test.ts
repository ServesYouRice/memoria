import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

import { prisma } from "@/lib/db";
import { POST } from "@/app/api/agent/v1/integrations/route";

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedUser() {
  const user = await prisma.user.create({
    data: { email: `integ-${randomBytes(6).toString("hex")}@example.com` },
  });
  return user;
}

async function seedProfile(userId: string) {
  return prisma.agentProfile.create({ data: { userId, name: "Agent" } });
}

async function createAccount(
  user: { id: string; email: string },
  agentProfileId: string,
  externalAccountId: string,
) {
  mocks.auth.mockResolvedValue({
    user: { id: user.id, email: user.email },
  });
  const response = await POST(
    new NextRequest("http://localhost:3000/api/agent/v1/integrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentProfileId,
        providerType: "WEBHOOK",
        externalAccountId,
      }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

describe("POST /api/agent/v1/integrations uniqueness", () => {
  it("scopes external account ids to the agent profile and returns 409 on a same-profile duplicate", async () => {
    const url = `https://hooks.example.com/${randomBytes(6).toString("hex")}`;
    const alice = await seedUser();
    const bob = await seedUser();
    const aliceProfile = await seedProfile(alice.id);
    const aliceSecondProfile = await seedProfile(alice.id);
    const bobProfile = await seedProfile(bob.id);

    expect((await createAccount(alice, aliceProfile.id, url)).status).toBe(201);
    // A different user registering the same URL is not blocked.
    expect((await createAccount(bob, bobProfile.id, url)).status).toBe(201);
    // A second profile of the same user is not blocked.
    expect(
      (await createAccount(alice, aliceSecondProfile.id, url)).status,
    ).toBe(201);

    const duplicate = await createAccount(alice, aliceProfile.id, url);
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).toContain(
      "This agent profile already has that integration account.",
    );
    expect(JSON.stringify(duplicate.body)).not.toContain(bob.email);
  });
});

describe("POST /api/agent/v1/integrations webhook signing secret", () => {
  it("signs webhooks with a dedicated secret, not the bearer token", async () => {
    const { decryptSecret } = await import("@/lib/agents/crypto");
    const user = await seedUser();
    const profile = await seedProfile(user.id);
    const created = await createAccount(
      user,
      profile.id,
      `https://hooks.example.com/${randomBytes(6).toString("hex")}`,
    );
    expect(created.status).toBe(201);
    const plaintextToken: string = created.body.plaintextToken;
    const webhookSigningSecret: string = created.body.webhookSigningSecret;
    expect(typeof webhookSigningSecret).toBe("string");
    expect(webhookSigningSecret).not.toBe(plaintextToken);

    const row = await prisma.integrationAccount.findUniqueOrThrow({
      where: { id: created.body.integrationAccount.id },
    });
    const cursor = row.replayCursor as Record<string, unknown>;
    const stored = decryptSecret(cursor.outboundSigningSecret as string);
    expect(stored).toBe(webhookSigningSecret);
    // No reversible copy of the bearer token is kept anywhere in the cursor.
    for (const value of Object.values(cursor)) {
      if (typeof value !== "string") continue;
      let decrypted: string | null = null;
      try {
        decrypted = decryptSecret(value);
      } catch {
        decrypted = null;
      }
      expect(decrypted).not.toBe(plaintextToken);
    }
    expect(created.body.integrationAccount).not.toHaveProperty("replayCursor");
  });

  it("returns no signing secret for non-webhook accounts", async () => {
    const user = await seedUser();
    const profile = await seedProfile(user.id);
    mocks.auth.mockResolvedValue({ user: { id: user.id, email: user.email } });
    const response = await POST(
      new NextRequest("http://localhost:3000/api/agent/v1/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentProfileId: profile.id,
          providerType: "OPENCLAW",
          externalAccountId: `oc-${randomBytes(4).toString("hex")}`,
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).not.toHaveProperty("webhookSigningSecret");
  });
});
