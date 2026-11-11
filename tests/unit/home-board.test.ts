import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    homeBoardSuggestion: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    suggestion: { findFirst: vi.fn(), updateMany: vi.fn() },
    canvasItem: { findFirst: vi.fn() },
    changeSet: { findFirst: vi.fn() },
    changeRecord: { findFirst: vi.fn() },
    canvas: { findFirst: vi.fn() },
    agentProfile: { findFirst: vi.fn() },
  };
  return {
    db,
    approveSuggestion: vi.fn(),
    claimSuggestionForExecution: vi.fn(),
    createSuggestionRecordTx: vi.fn(),
    markSuggestionExecuted: vi.fn(),
    rejectSuggestion: vi.fn(),
    releaseSuggestionClaim: vi.fn(),
    revertChangeSet: vi.fn(),
    executeAskCommandSuggestion: vi.fn(),
    getAskAssistantProfile: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/agents/inbox", () => ({ INBOX_CANVAS_NAME: "Inbox" }));
vi.mock("@/lib/agents/service-core", () => ({
  approveSuggestion: mocks.approveSuggestion,
  claimSuggestionForExecution: mocks.claimSuggestionForExecution,
  createSuggestionRecordTx: mocks.createSuggestionRecordTx,
  markSuggestionExecuted: mocks.markSuggestionExecuted,
  rejectSuggestion: mocks.rejectSuggestion,
  releaseSuggestionClaim: mocks.releaseSuggestionClaim,
  revertChangeSet: mocks.revertChangeSet,
}));
vi.mock("@/lib/ai/ask-commands", () => ({
  ARCHIVE_BOARD_NAME: "Archive",
  ASK_COMMAND_SUGGESTION_KIND: "ask-command",
  ASK_MOVE_OPERATION: "MOVE",
  executeAskCommandSuggestion: mocks.executeAskCommandSuggestion,
  getAskAssistantProfile: mocks.getAskAssistantProfile,
}));
vi.mock("@/lib/ai/budget", () => ({ isAiEnabled: () => true }));
vi.mock("@/lib/ai/provider-resolution", () => ({
  getAiAvailability: vi.fn(async () => ({ configured: false })),
}));

import {
  AUTO_FILE_CONFIDENCE,
  HOME_BOARD_JOB,
  MIN_PROPOSE_CONFIDENCE,
  acceptHomeBoardSuggestion,
  createHomeBoardProposalHandler,
  dismissHomeBoardSuggestion,
  enqueueHomeBoardProposal,
  proposeHomeBoard,
  rankHomeBoards,
  tokenize,
  undoHomeBoardMove,
  type HomeBoardCandidate,
} from "@/lib/agents/home-board";

const profile = {
  id: "prof-assistant",
  defaultModelCredentialId: null,
  maxCapabilityRung: 2,
  enabledRungs: [1, 2],
  allowedCanvasIds: [],
  status: "ACTIVE",
};

function board(
  id: string,
  name: string,
  extra: Partial<HomeBoardCandidate> = {},
): HomeBoardCandidate {
  return { id, name, itemCount: 0, tagCounts: {}, ...extra };
}

describe("rankHomeBoards", () => {
  it("normalizes words so tags meet board names", () => {
    expect(tokenize("Rome Trips — Café")).toEqual(["rome", "trip", "cafe"]);
  });

  it("matches a tag to a board name without AI", () => {
    const [best] = rankHomeBoards(
      { title: "Colosseum tickets", tags: ["Rome trip", "travel"] },
      [board("b-rome", "Rome trip"), board("b-work", "Work")],
    );
    expect(best).toMatchObject({ boardId: "b-rome", reasons: ["board-name"] });
    expect(best!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("uses the tags already on a board", () => {
    const ranked = rankHomeBoards(
      { title: "A pasta recipe", tags: ["pasta", "dinner"] },
      [
        board("b-food", "Weeknight ideas", {
          itemCount: 4,
          tagCounts: { pasta: 3, dinner: 2 },
        }),
        board("b-work", "Work", { itemCount: 3, tagCounts: { meeting: 3 } }),
      ],
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ boardId: "b-food", reasons: ["tags"] });
    expect(ranked[0]!.confidence).toBeGreaterThan(MIN_PROPOSE_CONFIDENCE);
  });

  it("adds embedding similarity only when a vector is passed", () => {
    const boards = [
      board("b-a", "Reading list", { itemCount: 2, vectors: [[1, 0, 0]] }),
      board("b-b", "Garden", { itemCount: 2, vectors: [[0, 1, 0]] }),
    ];
    const withAi = rankHomeBoards(
      { title: "Essay", tags: [], vector: [0.99, 0.05, 0] },
      boards,
    );
    expect(withAi[0]).toMatchObject({
      boardId: "b-a",
      reasons: ["similar-items"],
    });
    expect(rankHomeBoards({ title: "Essay", tags: [] }, boards)).toEqual([]);
  });

  it("never auto-files a near tie", () => {
    const [best] = rankHomeBoards({ title: "x", tags: ["rome", "ideas"] }, [
      board("b-1", "Rome"),
      board("b-2", "Rome ideas"),
    ]);
    expect(best!.confidence).toBeLessThan(AUTO_FILE_CONFIDENCE);
  });
});

function makeJobDb(options: {
  existing?: Record<string, unknown> | null;
  canvasName?: string;
  autoFileItems?: boolean;
  tags?: string[];
}) {
  const tx = {
    homeBoardSuggestion: {
      createMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(),
    },
  };
  const db = {
    canvasItem: {
      findUnique: vi.fn(async () => ({
        id: "item-1",
        canvasId: "c-inbox",
        deletedAt: null,
        content: { url: "https://example.com", title: "Colosseum tickets" },
        tags: options.tags ?? ["rome trip"],
        canvas: {
          userId: "user-1",
          name: options.canvasName ?? "Inbox",
          isTemplate: false,
        },
        homeBoardSuggestion: options.existing ?? null,
      })),
      groupBy: vi.fn(async () => [{ canvasId: "c-rome", _count: { _all: 2 } }]),
    },
    canvas: {
      findMany: vi.fn(async () => [
        { id: "c-rome", name: "Rome trip" },
        { id: "c-inbox-2", name: "inbox" },
        { id: "c-archive", name: "Archive" },
        { id: "c-work", name: "Work" },
      ]),
    },
    itemEmbedding: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    user: {
      findUnique: vi.fn(async () => ({
        autoFileItems: options.autoFileItems ?? false,
      })),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { db, tx };
}

function openRow(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "item-1",
    userId: "user-1",
    sourceCanvasId: "c-inbox",
    targetCanvasId: "c-rome",
    confidence: 0.9,
    reasons: ["board-name"],
    status: "OPEN",
    suggestionId: "sug-1",
    changeSetId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAskAssistantProfile.mockResolvedValue(profile);
  mocks.createSuggestionRecordTx.mockResolvedValue({
    suggestion: { id: "sug-1" },
  });
  mocks.db.homeBoardSuggestion.findFirst.mockResolvedValue(openRow());
  mocks.db.homeBoardSuggestion.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.suggestion.findFirst.mockResolvedValue({
    id: "sug-1",
    status: "OPEN",
    agentProfileId: profile.id,
    summary: 'Move "Colosseum tickets" to "Rome trip"',
    payload: {
      kind: "ask-command",
      command: { type: "move_items", itemIds: ["item-1"], boardId: "c-rome" },
    },
  });
  mocks.db.canvasItem.findFirst.mockResolvedValue({ canvasId: "c-inbox" });
  mocks.db.agentProfile.findFirst.mockResolvedValue(profile);
  mocks.executeAskCommandSuggestion.mockResolvedValue({
    changeSetId: "cs-move",
    boardId: "c-rome",
    boardName: "Rome trip",
  });
});

describe("board.propose job", () => {
  it("files a move suggestion through the Ask suggestion path", async () => {
    const { db, tx } = makeJobDb({});
    const outcome = await proposeHomeBoard(db as never, "item-1", {
      aiAvailable: async () => false,
    });

    expect(outcome).toMatchObject({ status: "proposed", boardId: "c-rome" });
    expect(db.itemEmbedding.findFirst).not.toHaveBeenCalled();
    expect(tx.homeBoardSuggestion.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          itemId: "item-1",
          userId: "user-1",
          sourceCanvasId: "c-inbox",
          targetCanvasId: "c-rome",
        }),
      ],
      skipDuplicates: true,
    });
    expect(mocks.createSuggestionRecordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actor: expect.objectContaining({ agentProfileId: profile.id }),
        payload: expect.objectContaining({
          kind: "ask-command",
          command: {
            type: "move_items",
            itemIds: ["item-1"],
            boardId: "c-rome",
          },
        }),
      }),
    );
    expect(tx.homeBoardSuggestion.update).toHaveBeenCalledWith({
      where: { itemId: "item-1" },
      data: { suggestionId: "sug-1" },
    });
    expect(mocks.executeAskCommandSuggestion).not.toHaveBeenCalled();
  });

  it("files automatically above the threshold when the user allows it", async () => {
    const { db } = makeJobDb({ autoFileItems: true });
    const outcome = await proposeHomeBoard(db as never, "item-1", {
      aiAvailable: async () => false,
    });

    expect(outcome.status).toBe("auto-filed");
    expect(mocks.approveSuggestion).toHaveBeenCalled();
    expect(mocks.executeAskCommandSuggestion).toHaveBeenCalledTimes(1);
    expect(mocks.db.homeBoardSuggestion.updateMany).toHaveBeenCalledWith({
      where: { itemId: "item-1", status: "OPEN" },
      data: expect.objectContaining({
        status: "AUTO_FILED",
        changeSetId: "cs-move",
      }),
    });
  });

  it("only suggests a match below the auto-file threshold", async () => {
    // "rome" alone matches one of two words of "Rome trip".
    const { db } = makeJobDb({ autoFileItems: true, tags: ["rome", "food"] });
    const outcome = await proposeHomeBoard(db as never, "item-1", {
      aiAvailable: async () => false,
    });

    expect(outcome.status).toBe("proposed");
    expect((outcome as { confidence: number }).confidence).toBeLessThan(
      AUTO_FILE_CONFIDENCE,
    );
    expect(mocks.executeAskCommandSuggestion).not.toHaveBeenCalled();
  });

  it("does not propose again once the item was dismissed", async () => {
    const { db, tx } = makeJobDb({
      existing: openRow({ status: "DISMISSED" }),
      autoFileItems: true,
    });
    const outcome = await proposeHomeBoard(db as never, "item-1");

    expect(outcome).toEqual({ status: "skipped", reason: "already-proposed" });
    expect(tx.homeBoardSuggestion.createMany).not.toHaveBeenCalled();
    expect(mocks.createSuggestionRecordTx).not.toHaveBeenCalled();
    expect(mocks.executeAskCommandSuggestion).not.toHaveBeenCalled();
  });

  it("a rerun finishes an auto-file that was interrupted", async () => {
    const { db, tx } = makeJobDb({
      existing: openRow({ confidence: 0.95 }),
      autoFileItems: true,
    });
    const outcome = await proposeHomeBoard(db as never, "item-1");

    expect(outcome.status).toBe("auto-filed");
    expect(tx.homeBoardSuggestion.createMany).not.toHaveBeenCalled();
    expect(mocks.executeAskCommandSuggestion).toHaveBeenCalledTimes(1);
  });

  it("leaves items on other boards alone", async () => {
    const { db } = makeJobDb({ canvasName: "Rome trip" });
    const handler = createHomeBoardProposalHandler(db as never);
    await handler({ payload: { itemId: "item-1" } } as never);
    expect(mocks.createSuggestionRecordTx).not.toHaveBeenCalled();
  });

  it("is enqueued only for the owner's Inbox", async () => {
    const tx = {
      canvas: { findUnique: vi.fn() },
      outboxJob: { upsert: vi.fn() },
    };
    tx.canvas.findUnique.mockResolvedValueOnce({
      userId: "user-1",
      name: "Inbox",
      isTemplate: false,
    });
    expect(
      await enqueueHomeBoardProposal(tx as never, {
        itemId: "item-1",
        canvasId: "c-inbox",
        userId: "user-1",
      }),
    ).toBe(true);
    expect(tx.outboxJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupeKey: `${HOME_BOARD_JOB}:item-1` },
      }),
    );

    tx.canvas.findUnique.mockResolvedValueOnce({
      userId: "user-1",
      name: "Work",
      isTemplate: false,
    });
    expect(
      await enqueueHomeBoardProposal(tx as never, {
        itemId: "item-2",
        canvasId: "c-work",
        userId: "user-1",
      }),
    ).toBe(false);
    expect(tx.outboxJob.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("accept, dismiss, undo", () => {
  it("has the executor recheck the source board under its locks", async () => {
    await acceptHomeBoardSuggestion({ userId: "user-1", itemId: "item-1" });

    expect(mocks.executeAskCommandSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSourceCanvasId: "c-inbox" }),
    );
  });

  it("accepting runs the approved move and records its change set", async () => {
    const result = await acceptHomeBoardSuggestion({
      userId: "user-1",
      itemId: "item-1",
    });

    expect(mocks.approveSuggestion).toHaveBeenCalledWith({
      userId: "user-1",
      suggestionId: "sug-1",
    });
    expect(mocks.claimSuggestionForExecution).toHaveBeenCalled();
    expect(mocks.markSuggestionExecuted).toHaveBeenCalled();
    expect(result).toMatchObject({
      changeSetId: "cs-move",
      boardName: "Rome trip",
    });
    expect(mocks.db.homeBoardSuggestion.updateMany).toHaveBeenCalledWith({
      where: { itemId: "item-1", status: "OPEN" },
      data: expect.objectContaining({
        status: "ACCEPTED",
        changeSetId: "cs-move",
      }),
    });
  });

  it("a rerun after approve committed claims and runs the move without re-approving", async () => {
    mocks.db.suggestion.findFirst.mockResolvedValue({
      ...(await mocks.db.suggestion.findFirst()),
      status: "APPROVED",
    });

    const result = await acceptHomeBoardSuggestion({
      userId: "user-1",
      itemId: "item-1",
      automatic: true,
    });

    expect(mocks.approveSuggestion).not.toHaveBeenCalled();
    expect(mocks.claimSuggestionForExecution).toHaveBeenCalled();
    expect(mocks.executeAskCommandSuggestion).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ changeSetId: "cs-move" });
    expect(mocks.db.homeBoardSuggestion.updateMany).toHaveBeenCalledWith({
      where: { itemId: "item-1", status: "OPEN" },
      data: expect.objectContaining({
        status: "AUTO_FILED",
        changeSetId: "cs-move",
      }),
    });
  });

  it("a rerun after the move committed records its change set instead of dismissing", async () => {
    mocks.db.homeBoardSuggestion.findFirst.mockResolvedValue(
      openRow({ createdAt: new Date("2026-11-01T00:00:00Z") }),
    );
    mocks.db.suggestion.findFirst.mockResolvedValue({
      ...(await mocks.db.suggestion.findFirst()),
      status: "EXECUTING",
    });
    mocks.db.canvasItem.findFirst.mockResolvedValue({ canvasId: "c-rome" });
    mocks.db.changeRecord.findFirst.mockResolvedValue({
      changeSetId: "cs-committed",
      after: { canvasId: "c-rome" },
    });
    mocks.db.canvas.findFirst.mockResolvedValue({ name: "Rome trip" });

    const result = await acceptHomeBoardSuggestion({
      userId: "user-1",
      itemId: "item-1",
      automatic: true,
    });

    expect(mocks.executeAskCommandSuggestion).not.toHaveBeenCalled();
    expect(mocks.markSuggestionExecuted).toHaveBeenCalledWith({
      userId: "user-1",
      suggestionId: "sug-1",
    });
    expect(result).toMatchObject({
      changeSetId: "cs-committed",
      boardId: "c-rome",
      boardName: "Rome trip",
    });
    expect(mocks.db.homeBoardSuggestion.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.homeBoardSuggestion.updateMany).toHaveBeenCalledWith({
      where: { itemId: "item-1", status: "OPEN" },
      data: expect.objectContaining({
        status: "AUTO_FILED",
        changeSetId: "cs-committed",
      }),
    });
    expect(mocks.db.suggestion.updateMany).not.toHaveBeenCalled();
  });

  it("refuses rather than dismissing when a committed move cannot be found", async () => {
    mocks.db.suggestion.findFirst.mockResolvedValue({
      ...(await mocks.db.suggestion.findFirst()),
      status: "EXECUTING",
    });
    mocks.db.canvasItem.findFirst.mockResolvedValue({ canvasId: "c-rome" });
    mocks.db.changeRecord.findFirst.mockResolvedValue(null);

    await expect(
      acceptHomeBoardSuggestion({ userId: "user-1", itemId: "item-1" }),
    ).rejects.toMatchObject({ detail: expect.stringMatching(/confirmed/) });
    expect(mocks.db.homeBoardSuggestion.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.suggestion.updateMany).not.toHaveBeenCalled();
  });

  it("releases a stranded claim when the item never left the Inbox, then runs the move", async () => {
    mocks.db.suggestion.findFirst.mockResolvedValue({
      ...(await mocks.db.suggestion.findFirst()),
      status: "EXECUTING",
    });

    await acceptHomeBoardSuggestion({ userId: "user-1", itemId: "item-1" });

    expect(mocks.releaseSuggestionClaim).toHaveBeenCalledWith({
      userId: "user-1",
      suggestionId: "sug-1",
    });
    expect(mocks.claimSuggestionForExecution).toHaveBeenCalled();
    expect(mocks.executeAskCommandSuggestion).toHaveBeenCalledTimes(1);
  });

  it("drops a suggestion whose item already left the Inbox", async () => {
    mocks.db.canvasItem.findFirst.mockResolvedValue({ canvasId: "c-work" });
    await expect(
      acceptHomeBoardSuggestion({ userId: "user-1", itemId: "item-1" }),
    ).rejects.toMatchObject({ detail: expect.stringMatching(/already moved/) });
    expect(mocks.executeAskCommandSuggestion).not.toHaveBeenCalled();
    expect(mocks.db.homeBoardSuggestion.updateMany).toHaveBeenCalledWith({
      where: { itemId: "item-1", status: "OPEN" },
      data: expect.objectContaining({ status: "DISMISSED" }),
    });
  });

  it("refuses to accept a dismissed suggestion", async () => {
    mocks.db.homeBoardSuggestion.findFirst.mockResolvedValue(
      openRow({ status: "DISMISSED" }),
    );
    await expect(
      acceptHomeBoardSuggestion({ userId: "user-1", itemId: "item-1" }),
    ).rejects.toMatchObject({
      detail: expect.stringMatching(/no longer open/),
    });
  });

  it("dismissing rejects the suggestion and keeps the item", async () => {
    await dismissHomeBoardSuggestion({ userId: "user-1", itemId: "item-1" });
    expect(mocks.rejectSuggestion).toHaveBeenCalledWith({
      userId: "user-1",
      suggestionId: "sug-1",
    });
    expect(mocks.executeAskCommandSuggestion).not.toHaveBeenCalled();
  });

  it("undo reverts the move's change set in one step", async () => {
    mocks.db.homeBoardSuggestion.findFirst.mockResolvedValue(
      openRow({ status: "AUTO_FILED", changeSetId: "cs-move" }),
    );
    mocks.db.changeSet.findFirst.mockResolvedValue({
      id: "cs-move",
      agentProfileId: profile.id,
      revertedAt: null,
    });
    mocks.revertChangeSet.mockResolvedValue({
      rollbackChangeSetId: "cs-rollback",
    });
    // The filed item is still on the board it was filed to.
    mocks.db.canvasItem.findFirst.mockResolvedValue({
      canvasId: "c-rome",
      deletedAt: null,
    });

    const result = await undoHomeBoardMove({
      userId: "user-1",
      itemId: "item-1",
    });

    expect(mocks.revertChangeSet).toHaveBeenCalledWith({
      actor: expect.objectContaining({
        userId: "user-1",
        agentProfileId: profile.id,
      }),
      changeSetId: "cs-move",
    });
    expect(result).toMatchObject({ rollbackChangeSetId: "cs-rollback" });
    expect(mocks.db.homeBoardSuggestion.updateMany).toHaveBeenCalledWith({
      where: { itemId: "item-1", status: "AUTO_FILED" },
      data: expect.objectContaining({ status: "REVERTED" }),
    });
  });

  it.each([
    ["moved to another board", { canvasId: "c-work", deletedAt: null }],
    ["trashed", { canvasId: "c-rome", deletedAt: new Date() }],
  ])("refuses to undo once the user has %s the item", async (_case, item) => {
    mocks.db.homeBoardSuggestion.findFirst.mockResolvedValue(
      openRow({ status: "ACCEPTED", changeSetId: "cs-move" }),
    );
    mocks.db.changeSet.findFirst.mockResolvedValue({
      id: "cs-move",
      agentProfileId: profile.id,
      revertedAt: null,
    });
    mocks.db.canvasItem.findFirst.mockResolvedValue(item);

    await expect(
      undoHomeBoardMove({ userId: "user-1", itemId: "item-1" }),
    ).rejects.toMatchObject({ detail: expect.stringMatching(/moved since/) });
    expect(mocks.revertChangeSet).not.toHaveBeenCalled();
    expect(mocks.db.homeBoardSuggestion.updateMany).not.toHaveBeenCalled();
  });

  it("has nothing to undo for an open suggestion", async () => {
    await expect(
      undoHomeBoardMove({ userId: "user-1", itemId: "item-1" }),
    ).rejects.toMatchObject({
      detail: expect.stringMatching(/no move to undo/),
    });
    expect(mocks.revertChangeSet).not.toHaveBeenCalled();
  });
});
