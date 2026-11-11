import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import type * as ServiceCore from "@/lib/agents/service-core";

const mocks = vi.hoisted(() => {
  const tx = {
    agentAction: { create: vi.fn(), update: vi.fn() },
    changeSet: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    changeRecord: {
      create: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    canvas: { findFirst: vi.fn(), create: vi.fn() },
    canvasItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    itemConnection: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    agentProfile: { update: vi.fn() },
  };
  return {
    tx,
    profileFindFirst: vi.fn(),
    profileCreate: vi.fn(),
    profileUpdate: vi.fn(),
    itemFindMany: vi.fn(),
    canvasFindFirst: vi.fn(),
    changeSetFindFirst: vi.fn(),
    createSuggestionRecord: vi.fn(),
    proposeCanvasPiles: vi.fn(),
    recordEvent: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    agentProfile: {
      findFirst: mocks.profileFindFirst,
      create: mocks.profileCreate,
      update: mocks.profileUpdate,
    },
    canvasItem: { findMany: mocks.itemFindMany },
    canvas: { findFirst: mocks.canvasFindFirst },
    changeSet: { findFirst: mocks.changeSetFindFirst },
    $transaction: async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx),
  },
}));
vi.mock("@/lib/agents/piles", () => ({
  proposeCanvasPiles: mocks.proposeCanvasPiles,
}));
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: vi.fn(),
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: mocks.recordEvent,
  recordCanvasItemEventsBatch: vi.fn(),
}));
vi.mock("@/lib/cache/canvas-cache", () => ({ invalidateCanvasCache: vi.fn() }));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasCapacity: vi.fn(),
  assertCanvasItemCapacity: vi.fn(),
}));
vi.mock("@/lib/activity", () => ({
  ActivityType: { CANVAS_CREATED: "CANVAS_CREATED" },
  logActivity: vi.fn(),
}));
vi.mock("@/lib/agents/service-core", async (importOriginal) => {
  const actual = await importOriginal<typeof ServiceCore>();
  return { ...actual, createSuggestionRecord: mocks.createSuggestionRecord };
});

import {
  ASK_COMMAND_SUGGESTION_KIND,
  executeAskCommandSuggestion,
  proposeAskCommand,
} from "@/lib/ai/ask-commands";
import { revertChangeSet } from "@/lib/agents/service-core";

const profile = {
  id: "prof-ask",
  name: "Memoria assistant",
  status: "ACTIVE",
  maxCapabilityRung: 3,
  enabledRungs: [0, 3],
  allowedCanvasIds: [] as string[],
  defaultModelCredentialId: null,
};

function canvasItem(id: string, canvasId = "canvas-a", type = "BOOKMARK") {
  return {
    id,
    canvasId,
    type,
    positionX: 0,
    positionY: 0,
    width: 200,
    height: 100,
    zIndex: 0,
    content: {},
    tags: [],
    version: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // revertChangeSet claims the change set and re-reads its records in the
  // transaction (TASK-142).
  mocks.tx.changeSet.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.changeRecord.findMany.mockImplementation(
    async () =>
      (await mocks.changeSetFindFirst.mock.results.at(-1)?.value)
        ?.changeRecords ?? [],
  );
  mocks.tx.canvasItem.findMany.mockResolvedValue([]);
  mocks.tx.itemConnection?.findMany.mockResolvedValue([]);
  mocks.profileFindFirst.mockResolvedValue(profile);
  mocks.createSuggestionRecord.mockResolvedValue({
    suggestion: { id: "sugg-1", summary: "s" },
  });
  mocks.proposeCanvasPiles.mockResolvedValue({
    suggestion: { id: "sugg-pile", summary: "p" },
  });
});

