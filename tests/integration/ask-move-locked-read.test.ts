import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type * as ServiceCore from "@/lib/agents/service-core";

const hooks = vi.hoisted(() => ({
  beforeClaim: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/agents/service-core", async (importOriginal) => {
  const actual = await importOriginal<typeof ServiceCore>();
  return {
    ...actual,
    claimSuggestionForExecution: async (
      ...args: Parameters<typeof actual.claimSuggestionForExecution>
    ) => {
      const hook = hooks.beforeClaim;
      hooks.beforeClaim = null;
      if (hook) await hook();
      return actual.claimSuggestionForExecution(...args);
    },
  };
});

import { prisma } from "@/lib/db";
import {
  acceptHomeBoardSuggestion,
  createHomeBoardProposalHandler,
} from "@/lib/agents/home-board";
import {
  ASK_COMMAND_SUGGESTION_KIND,
  executeAskCommandSuggestion,
  getAskAssistantProfile,
} from "@/lib/ai/ask-commands";

afterAll(async () => {
  await prisma.$disconnect();
});

const suffix = () => randomBytes(6).toString("hex");

async function seed() {
  const user = await prisma.user.create({
    data: { email: `ask-move-${suffix()}@example.com` },
  });
  // Explicit ids pin the sorted lock order: source board, then target.
  const tag = suffix();
  const source = await prisma.canvas.create({
    data: { id: `a-${tag}`, name: "Inbox", userId: user.id },
  });
  const manual = await prisma.canvas.create({
    data: { id: `m-${tag}`, name: "Chosen by hand", userId: user.id },
  });
  const target = await prisma.canvas.create({
    data: { id: `z-${tag}`, name: "Rome trip", userId: user.id },
  });
  const item = await prisma.canvasItem.create({
    data: {
      canvasId: source.id,
      type: "BOOKMARK",
      positionX: 80,
      positionY: 80,
      width: 360,
      height: 120,
      content: { url: `https://example.com/${suffix()}`, title: "Tickets" },
      tags: ["rome"],
      createdById: user.id,
    },
  });
  const profile = await getAskAssistantProfile(user.id);
  return { user, source, manual, target, item, profile };
}

function moveCommand(itemId: string, boardId: string) {
  return {
    kind: ASK_COMMAND_SUGGESTION_KIND,
    command: { type: "move_items", itemIds: [itemId], boardId },
  };
}

async function waitForLockWaiter() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%FOR UPDATE%'
    `;
    if (Number(rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The move never waited on the board lock.");
}

async function moveRecords(itemId: string) {
  return prisma.changeRecord.count({
    where: { targetType: "CanvasItem", targetId: itemId, operation: "MOVE" },
  });
}

describe("Ask move reads items under its board locks (PostgreSQL)", () => {
  it("never acts on an item another transaction moved while it waited", async () => {
    const { user, source, manual, target, item, profile } = await seed();

    let holding!: () => void;
    const locked = new Promise<void>((resolve) => (holding = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    // Stands in for a manual move that holds the source board lock.
    const manualMove = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "Canvas" WHERE "id" = ${source.id} FOR UPDATE
        `;
        holding();
        await released;
        await tx.canvasItem.update({
          where: { id: item.id },
          data: { canvasId: manual.id, version: { increment: 1 } },
        });
      },
      { timeout: 20_000 },
    );
    await locked;

    const filing = executeAskCommandSuggestion({
      actor: { userId: user.id, agentProfileId: profile.id },
      agentProfile: profile,
      payload: moveCommand(item.id, target.id),
      summary: "Move 1 item",
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await waitForLockWaiter();
    release();
    await manualMove;
    const outcome = await filing;

    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.canvasId).toBe(manual.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.error).toMatchObject({
      detail: "Items moved while filing; try again.",
    });
    expect(await moveRecords(item.id)).toBe(0);
    const staleDelete = await prisma.canvasEvent.count({
      where: { canvasId: source.id, entityId: item.id, operation: "deleted" },
    });
    expect(staleDelete).toBe(0);
  });

  it("refuses an expected source board the item has already left", async () => {
    const { user, source, manual, target, item, profile } = await seed();
    await prisma.canvasItem.update({
      where: { id: item.id },
      data: { canvasId: manual.id, version: { increment: 1 } },
    });

    await expect(
      executeAskCommandSuggestion({
        actor: { userId: user.id, agentProfileId: profile.id },
        agentProfile: profile,
        payload: moveCommand(item.id, target.id),
        summary: "Move 1 item",
        expectedSourceCanvasId: source.id,
      }),
    ).rejects.toMatchObject({
      detail: "This item has already moved, so the suggestion was dropped.",
    });
    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.canvasId).toBe(manual.id);
    expect(await moveRecords(item.id)).toBe(0);
  });

  it("keeps a manual move made after the accept precheck and closes the suggestion", async () => {
    const user = await prisma.user.create({
      data: { email: `ask-move-${suffix()}@example.com` },
    });
    const inbox = await prisma.canvas.create({
      data: { name: "Inbox", userId: user.id },
    });
    const rome = await prisma.canvas.create({
      data: { name: "Rome trip", userId: user.id },
    });
    const manual = await prisma.canvas.create({
      data: { name: "Chosen by hand", userId: user.id },
    });
    await prisma.canvasItem.create({
      data: {
        canvasId: rome.id,
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 200,
        content: { text: "Flights" },
        tags: ["travel", "italy"],
        createdById: user.id,
      },
    });
    const item = await prisma.canvasItem.create({
      data: {
        canvasId: inbox.id,
        type: "BOOKMARK",
        positionX: 80,
        positionY: 80,
        width: 360,
        height: 120,
        content: { url: `https://example.com/${suffix()}`, title: "Rome" },
        tags: ["rome", "travel"],
        createdById: user.id,
      },
    });
    await createHomeBoardProposalHandler(prisma, {
      aiAvailable: async () => false,
    })({ payload: { itemId: item.id } } as never);
    const suggestionRow = await prisma.homeBoardSuggestion.findFirstOrThrow({
      where: { itemId: item.id },
    });
    expect(suggestionRow.targetCanvasId).toBe(rome.id);

    hooks.beforeClaim = async () => {
      await prisma.canvasItem.update({
        where: { id: item.id },
        data: { canvasId: manual.id, version: { increment: 1 } },
      });
    };
    await expect(
      acceptHomeBoardSuggestion({ userId: user.id, itemId: item.id }),
    ).rejects.toMatchObject({
      detail: "This item has already moved, so the suggestion was dropped.",
    });

    const row = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.canvasId).toBe(manual.id);
    expect(await moveRecords(item.id)).toBe(0);
    const closed = await prisma.homeBoardSuggestion.findFirstOrThrow({
      where: { itemId: item.id },
    });
    expect(closed.status).toBe("DISMISSED");
    const suggestion = await prisma.suggestion.findUniqueOrThrow({
      where: { id: suggestionRow.suggestionId! },
    });
    expect(suggestion.status).not.toBe("EXECUTED");
  });
});
