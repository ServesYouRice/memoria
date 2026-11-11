import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    agentAction: { create: vi.fn(), update: vi.fn() },
    changeSet: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    changeRecord: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    canvasItem: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  };
  return { tx, changeSetFindFirst: vi.fn(), recordEvent: vi.fn() };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    changeSet: { findFirst: mocks.changeSetFindFirst },
    $transaction: async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx),
  },
}));
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: vi.fn(),
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: mocks.recordEvent,
  recordCanvasItemEventsBatch: vi.fn(),
}));

import { revertChangeSet } from "@/lib/agents/service-core";

const actor = { userId: "user-1", agentProfileId: "prof-1" };

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    canvasId: "c1",
    type: "NOTE",
    positionX: 0,
    positionY: 0,
    width: 200,
    height: 100,
    zIndex: 0,
    content: { text: "<p>Original</p>", formatVersion: 1 },
    tags: ["a"],
    version: 1,
    deletedAt: null,
    ...overrides,
  };
}

// A pile sort moved the note: only geometry changed between before and after.
const before = item();
const after = item({ positionX: 400, positionY: 300, zIndex: 5, version: 2 });

beforeEach(() => {
  vi.clearAllMocks();
  const records = [
    {
      id: "cr-1",
      targetType: "CanvasItem",
      targetId: "i1",
      operation: "UPDATE",
      before,
      after,
      reversible: true,
    },
  ];
  mocks.changeSetFindFirst.mockResolvedValue({
    id: "cs-1",
    scopeType: "canvas",
    scopeId: "c1",
    revertedAt: null,
  });
  mocks.tx.changeSet.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.changeRecord.findMany.mockResolvedValue(records);
  mocks.tx.canvasItem.findMany.mockResolvedValue([{ canvasId: "c1" }]);
  mocks.tx.agentAction.create.mockResolvedValue({ id: "act-rb" });
  mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-rb" });
  mocks.tx.canvasItem.update.mockImplementation(async ({ data }) => ({
    ...item(),
    ...data,
    version: 9,
  }));
});

describe("undoing a CanvasItem UPDATE", () => {
  it("restores the moved geometry but keeps the user's later content and tags", async () => {
    mocks.tx.canvasItem.findUnique.mockResolvedValue({
      ...after,
      content: { text: "<p>Edited later</p>", formatVersion: 1 },
      tags: ["a", "b"],
      width: 320,
      version: 3,
    });

    await revertChangeSet({ actor, changeSetId: "cs-1" });

    const { data } = mocks.tx.canvasItem.update.mock.calls[0]![0];
    expect(data).toMatchObject({ positionX: 0, positionY: 0, zIndex: 0 });
    expect(data).not.toHaveProperty("content");
    expect(data).not.toHaveProperty("tags");
    expect(data).not.toHaveProperty("width");
    expect(mocks.tx.changeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: "ROLLBACK_UPDATE",
        reversible: false,
      }),
    });
  });

  it("fully restores an item nobody touched since", async () => {
    mocks.tx.canvasItem.findUnique.mockResolvedValue({ ...after });

    await revertChangeSet({ actor, changeSetId: "cs-1" });

    const { data } = mocks.tx.canvasItem.update.mock.calls[0]![0];
    expect(data).toMatchObject({ positionX: 0, positionY: 0, zIndex: 0 });
    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
  });

  it("writes nothing and emits no event when every field changed since", async () => {
    mocks.tx.canvasItem.findUnique.mockResolvedValue({
      ...after,
      positionX: 10,
      positionY: 20,
      zIndex: 7,
    });

    await revertChangeSet({ actor, changeSetId: "cs-1" });

    expect(mocks.tx.canvasItem.update).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
    expect(mocks.tx.changeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: "ROLLBACK_UPDATE",
        reversible: false,
      }),
    });
  });
});
