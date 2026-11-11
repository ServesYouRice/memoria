import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

import { prisma } from "@/lib/db";
import { DELETE } from "@/app/api/v1/canvases/[canvasId]/share/[shareId]/route";

afterAll(async () => {
  await prisma.$disconnect();
});

const hex = () => randomBytes(6).toString("hex");

async function seed() {
  const owner = await prisma.user.create({
    data: { email: `owner-${hex()}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Shared", userId: owner.id },
  });
  const invitation = await prisma.canvasShareInvitation.create({
    data: {
      canvasId: canvas.id,
      invitedById: owner.id,
      email: `guest-${hex()}@example.com`,
      role: "EDIT",
      tokenHash: hex(),
      deliverySecret: hex(),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  mocks.auth.mockResolvedValue({
    user: { id: owner.id, email: owner.email },
  });
  return { owner, canvas, invitation };
}

function revoke(canvasId: string, shareId: string) {
  return DELETE(
    new NextRequest(
      `http://localhost:3000/api/v1/canvases/${canvasId}/share/${shareId}`,
      { method: "DELETE" },
    ),
    { params: Promise.resolve({ canvasId, shareId }) },
  );
}

describe("DELETE /api/v1/canvases/[canvasId]/share/[shareId] invitation revoke", () => {
  it("still revokes a pending invitation", async () => {
    const { canvas, invitation } = await seed();
    const response = await revoke(canvas.id, invitation.id);
    expect(response.status).toBe(200);
    const row = await prisma.canvasShareInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(row.response).toBe("REVOKED");
  });

  it("refuses to report success when a concurrent acceptance commits first", async () => {
    const { canvas, invitation } = await seed();

    let revokeResponse: Promise<Response> | null = null;
    await prisma.$transaction(async (tx) => {
      // Mirror the acceptance route: lock the invitation, answer it and
      // create the share, then commit while the revoke is in flight.
      await tx.$queryRaw`SELECT 1 FROM "CanvasShareInvitation" WHERE "id" = ${invitation.id} FOR UPDATE`;
      await tx.canvasShareInvitation.update({
        where: { id: invitation.id },
        data: { respondedAt: new Date(), response: "ACCEPTED" },
      });
      await tx.canvasShare.create({
        data: {
          canvasId: canvas.id,
          email: invitation.email,
          role: invitation.role,
        },
      });
      revokeResponse = revoke(canvas.id, invitation.id);
      // Let the revoke read the still-pending row and block on the lock.
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    const response = await revokeResponse!;
    expect(response.status).toBeGreaterThanOrEqual(400);
    const row = await prisma.canvasShareInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(row.response).toBe("ACCEPTED");
    expect(
      await prisma.canvasShare.count({ where: { canvasId: canvas.id } }),
    ).toBe(1);
  });

  it("returns 404 for an unknown share id", async () => {
    const { canvas } = await seed();
    const response = await revoke(canvas.id, "c" + hex());
    expect(response.status).toBe(404);
  });
});
