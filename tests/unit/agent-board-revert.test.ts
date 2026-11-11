import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError } from "@/lib/errors";

const mocks = vi.hoisted(() => {
  const tx = {
    agentAction: { create: vi.fn(), update: vi.fn() },
    changeSet: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    changeRecord: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    canvas: { findUnique: vi.fn(), delete: vi.fn() },
    canvasItem: { count: vi.fn(), findMany: vi.fn() },
    uploadAsset: { count: vi.fn() },
    agentProfile: { findFirst: vi.fn(), update: vi.fn() },
  };
  return { tx, changeSetFindFirst: vi.fn() };
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

import { revertChangeSet } from "@/lib/agents/service-core";

const boardId = "cboard00000000000000000001";
const actor = { userId: "user-123", agentProfileId: "prof-hermes" };

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
  mocks.changeSetFindFirst.mockResolvedValue({
    id: "cs-board",
    scopeType: "canvas",
    scopeId: boardId,
    revertedAt: null,
    changeRecords: [
      {
        id: "cr-1",
        targetType: "Canvas",
        targetId: boardId,
        operation: "CREATE",
        before: null,
        after: { id: boardId, grantedAgentProfileId: "prof-hermes" },
        reversible: true,
      },
    ],
  });
  mocks.tx.agentAction.create.mockResolvedValue({ id: "act-rollback" });
  mocks.tx.changeSet.create.mockResolvedValue({ id: "cs-rollback" });
  mocks.tx.canvas.findUnique.mockResolvedValue({
    id: boardId,
    name: "Errands",
    userId: "user-123",
    createdAt: new Date(0),
  });
  mocks.tx.uploadAsset.count.mockResolvedValue(0);
  mocks.tx.agentProfile.findFirst.mockResolvedValue({
    allowedCanvasIds: ["cinbox", boardId],
  });
});

describe("reverting a board an agent created (IMP-067)", () => {
  it("deletes the empty board and takes it out of the agent's scope", async () => {
    mocks.tx.canvasItem.count.mockResolvedValue(0);

    await revertChangeSet({ actor, changeSetId: "cs-board" });

    expect(mocks.tx.canvas.delete).toHaveBeenCalledWith({
      where: { id: boardId },
    });
    expect(mocks.tx.agentProfile.update).toHaveBeenCalledWith({
      where: { id: "prof-hermes" },
      data: { allowedCanvasIds: ["cinbox"] },
    });
    expect(mocks.tx.changeSet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cs-board" },
        data: expect.objectContaining({ status: "REVERTED" }),
      }),
    );
  });

  it("refuses while the board still holds items", async () => {
    mocks.tx.canvasItem.count.mockResolvedValue(2);

    await expect(
      revertChangeSet({ actor, changeSetId: "cs-board" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mocks.tx.canvas.delete).not.toHaveBeenCalled();
    expect(mocks.tx.agentProfile.update).not.toHaveBeenCalled();
  });
});