describe("proposeAskCommand files suggestions only", () => {
  it("records an open suggestion with the resolved command", async () => {
    mocks.itemFindMany.mockResolvedValue([canvasItem("i1"), canvasItem("i2")]);

    await proposeAskCommand({
      userId: "user-1",
      question: "make a Japan board",
      command: { type: "create_board", name: "Japan", itemIds: ["i1", "i2"] },
    });

    expect(mocks.itemFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["i1", "i2"] },
        deletedAt: null,
        canvas: { userId: "user-1", isTemplate: false },
      },
    });
    expect(mocks.createSuggestionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          userId: "user-1",
          agentProfileId: "prof-ask",
        }),
        rung: 3,
        summary: 'Create board "Japan" and move 2 items onto it',
        payload: {
          kind: ASK_COMMAND_SUGGESTION_KIND,
          command: {
            type: "create_board",
            name: "Japan",
            itemIds: ["i1", "i2"],
          },
          question: "make a Japan board",
        },
      }),
    );
    expect(mocks.tx.canvasItem.update).not.toHaveBeenCalled();
    expect(mocks.tx.canvas.create).not.toHaveBeenCalled();
  });

  it("refuses items the user does not own", async () => {
    mocks.itemFindMany.mockResolvedValue([canvasItem("i1")]);

    await expect(
      proposeAskCommand({
        userId: "user-1",
        question: "archive",
        command: { type: "archive", itemIds: ["i1", "someone-elses"] },
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mocks.createSuggestionRecord).not.toHaveBeenCalled();
  });

  it("refuses a move to a board the user does not own", async () => {
    mocks.itemFindMany.mockResolvedValue([canvasItem("i1")]);
    mocks.canvasFindFirst.mockResolvedValue(null);

    await expect(
      proposeAskCommand({
        userId: "user-1",
        question: "move",
        command: { type: "move_items", itemIds: ["i1"], boardId: "foreign" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.canvasFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "foreign", userId: "user-1", isTemplate: false },
      }),
    );
  });

  it("files a pile through the existing piles suggestion", async () => {
    mocks.itemFindMany.mockResolvedValue([canvasItem("i1"), canvasItem("i2")]);

    await proposeAskCommand({
      userId: "user-1",
      question: "pile",
      command: { type: "make_pile", title: "Knives", itemIds: ["i1", "i2"] },
    });

    expect(mocks.profileUpdate).toHaveBeenCalledWith({
      where: { id: "prof-ask" },
      data: { allowedCanvasIds: { push: "canvas-a" } },
    });
    expect(mocks.proposeCanvasPiles).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: "canvas-a",
        piles: [{ title: "Knives", itemIds: ["i1", "i2"] }],
      }),
    );
  });

  it("refuses a pile spanning boards and images in moves", async () => {
    mocks.itemFindMany.mockResolvedValue([
      canvasItem("i1"),
      canvasItem("i2", "canvas-b"),
    ]);
    await expect(
      proposeAskCommand({
        userId: "user-1",
        question: "pile",
        command: { type: "make_pile", title: "Mixed", itemIds: ["i1", "i2"] },
      }),
    ).rejects.toBeInstanceOf(BadRequestError);

    mocks.itemFindMany.mockResolvedValue([
      canvasItem("i3", "canvas-a", "IMAGE"),
    ]);
    await expect(
      proposeAskCommand({
        userId: "user-1",
        question: "archive",
        command: { type: "archive", itemIds: ["i3"] },
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects a command type outside the allow-list", async () => {
    await expect(
      proposeAskCommand({
        userId: "user-1",
        question: "delete",
        command: { type: "delete_items", itemIds: ["i1"] } as never,
      }),
    ).rejects.toThrow();
    expect(mocks.createSuggestionRecord).not.toHaveBeenCalled();
  });
});

describe("executing an approved Ask command", () => {
  beforeEach(() => {
    mocks.tx.agentAction.create.mockResolvedValue({ id: "act-1" });
    mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-1" });
    mocks.tx.itemConnection.findMany.mockResolvedValue([]);
    mocks.tx.canvasItem.update.mockImplementation(async ({ where, data }) => ({
      ...canvasItem(where.id),
      ...data,
      version: 2,
    }));
  });

  it("creates the board and moves the owned items onto it as one change set", async () => {
    mocks.tx.canvas.create.mockResolvedValue({
      id: "board-new",
      name: "Japan",
    });
    mocks.tx.canvasItem.findMany
      .mockResolvedValueOnce([canvasItem("i1"), canvasItem("i2", "canvas-b")])
      .mockResolvedValueOnce([]);

    const result = await executeAskCommandSuggestion({
      actor: { userId: "user-1", agentProfileId: "prof-ask" },
      agentProfile: profile as never,
      payload: {
        kind: ASK_COMMAND_SUGGESTION_KIND,
        command: { type: "create_board", name: "Japan", itemIds: ["i1", "i2"] },
      },
      summary: "Create Japan",
    });

    expect(result).toMatchObject({
      boardId: "board-new",
      createdBoard: true,
      movedItemCount: 2,
      changeSetId: "cs-1",
    });
    expect(mocks.tx.canvasItem.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["i1", "i2"] },
        deletedAt: null,
        canvas: { userId: "user-1", isTemplate: false },
      },
    });
    expect(mocks.tx.canvasItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({ canvasId: "board-new" }),
      }),
    );
    const operations = mocks.tx.changeRecord.create.mock.calls.map(
      ([call]) => `${call.data.targetType}:${call.data.operation}`,
    );
    expect(operations).toEqual([
      "Canvas:CREATE",
      "CanvasItem:MOVE",
      "CanvasItem:MOVE",
    ]);
  });

  it("drops the moved item's lines on the old board in the same change set", async () => {
    mocks.tx.canvas.findFirst.mockResolvedValue({ id: "board-b", name: "B" });
    mocks.tx.canvasItem.findMany
      .mockResolvedValueOnce([canvasItem("i1")])
      .mockResolvedValueOnce([]);
    const lines = [
      {
        id: "conn-out",
        canvasId: "canvas-a",
        fromId: "i1",
        toId: "i9",
        label: "next",
        style: "DASHED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "conn-in",
        canvasId: "canvas-a",
        fromId: "i8",
        toId: "i1",
        label: null,
        style: "SOLID",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ];
    mocks.tx.itemConnection.findMany.mockResolvedValueOnce(lines);

    await executeAskCommandSuggestion({
      actor: { userId: "user-1", agentProfileId: "prof-ask" },
      agentProfile: profile as never,
      payload: {
        kind: ASK_COMMAND_SUGGESTION_KIND,
        command: { type: "move_items", itemIds: ["i1"], boardId: "board-b" },
      },
      summary: "Move 1 item",
    });

    expect(mocks.tx.itemConnection.findMany).toHaveBeenCalledWith({
      where: { OR: [{ fromId: "i1" }, { toId: "i1" }] },
    });
    expect(mocks.tx.itemConnection.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["conn-out", "conn-in"] } },
    });
    const [[{ data: dropped }]] = mocks.tx.changeRecord.createMany.mock.calls;
    expect(dropped).toEqual([
      expect.objectContaining({
        changeSetId: "cs-1",
        targetType: "ItemConnection",
        targetId: "conn-out",
        operation: "DELETE",
        before: expect.objectContaining({ fromId: "i1", toId: "i9" }),
        reversible: true,
      }),
      expect.objectContaining({
        targetId: "conn-in",
        operation: "DELETE",
        before: expect.objectContaining({ fromId: "i8", toId: "i1" }),
      }),
    ]);
    // Undo walks newest first: the lines must sort before the move.
    const [[move]] = mocks.tx.changeRecord.create.mock.calls;
    expect(move.data.operation).toBe("MOVE");
    expect(dropped[0].createdAt.getTime()).toBeLessThan(
      move.data.createdAt.getTime(),
    );
    // Old-board collaborators get the normal delete event for the item.
    expect(mocks.recordEvent).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        canvasId: "canvas-a",
        itemId: "i1",
        operation: "deleted",
      }),
    );
  });

  it("archives into the trash-backed archive instead of an Archive board", async () => {
    mocks.tx.canvasItem.findMany
      .mockResolvedValueOnce([{ canvasId: "canvas-a" }])
      .mockResolvedValueOnce([canvasItem("i1")]);

    const result = await executeAskCommandSuggestion({
      actor: { userId: "user-1", agentProfileId: "prof-ask" },
      agentProfile: profile as never,
      payload: {
        kind: ASK_COMMAND_SUGGESTION_KIND,
        command: { type: "archive", itemIds: ["i1"] },
      },
      summary: "Archive 1 item",
    });

    expect(result).toMatchObject({ changeSetId: "cs-1", archivedItemCount: 1 });
    expect(mocks.tx.canvas.create).not.toHaveBeenCalled();
    expect(mocks.tx.canvasItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({
          archivedAt: expect.any(Date),
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.tx.changeRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operation: "ARCHIVE" }),
      }),
    );
  });

  it("refuses to run when the proposing profile lost its propose rung", async () => {
    await expect(
      executeAskCommandSuggestion({
        actor: { userId: "user-1", agentProfileId: "prof-ask" },
        agentProfile: { ...profile, enabledRungs: [0] } as never,
        payload: {
          kind: ASK_COMMAND_SUGGESTION_KIND,
          command: { type: "archive", itemIds: ["i1"] },
        },
        summary: "Archive",
      }),
    ).rejects.toThrow();
    expect(mocks.tx.canvasItem.update).not.toHaveBeenCalled();
  });
});

