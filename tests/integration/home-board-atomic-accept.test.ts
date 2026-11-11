/**
 * TASK-010 — accepting a home-board suggestion commits the move and the row's
 * transition together: a dismiss that wins rolls the move back, and a
 * transient executor error leaves the row OPEN instead of dismissing it.
 */
import { randomBytes } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as CommittedEvents from "@/lib/collaboration/committed-events";

const inject = vi.hoisted(() => ({
  /** Runs inside the move transaction, after the item was moved. */
  afterMove: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/collaboration/committed-events", async (importOriginal) => {
  const original = await importOriginal<typeof CommittedEvents>();
  return {
    ...original,
    recordCanvasItemEvent: async (
      ...args: Parameters<typeof original.recordCanvasItemEvent>
    ) => {
      const hook = inject.afterMove;
      inject.afterMove = null;
      if (hook) await hook();
      return original.recordCanvasItemEvent(...args);
    },
  };
});

import { prisma } from "@/lib/db";
import {
  acceptHomeBoardSuggestion,
  createHomeBoardProposalHandler,
  dismissHomeBoardSuggestion,
  undoHomeBoardMove,
} from "@/lib/agents/home-board";

afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(() => {
  inject.afterMove = null;
});

async function proposed() {
  const user = await prisma.user.create({
    data: { email: `atomic-${randomBytes(6).toString("hex")}@example.com` },
  });
  const inbox = await prisma.canvas.create({
    data: { name: "Inbox", userId: user.id },
  });
  const rome = await prisma.canvas.create({
    data: { name: "Rome trip", userId: user.id },
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
      content: { url: "https://example.com/rome", title: "Rome tickets" },
      tags: ["rome", "travel"],
      createdById: user.id,
    },
  });
  await createHomeBoardProposalHandler(prisma, {
    aiAvailable: async () => false,
  })({ payload: { itemId: item.id } } as never);
  const row = await prisma.homeBoardSuggestion.findUniqueOrThrow({
    where: { itemId: item.id },
  });
  expect(row.status).toBe("OPEN");
  return { user, inbox, rome, item, row };
}

async function state(itemId: string) {
  const row = await prisma.homeBoardSuggestion.findUniqueOrThrow({
    where: { itemId },
  });
  const item = await prisma.canvasItem.findUniqueOrThrow({
    where: { id: itemId },
  });
  const suggestion = await prisma.suggestion.findUniqueOrThrow({
    where: { id: row.suggestionId! },
  });
  return { row, item, suggestion };
}

describe("atomic home-board accept (TASK-010)", () => {
  it("rolls the move back when a dismiss wins while the move runs", async () => {
    const { user, inbox, item } = await proposed();
    inject.afterMove = async () => {
      await dismissHomeBoardSuggestion({ userId: user.id, itemId: item.id });
    };

    await expect(
      acceptHomeBoardSuggestion({ userId: user.id, itemId: item.id }),
    ).rejects.toMatchObject({
      detail: expect.stringMatching(/no longer open/),
    });

    const after = await state(item.id);
    expect(after.item.canvasId).toBe(inbox.id);
    expect(after.row).toMatchObject({ status: "DISMISSED", changeSetId: null });
    expect(after.suggestion.status).toBe("REJECTED");
    expect(
      await prisma.changeRecord.count({ where: { targetId: item.id } }),
    ).toBe(0);
  });

  it("keeps the row OPEN after a transient executor error, then accepts and undoes", async () => {
    const { user, inbox, rome, item } = await proposed();
    inject.afterMove = async () => {
      throw new Error("connection reset");
    };

    await expect(
      acceptHomeBoardSuggestion({ userId: user.id, itemId: item.id }),
    ).rejects.toThrow("connection reset");

    const failed = await state(item.id);
    expect(failed.item.canvasId).toBe(inbox.id);
    expect(failed.row).toMatchObject({ status: "OPEN", changeSetId: null });
    expect(failed.suggestion.status).toBe("APPROVED");

    const accepted = await acceptHomeBoardSuggestion({
      userId: user.id,
      itemId: item.id,
    });
    const done = await state(item.id);
    expect(done.item.canvasId).toBe(rome.id);
    expect(done.row).toMatchObject({
      status: "ACCEPTED",
      changeSetId: accepted.changeSetId,
    });
    expect(done.suggestion.status).toBe("EXECUTED");

    await undoHomeBoardMove({ userId: user.id, itemId: item.id });
    expect((await state(item.id)).item.canvasId).toBe(inbox.id);
  });

  it("refuses a dismiss that lost to an accept", async () => {
    const { user, rome, item } = await proposed();
    await acceptHomeBoardSuggestion({ userId: user.id, itemId: item.id });
    await expect(
      dismissHomeBoardSuggestion({ userId: user.id, itemId: item.id }),
    ).rejects.toMatchObject({
      detail: expect.stringMatching(/no longer open/),
    });
    const after = await state(item.id);
    expect(after.item.canvasId).toBe(rome.id);
    expect(after.row.status).toBe("ACCEPTED");
  });
});
