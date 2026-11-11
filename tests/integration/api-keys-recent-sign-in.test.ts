import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const current = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => current.session) }));

import { POST as createApiKey } from "@/app/api/v1/api-keys/route";
import { POST as changePassword } from "@/app/api/v1/users/change-password/route";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { generateApiKey } from "@/lib/api/api-key";
import { createCredentialAccount } from "@/lib/auth/credentials";
import { hashPassword } from "@/lib/auth/password";

afterAll(async () => {
  await prisma.$disconnect();
});

const MINUTE = 60_000;

async function signIn(ageMs: number) {
  const email = `keys-${randomBytes(6).toString("hex")}@example.com`;
  const user = await prisma.user.create({ data: { email } });
  const session = await prisma.session.create({
    data: {
      token: randomBytes(24).toString("hex"),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * MINUTE),
      createdAt: new Date(Date.now() - ageMs),
    },
  });
  current.session = {
    user: { id: user.id, email },
    session: { id: session.id, userId: user.id, expiresAt: session.expiresAt },
  };
  return user;
}

const createRequest = (body: unknown) =>
  createApiKey(
    new NextRequest("http://localhost/api/v1/api-keys", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    undefined as never,
  );

describe("POST /api/v1/api-keys requires a recent sign-in", () => {
  it("creates a key, also a never-expiring one, for a session signed in minutes ago", async () => {
    const user = await signIn(5 * MINUTE);
    const response = await createRequest({ name: "Extension" });
    expect(response.status).toBe(201);
    const key = await prisma.apiKey.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(key.expiresAt).toBeNull();
  });

  it("rejects a session older than the window with a stable code and creates nothing", async () => {
    const user = await signIn(16 * MINUTE);
    const response = await createRequest({ name: "Extension" });
    expect(response.status).toBe(403);
    const problem = await response.json();
    expect(problem.code).toBe("recent_sign_in_required");
    expect(problem.detail).toMatch(/sign in again/i);
    expect(await prisma.apiKey.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rejects a session whose row is gone", async () => {
    const user = await signIn(0);
    await prisma.session.deleteMany({ where: { userId: user.id } });
    const response = await createRequest({ name: "Extension" });
    expect(response.status).toBe(403);
    expect(await prisma.apiKey.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("change-password and API keys", () => {
  it("revokes the user's live API keys with the password change", async () => {
    const user = await signIn(0);
    await createCredentialAccount(
      prisma,
      user.id,
      await hashPassword("Old-Horse-Battery-Staple-17"),
    );
    const { key, hash } = await generateApiKey();
    const earlier = new Date("2026-01-01T00:00:00Z");
    await prisma.apiKey.createMany({
      data: [
        {
          key: hash,
          keyPrefix: key.slice(0, 7),
          keySuffix: key.slice(-4),
          name: "live",
          userId: user.id,
        },
        {
          key: (await generateApiKey()).hash,
          name: "revoked earlier",
          userId: user.id,
          revokedAt: earlier,
        },
      ],
    });
    const withKey = () =>
      new NextRequest("http://localhost/api/v1/canvases", {
        headers: { "x-api-key": key },
      });
    expect(await authenticateApiKey(withKey())).not.toBeNull();

    const response = await changePassword(
      new NextRequest("http://localhost/api/v1/users/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: "Old-Horse-Battery-Staple-17",
          newPassword: "Correct-Horse-Battery-Staple-91",
        }),
      }),
    );
    expect(response.status).toBe(200);

    expect(await authenticateApiKey(withKey())).toBeNull();
    const keys = await prisma.apiKey.findMany({ where: { userId: user.id } });
    expect(keys.every((entry) => entry.revokedAt !== null)).toBe(true);
    expect(
      keys.find((entry) => entry.name === "revoked earlier")?.revokedAt,
    ).toEqual(earlier);
  });
});
