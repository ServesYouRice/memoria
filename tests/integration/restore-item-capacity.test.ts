import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type * as ApiAuth from "@/lib/api/auth";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiAuth>();
  return {
    ...actual,
    requireAuth: vi.fn(async () => ({ userId: auth.userId })),
  };
});

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/v1/trash/route";
import { revertChangeSet } from "@/lib/agents/service-core";
import { archiveItems } from "@/lib/services/archive";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const user = await prisma.user.create({
    data: { email: `capacity-${randomBytes(6).toString("hex")}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Full", userId: user.id },
  });
  return { user, canvas };
}

function note(canvasId: string, userId: string, text: string) {
  return {
    canvasId,
    type: "NOTE" as const,
    positionX: 0,
    positionY: 0,
    width: 10,
    height: 10,
    content: { text },
    createdById: userId,
  };
}

/** Fills the canvas's live items up to the per-canvas limit. */
async function fillToLimit(canvasId: string, userId: string) {
  const live = await prisma.canvasItem.count({
    where: { canvasId, deletedAt: null },
  });
  await prisma.canvasItem.createMany({
    data: Array.from({ length: LAUNCH_LIMITS.itemsPerCanvas - live }, () =>
      note(canvasId, userId, "refill"),
    ),
  });
}

describe("restores respect the per-canvas item limit (PostgreSQL)", () => {
  it("refuses a Trash restore onto a full canvas and leaves the item in Trash", async () => {
    const { user, canvas } = await seed();
    auth.userId = user.id;
    const trashed = await prisma.canvasItem.create({
      data: {
        ...note(canvas.id, user.id, "trashed"),
        deletedAt: new Date(),
        deletedById: user.id,
      },
    });
    await fillToLimit(canvas.id, user.id);

    const response = await PATCH(
      new NextRequest("http://localhost/api/v1/trash", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: trashed.id, version: trashed.version }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      resource: "canvas items",
      limit: LAUNCH_LIMITS.itemsPerCanvas,
    });
    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: trashed.id },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.version).toBe(trashed.version);
    expect(
      await prisma.canvasItem.count({
        where: { canvasId: canvas.id, deletedAt: null },
      }),
    ).toBe(LAUNCH_LIMITS.itemsPerCanvas);
  });

  it("still restores from Trash while there is room", async () => {
    const { user, canvas } = await seed();
    auth.userId = user.id;
    const trashed = await prisma.canvasItem.create({
      data: {
        ...note(canvas.id, user.id, "trashed"),
        deletedAt: new Date(),
        deletedById: user.id,
      },
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/v1/trash", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: trashed.id, version: trashed.version }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("refuses an archive undo that would overfill the canvas, restoring nothing", async () => {
    const { user, canvas } = await seed();
    const profile = await prisma.agentProfile.create({
      data: { userId: user.id, name: "Assistant" },
    });
    const items = await prisma.canvasItem.createManyAndReturn({
      data: [1, 2, 3].map((index) => note(canvas.id, user.id, `old ${index}`)),
    });
    const archived = await archiveItems({
      actor: { userId: user.id, agentProfileId: profile.id },
      itemIds: items.map((item) => item.id),
      summary: "Archive three",
    });
    // Leave room for one of the three only.
    await fillToLimit(canvas.id, user.id);
    const oneFree = await prisma.canvasItem.findFirstOrThrow({
      where: { canvasId: canvas.id, deletedAt: null },
    });
    await prisma.canvasItem.delete({ where: { id: oneFree.id } });

    await expect(
      revertChangeSet({
        actor: { userId: user.id, agentProfileId: profile.id },
        changeSetId: archived.changeSetId,
      }),
    ).rejects.toMatchObject({ status: 422 });

    const rows = await prisma.canvasItem.findMany({
      where: { id: { in: items.map((item) => item.id) } },
    });
    expect(rows.every((row) => row.deletedAt && row.archivedAt)).toBe(true);
    const changeSet = await prisma.changeSet.findUniqueOrThrow({
      where: { id: archived.changeSetId },
    });
    expect(changeSet.revertedAt).toBeNull();
    expect(
      await prisma.canvasItem.count({
        where: { canvasId: canvas.id, deletedAt: null },
      }),
    ).toBe(LAUNCH_LIMITS.itemsPerCanvas - 1);
  });
});
