import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  aggregateCalls: 0,
  /** Aggregate calls from this index on see a changed canvas. */
  changeFromAggregate: Number.POSITIVE_INFINITY,
  checkpoints: [] as Array<{ snapshot: unknown }>,
  snapshotReads: 0,
}));

function makeTx() {
  return new Proxy(
    {},
    {
      get(_target, model: string) {
        return new Proxy(
          {},
          {
            get(_inner, method: string) {
              return async (
                args: {
                  data?: Record<string, unknown>;
                  select?: Record<string, unknown>;
                } = {},
              ) => {
                state.calls.push(`${model}.${method}`);
                if (method === "aggregate") {
                  const changed =
                    state.aggregateCalls++ >= state.changeFromAggregate;
                  const at = new Date(
                    changed ? "2026-02-01T00:00:00Z" : "2026-01-01T00:00:00Z",
                  );
                  return {
                    _count: { _all: changed ? 2 : 1 },
                    _max: { updatedAt: at, createdAt: at },
                  };
                }
                if (model === "canvas" && method === "findFirst") {
                  const read = args.select?.items ? state.snapshotReads++ : -1;
                  return {
                    id: "canvas-1",
                    name: "Board",
                    updatedAt: new Date("2026-01-01T00:00:00Z"),
                    items: [{ id: `item-read-${read}`, comments: [] }],
                  };
                }
                if (method === "findMany") return [];
                if (model === "workspaceCheckpoint" && method === "create") {
                  state.checkpoints.push({ snapshot: args.data?.snapshot });
                  return { id: "cp-1" };
                }
                if (method === "create") {
                  return { id: `${model}-1`, version: 1, ...args.data };
                }
                return { count: 1 };
              };
            },
          },
        );
      },
    },
  );
}

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: vi.fn(async () => {
    state.calls.push("lock");
  }),
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: vi.fn(),
  recordCanvasItemEventsBatch: vi.fn(),
}));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasItemCapacity: vi.fn(),
}));

import {
  createCanvasItemBatchWrite,
  createWorkspaceCheckpoint,
} from "@/lib/agents/service-core";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";

const actor = { userId: "user-1", agentProfileId: "prof-1" };

function bulkWrite() {
  return createCanvasItemBatchWrite({
    actor,
    canvasId: "canvas-1",
    items: [
      {
        type: "NOTE",
        positionX: 0,
        positionY: 0,
        width: 200,
        height: 200,
        zIndex: 0,
        content: { text: "hi" },
      },
    ],
    summary: "Bulk add",
    rung: AGENT_CAPABILITY_RUNGS.BULK,
  });
}

function snapshotItemId() {
  const snapshot = state.checkpoints[0]?.snapshot as {
    canvas: { items: Array<{ id: string }> };
  };
  return snapshot.canvas.items[0]?.id;
}

beforeEach(() => {
  state.calls = [];
  state.aggregateCalls = 0;
  state.changeFromAggregate = Number.POSITIVE_INFINITY;
  state.checkpoints = [];
  state.snapshotReads = 0;
});

describe("canvas checkpoints", () => {
  it("reads the canvas once per checkpoint", async () => {
    await createWorkspaceCheckpoint({
      actor,
      canvasId: "canvas-1",
      reason: "manual",
    });

    expect(state.calls.filter((call) => call === "canvas.findFirst")).toEqual([
      "canvas.findFirst",
    ]);
    expect(state.checkpoints).toHaveLength(1);
  });

  it("builds a bulk write's snapshot before the lock and only revalidates under it", async () => {
    await bulkWrite();

    const lock = state.calls.indexOf("lock");
    const snapshotRead = state.calls.indexOf("knowledgeEntity.findMany");
    expect(snapshotRead).toBeGreaterThanOrEqual(0);
    expect(snapshotRead).toBeLessThan(lock);
    const afterLock = state.calls.slice(lock);
    expect(afterLock).toContain("canvasItem.aggregate");
    expect(afterLock).not.toContain("knowledgeEntity.findMany");
    expect(afterLock.indexOf("canvasItem.aggregate")).toBeLessThan(
      afterLock.indexOf("workspaceCheckpoint.create"),
    );
    expect(snapshotItemId()).toBe("item-read-0");
  });

  it("retakes the snapshot under the lock when the canvas changed before it", async () => {
    // The first fingerprint has 5 aggregates; later ones see the change.
    state.changeFromAggregate = 5;
    await bulkWrite();

    const lock = state.calls.indexOf("lock");
    expect(state.calls.slice(lock)).toContain("knowledgeEntity.findMany");
    expect(state.checkpoints).toHaveLength(1);
    expect(snapshotItemId()).not.toBe("item-read-0");
  });
});
