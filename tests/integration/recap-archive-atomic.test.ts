import { randomBytes } from "crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type * as AskCommands from "@/lib/ai/ask-commands";

// Runs between the recap archive's first stale read and its transaction: the
// assistant profile is looked up exactly there.
const hooks = vi.hoisted(() => ({
  auth: vi.fn(),
  afterStaleCheck: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ auth: hooks.auth }));
vi.mock("@/lib/ai/ask-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof AskCommands>();
  return {
    ...actual,
    getAskAssistantProfile: async (userId: string) => {
      const profile = await actual.getAskAssistantProfile(userId);
      await hooks.afterStaleCheck?.();
      return profile;
    },
  };
});

import { prisma } from "@/lib/db";
import { archiveRecapStaleLinks } from "@/lib/recap/archive-stale";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { POST as openedRoute } from "@/app/api/v1/items/[itemId]/opened/route";

afterEach(() => {
  hooks.afterStaleCheck = null;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const WEEKS = 7 * 86_400_000;

/** A user with two stale links and the recap that lists them. */
async function seed() {
  const user = await prisma.user.create({
    data: { email: `recap-${randomBytes(6).toString("hex")}@example.com` },
  });
  hooks.auth.mockResolvedValue({ user: { id: user.id, email: user.email } });
  const canvas = await prisma.canvas.create({
    data: { name: "Links", userId: user.id },
  });
  const [stale, opened] = await prisma.canvasItem.createManyAndReturn({
    data: ["stale", "opened"].map((id) => ({
      canvasId: canvas.id,
      type: "BOOKMARK" as const,
      positionX: 0,
      positionY: 0,
      width: 200,
      height: 100,
      content: { url: `https://example.com/${id}`, title: `Link ${id}` },
      createdById: user.id,
    })),
  });
  const longAgo = new Date(Date.now() - 10 * WEEKS);
  await prisma.$executeRaw`
    UPDATE "CanvasItem" SET "createdAt" = ${longAgo}, "updatedAt" = ${longAgo}
    WHERE "canvasId" = ${canvas.id}
  `;
  const now = new Date();
  const recap = await prisma.weeklyRecap.create({
    data: {
      userId: user.id,
      weekStart: now,
      periodStart: new Date(now.getTime() - WEEKS),
      periodEnd: now,
      savedLinks: [],
      suggestedPiles: [],
      staleWeeks: 6,
      staleCount: 2,
      staleItemIds: [stale!.id, opened!.id],
    },
  });
  return { user, canvas, stale: stale!, opened: opened!, recap };
}

async function open(itemId: string) {
  const response = await openedRoute(
    new Request(`http://localhost/api/v1/items/${itemId}/opened`, {
      method: "POST",
    }) as unknown as NextRequest,
    { params: Promise.resolve({ itemId }) },
  );
  expect(response.status).toBe(204);
}

async function expectLiveAndOutOfChangeSet(
  itemId: string,
  changeSetId: string,
) {
  const row = await prisma.canvasItem.findUniqueOrThrow({
    where: { id: itemId },
  });
  expect(row.deletedAt).toBeNull();
  expect(row.archivedAt).toBeNull();
  expect(
    await prisma.changeRecord.count({
      where: { changeSetId, targetId: itemId },
    }),
  ).toBe(0);
}

describe("recap stale-link archive (PostgreSQL)", () => {
  it("keeps a link opened after the stale check", async () => {
    const seeded = await seed();
    hooks.afterStaleCheck = () => open(seeded.opened.id);

    const result = await archiveRecapStaleLinks({
      userId: seeded.user.id,
      recapId: seeded.recap.id,
    });

    expect(result.archivedItemIds).toEqual([seeded.stale.id]);
    expect(result.archivedItemCount).toBe(1);
    await expectLiveAndOutOfChangeSet(seeded.opened.id, result.changeSetId);
    const changeSet = await prisma.changeSet.findUniqueOrThrow({
      where: { id: result.changeSetId },
    });
    expect(changeSet.summary).toBe("Archive 1 link not opened in 6 weeks");
  });

  it("keeps a link edited after the stale check", async () => {
    const seeded = await seed();
    hooks.afterStaleCheck = async () => {
      await prisma.canvasItem.update({
        where: { id: seeded.opened.id },
        data: { content: { url: "https://example.com/edited", title: "New" } },
      });
    };

    const result = await archiveRecapStaleLinks({
      userId: seeded.user.id,
      recapId: seeded.recap.id,
    });

    expect(result.archivedItemIds).toEqual([seeded.stale.id]);
    await expectLiveAndOutOfChangeSet(seeded.opened.id, result.changeSetId);
  });

  it("keeps a link opened while the archive waits for the board lock", async () => {
    const seeded = await seed();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, seeded.canvas.id);
      locked();
      await held;
    });
    await isLocked;

    const archive = archiveRecapStaleLinks({
      userId: seeded.user.id,
      recapId: seeded.recap.id,
    });
    // Let the archive pass its stale check and block on the board lock.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await open(seeded.opened.id);
    release();
    await holder;
    const result = await archive;

    expect(result.archivedItemIds).toEqual([seeded.stale.id]);
    await expectLiveAndOutOfChangeSet(seeded.opened.id, result.changeSetId);
  });

  it("archives nothing and links nothing when no link is stale any more", async () => {
    const seeded = await seed();
    hooks.afterStaleCheck = async () => {
      await open(seeded.opened.id);
      await open(seeded.stale.id);
    };

    await expect(
      archiveRecapStaleLinks({
        userId: seeded.user.id,
        recapId: seeded.recap.id,
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(
      await prisma.canvasItem.count({
        where: { canvasId: seeded.canvas.id, deletedAt: null },
      }),
    ).toBe(2);
    expect(
      await prisma.changeSet.count({ where: { userId: seeded.user.id } }),
    ).toBe(0);
    const recap = await prisma.weeklyRecap.findUniqueOrThrow({
      where: { id: seeded.recap.id },
    });
    expect(recap.archivedChangeSetId).toBeNull();
  });

  it("commits the archive and the recap link together or not at all", async () => {
    const seeded = await seed();
    // The recap goes away before the archive runs, so the recap write fails.
    hooks.afterStaleCheck = async () => {
      await prisma.weeklyRecap.delete({ where: { id: seeded.recap.id } });
    };

    await expect(
      archiveRecapStaleLinks({
        userId: seeded.user.id,
        recapId: seeded.recap.id,
      }),
    ).rejects.toBeInstanceOf(Error);

    const rows = await prisma.canvasItem.findMany({
      where: { canvasId: seeded.canvas.id },
    });
    expect(rows.map((row) => row.deletedAt)).toEqual([null, null]);
    expect(
      await prisma.changeSet.count({ where: { userId: seeded.user.id } }),
    ).toBe(0);
  });

  it("refuses when another request linked the recap first, archiving nothing", async () => {
    const seeded = await seed();
    hooks.afterStaleCheck = async () => {
      await prisma.weeklyRecap.update({
        where: { id: seeded.recap.id },
        data: { archivedChangeSetId: "taken-by-another-request" },
      });
    };

    await expect(
      archiveRecapStaleLinks({
        userId: seeded.user.id,
        recapId: seeded.recap.id,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const rows = await prisma.canvasItem.findMany({
      where: { canvasId: seeded.canvas.id },
    });
    expect(rows.map((row) => row.deletedAt)).toEqual([null, null]);
    const recap = await prisma.weeklyRecap.findUniqueOrThrow({
      where: { id: seeded.recap.id },
    });
    expect(recap.archivedChangeSetId).toBe("taken-by-another-request");
    expect(recap.archivedAt).toBeNull();
  });

  it("links the recap to the change set it committed", async () => {
    const seeded = await seed();
    const result = await archiveRecapStaleLinks({
      userId: seeded.user.id,
      recapId: seeded.recap.id,
    });
    const recap = await prisma.weeklyRecap.findUniqueOrThrow({
      where: { id: seeded.recap.id },
    });
    expect(recap.archivedChangeSetId).toBe(result.changeSetId);
    expect(recap.archivedAt).toBeInstanceOf(Date);
    expect(result.archivedItemIds.sort()).toEqual(
      [seeded.stale.id, seeded.opened.id].sort(),
    );
  });
});
