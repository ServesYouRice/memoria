import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProfileStatus } from "@/generated/prisma/client";
import { assertCanvasScope } from "@/lib/agents/policy";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

const mocks = vi.hoisted(() => {
  const tx = {
    canvas: { findFirst: vi.fn(), create: vi.fn() },
    agentAction: { create: vi.fn(), update: vi.fn() },
    agentProfile: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
    changeSet: { create: vi.fn(), update: vi.fn() },
    changeRecord: { create: vi.fn() },
  };
  return {
    tx,
    canvasFindFirst: vi.fn(),
    canvasFindMany: vi.fn(),
    canvasItemFindMany: vi.fn(),
    commentFindMany: vi.fn(),
    queryRaw: vi.fn(async (): Promise<unknown[]> => []),
    createCanvasItemComment: vi.fn(),
    createCanvasItemWrite: vi.fn(),
    requireScopedItem: vi.fn(),
    getScopedItemDetail: vi.fn(),
    assertCanvasCapacity: vi.fn(),
    logActivity: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: {
      findFirst: mocks.canvasFindFirst,
      findMany: mocks.canvasFindMany,
    },
    canvasItem: { findMany: mocks.canvasItemFindMany },
    comment: { findMany: mocks.commentFindMany },
    // Duplicate-link lookup (IMP-065).
    $queryRaw: () => mocks.queryRaw(),
    $transaction: async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx),
  },
}));

vi.mock("@/lib/agents/service-core", () => ({
  createCanvasItemComment: mocks.createCanvasItemComment,
  createCanvasItemWrite: mocks.createCanvasItemWrite,
}));

vi.mock("@/lib/agents/query-core", () => ({
  requireScopedItem: mocks.requireScopedItem,
  getScopedItemDetail: mocks.getScopedItemDetail,
}));

vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasCapacity: mocks.assertCanvasCapacity,
}));

vi.mock("@/lib/activity", () => ({
  ActivityType: { CANVAS_CREATED: "CANVAS_CREATED" },
  logActivity: mocks.logActivity,
}));

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(),
}));

import { executeMcpTool, formatItemAnnotation } from "@/lib/agents/mcp";

const canvasId = "ccanvas000000000000000001";
const otherCanvasId = "ccanvas000000000000000002";
const itemId = "citem000000000000000000001";

function profile(overrides?: {
  allowedCanvasIds?: string[];
  enabledRungs?: number[];
}) {
  return {
    id: "prof-hermes",
    userId: "user-123",
    name: "Hermes",
    status: AgentProfileStatus.ACTIVE,
    maxCapabilityRung: 3,
    enabledRungs: [0, 1, 2, 3],
    allowedCanvasIds: [canvasId],
    defaultModelCredentialId: null,
    ...overrides,
  };
}

