/**
 * TASK-168 — the sync projection checks item capacity against the net change
 * of an update: deleting N and creating N at the limit is accepted, while net
 * growth past the limit is still refused.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import { projectDocumentChanges } from "@/lib/collaboration/sync/projection";
import { InvalidDocumentUpdateError } from "@/lib/collaboration/sync/validation";
import { createCanvasItemId } from "@/lib/collaboration/sync/protocol";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { ItemType } from "@/types/canvas";

function shape(id: string) {
  return {
    id,
    type: ItemType.SHAPE,
    positionX: 0,
    positionY: 0,
    width: 10,
    height: 10,
    zIndex: 0,
    tags: [],
    content: { shapeType: "star" },
  };
}

async function canvasAtLimit() {
  const owner = await prisma.user.create({
    data: { email: `capacity-${Date.now()}-${Math.random()}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Full", userId: owner.id },
  });
  const ids = Array.from(
    { length: LAUNCH_LIMITS.itemsPerCanvas },
    createCanvasItemId,
  );
  await prisma.canvasItem.createMany({
    data: ids.map((id) => ({
      ...shape(id),
      canvasId: canvas.id,
      createdById: owner.id,
    })),
  });
  return { owner, canvas, ids };
}

beforeEach(async () => {
  await prisma.canvas.deleteMany({
    where: { user: { email: { startsWith: "capacity-" } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "capacity-" } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sync projection capacity at the item limit", () => {
  it("accepts an update that deletes one item and creates one", async () => {
    const { owner, canvas, ids } = await canvasAtLimit();
    const fresh = createCanvasItemId();
    const result = await prisma.$transaction((tx) =>
      projectDocumentChanges(tx, {
        canvasId: canvas.id,
        actorId: owner.id,
        changes: [
          { kind: "create", state: shape(fresh) },
          { kind: "delete", id: ids[0] },
        ],
      }),
    );
    expect(result).toMatchObject({ created: 1, deleted: 1 });
    expect(
      await prisma.canvasItem.count({
        where: { canvasId: canvas.id, deletedAt: null },
      }),
    ).toBe(LAUNCH_LIMITS.itemsPerCanvas);
  });

  it("refuses an update that deletes one item and creates two", async () => {
    const { owner, canvas, ids } = await canvasAtLimit();
    await expect(
      prisma.$transaction((tx) =>
        projectDocumentChanges(tx, {
          canvasId: canvas.id,
          actorId: owner.id,
          changes: [
            { kind: "delete", id: ids[0] },
            { kind: "create", state: shape(createCanvasItemId()) },
            { kind: "create", state: shape(createCanvasItemId()) },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidDocumentUpdateError);
    // Nothing from the refused update was kept.
    expect(
      await prisma.canvasItem.count({
        where: { canvasId: canvas.id, deletedAt: null },
      }),
    ).toBe(LAUNCH_LIMITS.itemsPerCanvas);
  });
});
