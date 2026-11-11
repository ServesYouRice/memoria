import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type * as MutationLock from "@/lib/canvas/mutation-lock";

const hooks = vi.hoisted(() => ({
  beforeFirstLock: null as null | (() => Promise<void>),
}));

// Simulates a concurrent writer acting between the unlocked first read of the
// items and the board locks.
vi.mock("@/lib/canvas/mutation-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof MutationLock>();
  return {
    ...actual,
    lockCanvasForMutation: async (
      ...args: Parameters<typeof actual.lockCanvasForMutation>
    ) => {
      const hook = hooks.beforeFirstLock;
      hooks.beforeFirstLock = null;
      if (hook) await hook();
      return actual.lockCanvasForMutation(...args);
    },
  };
});

import {
  ASK_COMMAND_SUGGESTION_KIND,
  executeAskCommandSuggestion,
  getAskAssistantProfile,
} from "@/lib/ai/ask-commands";

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  hooks.beforeFirstLock = null;
});

async function setup() {
  const user = await prisma.user.create({
    data: { email: `ask-relock-${Date.now()}-${Math.random()}@example.com` },
  });
  const [a, b, c, target] = await Promise.all(
    ["A", "B", "C", "Target"].map((name) =>
      prisma.canvas.create({ data: { name, userId: user.id } }),
    ),
  );
  const item = (canvasId: string) =>
    prisma.canvasItem.create({
      data: {
        canvasId,
        type: "BOOKMARK",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 100,
        content: { url: "https://example.com", title: "x" },
        createdById: user.id,
      },
    });
  const profile = await getAskAssistantProfile(user.id);
  return { user, a: a!, b: b!, c: c!, target: target!, item, profile };
}

function run(ctx: Awaited<ReturnType<typeof setup>>, itemIds: string[]) {
  return executeAskCommandSuggestion({
    actor: { userId: ctx.user.id, agentProfileId: ctx.profile.id },
    agentProfile: ctx.profile,
    payload: {
      kind: ASK_COMMAND_SUGGESTION_KIND,
      command: { type: "move_items", boardId: ctx.target.id, itemIds },
    },
    summary: "Move",
  });
}

async function writes(userId: string, itemId: string) {
  const [records, events] = await Promise.all([
    prisma.changeRecord.count({
      where: { targetId: itemId, changeSet: { userId } },
    }),
    prisma.canvasEvent.count({ where: { entityId: itemId } }),
  ]);
  return { records, events };
}

describe("Ask move re-reads items under the board locks (VAL-269)", () => {
  it("refuses when an item moved to an unlocked board after the first read", async () => {
    const ctx = await setup();
    const moved = await ctx.item(ctx.a.id);
    hooks.beforeFirstLock = async () => {
      await prisma.canvasItem.update({
        where: { id: moved.id },
        data: { canvasId: ctx.c.id, version: { increment: 1 } },
      });
    };

    await expect(run(ctx, [moved.id])).rejects.toMatchObject({
      status: 409,
      detail: "Items moved while filing; try again.",
    });
    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: moved.id },
    });
    expect(row.canvasId).toBe(ctx.c.id);
    expect(await writes(ctx.user.id, moved.id)).toEqual({
      records: 0,
      events: 0,
    });
  });

  it("refuses when an item was trashed after the first read", async () => {
    const ctx = await setup();
    const trashed = await ctx.item(ctx.a.id);
    hooks.beforeFirstLock = async () => {
      await prisma.canvasItem.update({
        where: { id: trashed.id },
        data: { deletedAt: new Date() },
      });
    };

    await expect(run(ctx, [trashed.id])).rejects.toMatchObject({
      status: 409,
      detail: "Items moved while filing; try again.",
    });
    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: trashed.id },
    });
    expect(row.canvasId).toBe(ctx.a.id);
    expect(row.deletedAt).not.toBeNull();
    expect(await writes(ctx.user.id, trashed.id)).toEqual({
      records: 0,
      events: 0,
    });
  });

  it("uses the locked re-read for the deleted event and the undo record", async () => {
    const ctx = await setup();
    const first = await ctx.item(ctx.a.id);
    const second = await ctx.item(ctx.b.id);
    hooks.beforeFirstLock = async () => {
      // Moves to a board this run locks anyway.
      await prisma.canvasItem.update({
        where: { id: first.id },
        data: { canvasId: ctx.b.id, version: { increment: 1 } },
      });
    };

    const result = await run(ctx, [first.id, second.id]);
    expect(result.movedItemCount).toBe(2);

    const deleted = await prisma.canvasEvent.findFirstOrThrow({
      where: { entityId: first.id, operation: "deleted" },
    });
    expect(deleted.canvasId).toBe(ctx.b.id);
    const record = await prisma.changeRecord.findFirstOrThrow({
      where: { targetId: first.id, changeSetId: result.changeSetId },
    });
    expect((record.before as { canvasId: string }).canvasId).toBe(ctx.b.id);
    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(row.canvasId).toBe(ctx.target.id);
  });
});