function call(
  agentProfile: ReturnType<typeof profile>,
  tool: string,
  args: Record<string, unknown>,
) {
  return executeMcpTool(
    {
      actorType: "integration",
      userId: "user-123",
      agentProfile,
      integrationAccountId: "cint0000000000000000000001",
    },
    tool,
    args,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireScopedItem.mockImplementation(
    async (ctx: { agentProfile: ReturnType<typeof profile> }) => {
      assertCanvasScope(ctx.agentProfile, canvasId);
      return { id: itemId, canvasId };
    },
  );
  mocks.createCanvasItemComment.mockResolvedValue({
    comment: { id: "ccomment00000000000000001" },
    agentActionId: "act-1",
    changeSetId: "cs-1",
  });
  mocks.createCanvasItemWrite.mockResolvedValue({
    item: { id: "cnew0000000000000000000001" },
    changeSetId: "cs-2",
  });
  mocks.canvasItemFindMany.mockResolvedValue([]);
  mocks.tx.agentAction.create.mockResolvedValue({ id: "act-board" });
  mocks.tx.agentProfile.findUniqueOrThrow.mockResolvedValue({
    allowedCanvasIds: [canvasId],
  });
  mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-board" });
  mocks.tx.canvas.create.mockResolvedValue({
    id: "cboard00000000000000000001",
    name: "Trip to Lisbon",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
});

describe("items_annotate (IMP-067)", () => {
  it("appends a labeled summary as an audited comment, never an item edit", async () => {
    const result = await call(profile(), "items_annotate", {
      itemId,
      kind: "summary",
      text: "A walking guide to Alfama.",
    });

    expect(mocks.createCanvasItemComment).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId,
        content: "Summary from Hermes: A walking guide to Alfama.",
        actor: expect.objectContaining({ agentProfileId: "prof-hermes" }),
      }),
    );
    expect(mocks.createCanvasItemWrite).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      itemId,
      kind: "summary",
      changeSetId: "cs-1",
    });
  });

  it("defaults to a note", () => {
    expect(
      formatItemAnnotation({ kind: "note", agentName: "Bot", text: "hi" }),
    ).toBe("Note from Bot: hi");
  });

  it("refuses an item outside the agent's boards", async () => {
    await expect(
      call(profile({ allowedCanvasIds: [otherCanvasId] }), "items_annotate", {
        itemId,
        text: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.createCanvasItemComment).not.toHaveBeenCalled();
  });

  it("refuses when the comment rung is disabled", async () => {
    await expect(
      call(profile({ enabledRungs: [0, 1, 3] }), "items_annotate", {
        itemId,
        text: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.createCanvasItemComment).not.toHaveBeenCalled();
  });

  it("rejects empty text", async () => {
    await expect(
      call(profile(), "items_annotate", { itemId, text: "  " }),
    ).rejects.toThrow();
    expect(mocks.createCanvasItemComment).not.toHaveBeenCalled();
  });
});

describe("boards_create and boards_list (IMP-067)", () => {
  it("creates a board, grants it to the agent and records a revertible change", async () => {
    mocks.tx.canvas.findFirst.mockResolvedValue(null);

    const result = await call(profile(), "boards_create", {
      name: " Trip to Lisbon ",
    });

    expect(mocks.assertCanvasCapacity).toHaveBeenCalledTimes(1);
    expect(mocks.tx.canvas.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "Trip to Lisbon", userId: "user-123" },
      }),
    );
    expect(mocks.tx.agentProfile.update).toHaveBeenCalledWith({
      where: { id: "prof-hermes" },
      data: { allowedCanvasIds: { push: "cboard00000000000000000001" } },
    });
    expect(mocks.tx.changeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: "Canvas",
        targetId: "cboard00000000000000000001",
        operation: "CREATE",
        reversible: true,
        after: expect.objectContaining({
          grantedAgentProfileId: "prof-hermes",
        }),
      }),
    });
    expect(mocks.tx.agentAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "INGEST", rung: 1 }),
    });
    expect(result.structuredContent).toMatchObject({
      canvasId: "cboard00000000000000000001",
      created: true,
      changeSetId: "cs-board",
    });
  });

  it("reuses the agent's board with the same name instead of making another", async () => {
    mocks.tx.canvas.findFirst.mockResolvedValue({
      id: canvasId,
      name: "Trip to Lisbon",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const result = await call(profile(), "boards_create", {
      name: "trip to lisbon",
    });

    expect(mocks.tx.canvas.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [canvasId] } }),
      }),
    );
    expect(mocks.tx.canvas.create).not.toHaveBeenCalled();
    expect(mocks.tx.agentProfile.update).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      canvasId,
      created: false,
    });
  });

  it("refuses to create a board when the ingest rung is disabled", async () => {
    await expect(
      call(profile({ enabledRungs: [0, 2, 3] }), "boards_create", {
        name: "Errands",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.tx.canvas.create).not.toHaveBeenCalled();
  });

  it("lists only boards in the agent's scope", async () => {
    mocks.canvasFindMany.mockResolvedValue([
      {
        id: canvasId,
        name: "Inbox",
        createdAt: new Date(0),
        updatedAt: new Date(0),
        _count: { items: 4 },
      },
    ]);

    const result = await call(profile(), "boards_list", { query: "inb" });

    expect(mocks.canvasFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-123",
          id: { in: [canvasId] },
          name: { contains: "inb", mode: "insensitive" },
        }),
      }),
    );
    expect(result.structuredContent).toEqual({
      boards: [
        expect.objectContaining({
          boardId: canvasId,
          name: "Inbox",
          itemCount: 4,
        }),
      ],
    });
  });
});

