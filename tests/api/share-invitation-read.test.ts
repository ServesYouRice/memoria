import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fingerprintSecret } from "@/lib/agents/crypto";

const authMocks = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const prismaMocks = vi.hoisted(() => ({
  invitationFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: authMocks.requireAuth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvasShareInvitation: {
      findUnique: prismaMocks.invitationFindUnique,
    },
    user: { findUnique: prismaMocks.userFindUnique },
  },
}));
vi.mock("@/lib/outbox/enqueue", () => ({ enqueueOutboxJob: vi.fn() }));

import { GET } from "@/app/api/v1/share-invitations/[token]/route";

describe("share invitation details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireAuth.mockResolvedValue({ userId: "recipient-1" });
    prismaMocks.invitationFindUnique.mockResolvedValue({
      email: "recipient@example.com",
      role: "EDIT",
      respondedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      canvas: { name: "Launch plan" },
      invitedBy: { name: "Ada", email: "ada@example.com" },
    });
  });

  it("returns invitation context to the verified matching recipient", async () => {
    const token = "raw-invitation-token";
    prismaMocks.userFindUnique.mockResolvedValue({
      email: "recipient@example.com",
      emailVerified: new Date(),
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/share-invitations/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      canvasName: "Launch plan",
      inviterName: "Ada",
      role: "EDIT",
      expiresAt: expect.any(String),
    });
    expect(prismaMocks.invitationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: fingerprintSecret(token) },
      }),
    );
  });

  it("does not reveal invitation details to a different account", async () => {
    const token = "raw-invitation-token";
    prismaMocks.userFindUnique.mockResolvedValue({
      email: "someone-else@example.com",
      emailVerified: new Date(),
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/share-invitations/${token}`),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("Launch plan");
  });
});
