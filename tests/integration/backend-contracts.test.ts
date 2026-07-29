import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/agents/crypto";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ ...authState }),
  requireCanvasAccess: async () => ({ accessLevel: "OWNER" }),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { POST as applyCommand } from "@/app/api/v1/canvas-items/commands/route";
import { POST as createInvitation } from "@/app/api/v1/canvases/[canvasId]/share/route";
import { POST as answerInvitation } from "@/app/api/v1/share-invitations/[token]/route";
import { PUT as updateNotificationPreference } from "@/app/api/v1/notifications/preferences/route";
import { GET as readPublicCanvas } from "@/app/api/v1/share/[token]/route";
import { POST as restoreVersion } from "@/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route";

function jsonRequest(url: string, body: unknown, headers?: HeadersInit) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function noteData(index: number) {
  return {
    type: "NOTE" as const,
    positionX: index * 20,
    positionY: 0,
    width: 10,
    height: 10,
    content: { text: `note-${index}` },
    tags: [],
  };
}

beforeEach(async () => {
  await prisma.outboxJob.deleteMany();
  authState.userId = "";
  authState.email = "";
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("completed backend contracts", () => {
  it("rolls back a mixed command on one version conflict and replays a successful retry", async () => {
    const user = await prisma.user.create({
      data: { email: `command-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Commands", userId: user.id },
    });
    const [updatedItem, deletedItem] = await Promise.all([
      prisma.canvasItem.create({
        data: {
          canvasId: canvas.id,
          zIndex: 4,
          createdById: user.id,
          ...noteData(1),
        },
      }),
      prisma.canvasItem.create({
        data: {
          canvasId: canvas.id,
          zIndex: 8,
          createdById: user.id,
          ...noteData(2),
        },
      }),
    ]);
    authState.userId = user.id;
    authState.email = user.email;

    const failed = await applyCommand(
      jsonRequest("http://localhost/api/v1/canvas-items/commands", {
        canvasId: canvas.id,
        updates: [{ id: updatedItem.id, version: 1, positionX: 99 }],
        deletes: [{ id: deletedItem.id, version: 99 }],
        creates: [],
      }),
    );
    expect(failed.status).toBe(409);
    expect(
      await prisma.canvasItem.findUniqueOrThrow({
        where: { id: updatedItem.id },
      }),
    ).toMatchObject({ positionX: updatedItem.positionX, version: 1 });

    const command = {
      canvasId: canvas.id,
      updates: [{ id: updatedItem.id, version: 1, positionX: 99 }],
      deletes: [{ id: deletedItem.id, version: 1 }],
      creates: [noteData(3), noteData(4)],
    };
    const headers = { "x-idempotency-key": `command-${Date.now()}` };
    const first = await applyCommand(
      jsonRequest(
        "http://localhost/api/v1/canvas-items/commands",
        command,
        headers,
      ),
    );
    const replay = await applyCommand(
      jsonRequest(
        "http://localhost/api/v1/canvas-items/commands",
        command,
        headers,
      ),
    );
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-idempotency-hit")).toBe("true");
    const active = await prisma.canvasItem.findMany({
      where: { canvasId: canvas.id, deletedAt: null },
      orderBy: { zIndex: "asc" },
    });
    expect(active.map((item) => item.zIndex)).toEqual([4, 5, 6]);
    expect(active.find((item) => item.id === updatedItem.id)).toMatchObject({
      positionX: 99,
      version: 2,
    });
  });

  it("restores 2,000 items atomically and publishes a reload-required event", async () => {
    const user = await prisma.user.create({
      data: { email: `restore-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Before restore", userId: user.id },
    });
    const snapshot = {
      schemaVersion: 1 as const,
      name: "Restored canvas",
      zoomLevel: 1.5,
      panX: 10,
      panY: 20,
      items: Array.from({ length: 2_000 }, (_, index) => ({
        id: `c${index.toString(36).padStart(24, "0")}`,
        zIndex: index,
        ...noteData(index),
      })),
    };
    const version = await prisma.canvasVersion.create({
      data: { canvasId: canvas.id, name: "Large", snapshot },
    });
    authState.userId = user.id;
    authState.email = user.email;
    const startedAt = Date.now();
    const response = await restoreVersion(
      jsonRequest(
        `http://localhost/api/v1/canvases/${canvas.id}/versions/${version.id}/restore`,
        {},
      ),
      {
        params: Promise.resolve({ canvasId: canvas.id, versionId: version.id }),
      },
    );
    expect(response.status).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(
      await prisma.canvasItem.count({
        where: { canvasId: canvas.id, deletedAt: null },
      }),
    ).toBe(2_000);
    expect(
      await prisma.canvas.findUniqueOrThrow({ where: { id: canvas.id } }),
    ).toMatchObject({
      name: "Restored canvas",
      restoreRevision: 1,
    });
    const event = await prisma.canvasEvent.findFirstOrThrow({
      where: { canvasId: canvas.id, operation: "restored" },
    });
    expect(
      await prisma.outboxJob.findUnique({
        where: { dedupeKey: `canvas.restore.publish:${event.id}` },
      }),
    ).not.toBeNull();
  });

  it("enforces invitation consent, replay protection, stable identity, and preferences", async () => {
    const stamp = Date.now();
    const [owner, recipient] = await Promise.all([
      prisma.user.create({
        data: {
          email: `owner-${stamp}@example.com`,
          emailVerified: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          email: `recipient-${stamp}@example.com`,
          emailVerified: new Date(),
        },
      }),
    ]);
    const canvas = await prisma.canvas.create({
      data: { name: "Invitation", userId: owner.id },
    });
    authState.userId = recipient.id;
    authState.email = recipient.email;
    const preference = await updateNotificationPreference(
      new NextRequest("http://localhost/api/v1/notifications/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "CANVAS_SHARED",
          inAppEnabled: false,
          emailEnabled: true,
        }),
      }),
    );
    expect(preference.status).toBe(200);

    authState.userId = owner.id;
    authState.email = owner.email;
    const invited = await createInvitation(
      jsonRequest(`http://localhost/api/v1/canvases/${canvas.id}/share`, {
        email: recipient.email.toUpperCase(),
        role: "EDIT",
      }),
      { params: Promise.resolve({ canvasId: canvas.id }) },
    );
    expect(invited.status).toBe(202);
    const invitation = await prisma.canvasShareInvitation.findFirstOrThrow({
      where: { canvasId: canvas.id, email: recipient.email },
    });
    expect(
      await prisma.notification.count({
        where: { recipientId: recipient.id, type: "CANVAS_SHARED" },
      }),
    ).toBe(0);

    authState.userId = recipient.id;
    authState.email = recipient.email;
    const token = decryptSecret(invitation.deliverySecret);
    const accepted = await answerInvitation(
      jsonRequest(`http://localhost/api/v1/share-invitations/${token}`, {
        action: "accept",
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(accepted.status).toBe(200);
    const replay = await answerInvitation(
      jsonRequest(`http://localhost/api/v1/share-invitations/${token}`, {
        action: "accept",
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(replay.status).toBe(404);
    await prisma.user.update({
      where: { id: recipient.id },
      data: { email: `changed-${stamp}@example.com` },
    });
    expect(
      await prisma.canvasShare.findFirst({
        where: { canvasId: canvas.id, recipientId: recipient.id, role: "EDIT" },
      }),
    ).not.toBeNull();
  });

  it("bounds anonymous public reads by viewport, count, and response bytes", async () => {
    const user = await prisma.user.create({
      data: { email: `public-${Date.now()}@example.com` },
    });
    const token = `public-${Date.now()}`;
    const canvas = await prisma.canvas.create({
      data: {
        name: "Public bounds",
        userId: user.id,
        isPublic: true,
        shareToken: token,
      },
    });
    await prisma.canvasItem.createMany({
      data: Array.from({ length: 120 }, (_, index) => ({
        canvasId: canvas.id,
        createdById: user.id,
        zIndex: index,
        ...noteData(index),
        content: { text: "x".repeat(10_000) },
      })),
    });
    const response = await readPublicCanvas(
      new NextRequest(
        `http://localhost/api/v1/share/${token}?minX=0&maxX=1000&minY=-10&maxY=20&limit=100`,
      ),
      { params: Promise.resolve({ token }) },
    );
    const raw = await response.text();
    const body = JSON.parse(raw) as {
      items: unknown[];
      total: number;
      truncatedByBytes: boolean;
    };
    expect(response.status).toBe(200);
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(512 * 1024);
    expect(body.items.length).toBeLessThanOrEqual(100);
    expect(body.total).toBe(51);
    expect(body.truncatedByBytes).toBe(true);
  });
});