describe("inbox_save with a target board (IMP-067)", () => {
  it("saves onto the named board when it is in scope", async () => {
    mocks.canvasFindFirst.mockResolvedValue({ id: canvasId, name: "Trips" });

    const result = await call(profile(), "inbox_save", {
      url: "https://hotel.example/one",
      canvasId,
    });

    expect(mocks.createCanvasItemWrite).toHaveBeenCalledWith(
      expect.objectContaining({ canvasId, summary: "Save link to Trips" }),
    );
    expect(result.structuredContent).toMatchObject({ canvasId });
  });

  it("names the existing item instead of saving a link twice", async () => {
    mocks.canvasFindFirst.mockResolvedValue({ id: canvasId, name: "Trips" });
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: itemId,
        canvasId,
        canvasName: "Trips",
        url: "https://hotel.example/one/?utm_source=mail",
        title: "Hotel one",
      },
    ]);

    const result = await call(profile(), "inbox_save", {
      url: "https://hotel.example/one",
      canvasId,
    });

    expect(mocks.createCanvasItemWrite).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      saved: false,
      duplicate: true,
      itemId,
      canvasId,
      existing: [{ itemId, board: "Trips", title: "Hotel one" }],
    });
  });

  it("never reveals a saved copy on a board outside the agent's scope", async () => {
    mocks.canvasFindFirst.mockResolvedValue({ id: canvasId, name: "Trips" });
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: "citem-private",
        canvasId: otherCanvasId,
        canvasName: "Private",
        url: "https://hotel.example/one",
        title: "Secret",
      },
    ]);
    mocks.createCanvasItemWrite.mockResolvedValueOnce({
      item: { id: "cnew" },
      changeSetId: "cs1",
    });

    const result = await call(profile(), "inbox_save", {
      url: "https://hotel.example/one",
      canvasId,
    });

    expect(mocks.createCanvasItemWrite).toHaveBeenCalled();
    expect(JSON.stringify(result.structuredContent)).not.toContain("Secret");
    expect(result.structuredContent).toMatchObject({ saved: true });
  });

  it("refuses a board outside the agent's scope", async () => {
    mocks.canvasFindFirst.mockResolvedValue({
      id: otherCanvasId,
      name: "Private",
    });

    await expect(
      call(profile(), "inbox_save", { text: "hi", canvasId: otherCanvasId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.createCanvasItemWrite).not.toHaveBeenCalled();
  });

  it("reports a missing board", async () => {
    mocks.canvasFindFirst.mockResolvedValue(null);

    await expect(
      call(profile(), "inbox_save", { text: "hi", canvasId: "cmissing" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("items_get annotations (IMP-067)", () => {
  it("returns existing annotations so agents can skip summarized items", async () => {
    mocks.getScopedItemDetail.mockResolvedValue({
      item: { id: itemId, canvasId, text: "page" },
    });
    mocks.commentFindMany.mockResolvedValue([
      {
        id: "c1",
        content: "Summary from Hermes: done",
        createdAt: new Date(0),
      },
    ]);

    const result = await call(profile(), "items_get", { itemId });

    expect(mocks.commentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { itemId, deletedAt: null } }),
    );
    expect(result.structuredContent).toMatchObject({
      item: { annotations: [{ content: "Summary from Hermes: done" }] },
    });
  });
});
