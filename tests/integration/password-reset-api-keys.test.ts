import { createHash, randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { generateApiKey } from "@/lib/api/api-key";

afterAll(async () => {
  await prisma.$disconnect();
});

async function createKey(userId: string, revokedAt: Date | null = null) {
  const { key, hash } = await generateApiKey();
  await prisma.apiKey.create({
    data: {
      key: hash,
      keyPrefix: key.slice(0, 7),
      keySuffix: key.slice(-4),
      name: "integration",
      userId,
      revokedAt,
    },
  });
  return key;
}

const withKey = (key: string) =>
  new NextRequest("http://localhost/api/v1/canvases", {
    headers: { "x-api-key": key },
  });

describe("password reset and API keys", () => {
  it("revokes the user's live API keys in the reset transaction", async () => {
    const email = `reset-keys-${randomBytes(6).toString("hex")}@example.com`;
    const user = await prisma.user.create({ data: { email } });
    const other = await prisma.user.create({
      data: { email: `other-${randomBytes(6).toString("hex")}@example.com` },
    });
    const liveKey = await createKey(user.id);
    const earlier = new Date("2026-01-01T00:00:00Z");
    await createKey(user.id, earlier);
    const otherKey = await createKey(other.id);
    expect(await authenticateApiKey(withKey(liveKey))).not.toBeNull();

    const token = randomBytes(24).toString("hex");
    await prisma.passwordResetToken.create({
      data: {
        token: createHash("sha256").update(token).digest("hex"),
        email,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const response = await resetPassword(
      new NextRequest("http://localhost/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          token,
          password: "Correct-Horse-Battery-Staple-91",
        }),
      }),
    );
    expect(response.status).toBe(200);

    expect(await authenticateApiKey(withKey(liveKey))).toBeNull();
    const keys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(keys.every((key) => key.revokedAt !== null)).toBe(true);
    // An already-revoked key keeps its original revokedAt.
    expect(
      keys.some((key) => key.revokedAt?.getTime() === earlier.getTime()),
    ).toBe(true);
    // Other users' keys are untouched.
    expect(await authenticateApiKey(withKey(otherKey))).not.toBeNull();
  });
});