describe("undoing an Ask move", () => {
  it("returns the item to the board and spot it came from", async () => {
    mocks.changeSetFindFirst.mockResolvedValue({
      id: "cs-1",
      scopeType: "user",
      scopeId: "user-1",
      revertedAt: null,
      changeRecords: [
        {
          id: "cr-1",
          targetType: "CanvasItem",
          targetId: "i1",
          operation: "MOVE",
          before: {
            ...canvasItem("i1", "canvas-a"),
            positionX: 40,
            positionY: 50,
          },
          after: canvasItem("i1", "board-new"),
          reversible: true,
        },
      ],
    });
    mocks.tx.agentAction.create.mockResolvedValue({ id: "act-rb" });
    mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-rb" });
    mocks.tx.canvasItem.findFirst.mockResolvedValue(
      canvasItem("i1", "board-new"),
    );
    mocks.tx.canvas.findFirst.mockResolvedValue({ id: "canvas-a" });
    mocks.tx.canvasItem.update.mockResolvedValue({
      ...canvasItem("i1", "canvas-a"),
      version: 3,
    });

    await revertChangeSet({
      actor: { userId: "user-1", agentProfileId: "prof-ask" },
      changeSetId: "cs-1",
    });

    expect(mocks.tx.canvasItem.findFirst).toHaveBeenCalledWith({
      where: { id: "i1", canvas: { userId: "user-1" } },
    });
    expect(mocks.tx.canvasItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({
          canvasId: "canvas-a",
          positionX: 40,
          positionY: 50,
        }),
      }),
    );
    expect(mocks.recordEvent).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ canvasId: "board-new", operation: "deleted" }),
    );
    expect(mocks.recordEvent).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ canvasId: "canvas-a", operation: "created" }),
    );
  });

  function moveChangeSet() {
    mocks.changeSetFindFirst.mockResolvedValue({
      id: "cs-1",
      scopeType: "user",
      scopeId: "user-1",
      revertedAt: null,
      changeRecords: [
        {
          id: "cr-1",
          targetType: "CanvasItem",
          targetId: "i1",
          operation: "MOVE",
          before: canvasItem("i1", "canvas-a"),
          after: canvasItem("i1", "board-new"),
          reversible: true,
        },
      ],
    });
    mocks.tx.agentAction.create.mockResolvedValue({ id: "act-rb" });
    mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-rb" });
    mocks.tx.canvas.findFirst.mockResolvedValue({ id: "canvas-a" });
    mocks.tx.canvasItem.update.mockResolvedValue({
      ...canvasItem("i1", "canvas-a"),
      version: 3,
    });
  }

  it.each([
    [
      "moved to a third board",
      { ...canvasItem("i1", "board-c"), deletedAt: null },
    ],
    ["trashed", { ...canvasItem("i1", "board-new"), deletedAt: new Date() }],
  ])("refuses to undo once the user has %s the item", async (_case, item) => {
    moveChangeSet();
    mocks.tx.canvasItem.findFirst.mockResolvedValue(item);

    await expect(
      revertChangeSet({
        actor: { userId: "user-1", agentProfileId: "prof-ask" },
        changeSetId: "cs-1",
      }),
    ).rejects.toMatchObject({ detail: expect.stringMatching(/moved since/) });
    expect(mocks.tx.canvasItem.update).not.toHaveBeenCalled();
  });

  it("drops lines drawn on the destination board before the item goes back", async () => {
    moveChangeSet();
    mocks.tx.canvasItem.findFirst.mockResolvedValue({
      ...canvasItem("i1", "board-new"),
      deletedAt: null,
    });
    const line = {
      id: "conn-new",
      canvasId: "board-new",
      fromId: "i1",
      toId: "i7",
      label: null,
      style: "SOLID",
      createdAt: "2026-02-01T00:00:00.000Z",
    };
    mocks.tx.itemConnection.findMany.mockResolvedValue([line]);

    await revertChangeSet({
      actor: { userId: "user-1", agentProfileId: "prof-ask" },
      changeSetId: "cs-1",
    });

    expect(mocks.tx.itemConnection.findMany).toHaveBeenCalledWith({
      where: {
        canvasId: "board-new",
        OR: [{ fromId: "i1" }, { toId: "i1" }],
      },
    });
    expect(mocks.tx.itemConnection.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["conn-new"] } },
    });
    expect(mocks.tx.changeRecord.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          changeSetId: "cs-rb",
          targetType: "ItemConnection",
          targetId: "conn-new",
          operation: "ROLLBACK_DELETE",
          reversible: false,
        }),
      ],
    });
    expect(
      mocks.tx.itemConnection.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.tx.canvasItem.update.mock.invocationCallOrder[0]!);
  });

  it("restores the lines the move dropped once the item is back", async () => {
    const line = {
      id: "conn-1",
      canvasId: "canvas-a",
      fromId: "i1",
      toId: "i9",
      label: "next",
      style: "DASHED",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const gone = { ...line, id: "conn-2", toId: "i-gone" };
    mocks.changeSetFindFirst.mockResolvedValue({
      id: "cs-1",
      scopeType: "user",
      scopeId: "user-1",
      revertedAt: null,
      changeRecords: [
        {
          id: "cr-move",
          targetType: "CanvasItem",
          targetId: "i1",
          operation: "MOVE",
          before: canvasItem("i1", "canvas-a"),
          after: canvasItem("i1", "board-new"),
          reversible: true,
        },
        {
          id: "cr-line",
          targetType: "ItemConnection",
          targetId: "conn-1",
          operation: "DELETE",
          before: line,
          after: null,
          reversible: true,
        },
        {
          id: "cr-gone",
          targetType: "ItemConnection",
          targetId: "conn-2",
          operation: "DELETE",
          before: gone,
          after: null,
          reversible: true,
        },
      ],
    });
    mocks.tx.agentAction.create.mockResolvedValue({ id: "act-rb" });
    mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-rb" });
    mocks.tx.canvasItem.findFirst.mockResolvedValue(
      canvasItem("i1", "board-new"),
    );
    mocks.tx.canvas.findFirst.mockResolvedValue({ id: "canvas-a" });
    mocks.tx.canvasItem.update.mockResolvedValue({
      ...canvasItem("i1", "canvas-a"),
      version: 3,
    });
    // Both ends of conn-1 are on the board; conn-2 lost its other end.
    mocks.tx.canvasItem.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    mocks.tx.itemConnection.findFirst.mockResolvedValue(null);
    mocks.tx.itemConnection.create.mockImplementation(async ({ data }) => data);

    await revertChangeSet({
      actor: { userId: "user-1", agentProfileId: "prof-ask" },
      changeSetId: "cs-1",
    });

    expect(mocks.tx.canvasItem.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tx.itemConnection.create.mock.invocationCallOrder[0]!,
    );
    expect(mocks.tx.canvasItem.count).toHaveBeenCalledWith({
      where: { id: { in: ["i1", "i9"] }, canvasId: "canvas-a" },
    });
    expect(mocks.tx.itemConnection.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.itemConnection.create).toHaveBeenCalledWith({
      data: {
        id: "conn-1",
        canvasId: "canvas-a",
        fromId: "i1",
        toId: "i9",
        label: "next",
        style: "DASHED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    expect(mocks.tx.changeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeSetId: "cs-rb",
        targetType: "ItemConnection",
        targetId: "conn-1",
        operation: "ROLLBACK_DELETE",
      }),
    });
  });
});
