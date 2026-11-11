/**
 * TASK-007 — every path that un-deletes a CanvasItem clears archivedAt, so a
 * restored item later deleted normally stays eligible for the trash sweep.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type * as AuthModule from "@/lib/api/auth";

const authState = vi.hoisted(() => ({ userId: "", email: "" }));

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireAuth: async () => ({ ...authState }),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import { projectDocumentChanges } from "@/lib/collaboration/sync/projection";
import { POST as restoreVersion } from "@/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route";
import { DELETE as deleteItem } from "@/app/api/v1/canvas-items/[itemId]/route";

const ITEM_ID = "cjld2cjxh0000qzrmn831i7rn";

async function setup() {
  const owner = await prisma.user.create({
    data: { email: `archived-${Date.now()}-${Math.random()}@example.com` },
  });
  authState.userId = owner.id;
  authState.email = owner.email;
  const canvas = await prisma.canvas.create({
    data: { name: "Archive", userId: owner.id },
  });
  const archivedAt = new Date();
  await prisma.canvasItem.create({
    data: {
      id: ITEM_ID,
      canvasId: canvas.id,
      type: "SHAPE",
      positionX: 0,
      positionY: 0,
      width: 40,
      height: 40,
      content: { shapeType: "star" },
      createdById: owner.id,
      deletedAt: archivedAt,
      deletedById: owner.id,
      archivedAt,
    },
  });
  return { owner, canvas };
}

beforeEach(async () => {
  await prisma.canvas.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("archivedAt on undelete paths", () => {
  it("version restore clears archivedAt and a later normal delete keeps it clear", async () => {
    const { owner, canvas } = await setup();
    const version = await prisma.canvasVersion.create({
      data: {
        canvasId: canvas.id,
        kind: "MANUAL",
        createdById: owner.id,
        name: "Baseline",
        snapshot: {
          schemaVersion: 1,
          items: [
            {
              id: ITEM_ID,
              type: "SHAPE",
              positionX: 5,
              positionY: 6,
              width: 40,
              height: 40,
              zIndex: 0,
              content: { shapeType: "star" },
              tags: [],
            },
          ],
        },
      },
    });
    const restored = await restoreVersion(
      new NextRequest(
        `http://localhost/api/v1/canvases/${canvas.id}/versions/${version.id}/restore`,
        { method: "POST" },
      ),
      {
        params: Promise.resolve({ canvasId: canvas.id, versionId: version.id }),
      },
    );
    expect(restored.status).toBe(200);
    const live = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: ITEM_ID },
    });
    expect(live.deletedAt).toBeNull();
    expect(live.archivedAt).toBeNull();

    const deleted = await deleteItem(
      new NextRequest(`http://localhost/api/v1/canvas-items/${ITEM_ID}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: live.version }),
      }),
      { params: Promise.resolve({ itemId: ITEM_ID }) },
    );
    expect(deleted.status).toBe(200);
    const trashed = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: ITEM_ID },
    });
    expect(trashed.deletedAt).not.toBeNull();
    expect(trashed.archivedAt).toBeNull();
  });

  it("the sync projection re-create path clears archivedAt", async () => {
    const { owner, canvas } = await setup();
    await prisma.$transaction((tx) =>
      projectDocumentChanges(tx, {
        canvasId: canvas.id,
        actorId: owner.id,
        changes: [
          {
            kind: "create",
            state: {
              id: ITEM_ID,
              type: "SHAPE",
              positionX: 1,
              positionY: 2,
              width: 40,
              height: 40,
              zIndex: 0,
              tags: [],
              content: { shapeType: "star" },
            } as never,
          },
        ],
      }),
    );
    const live = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: ITEM_ID },
    });
    expect(live.deletedAt).toBeNull();
    expect(live.archivedAt).toBeNull();
  });
});
