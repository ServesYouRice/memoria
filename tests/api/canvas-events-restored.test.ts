/**
 * TASK-172: a 'restored' CanvasEvent in the replay range must not fail the
 * events page. The page stops at the restore, asks for a snapshot and moves
 * the cursor to the restore's sequence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCanvasAccess: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: mocks.requireAuth,
  requireCanvasAccess: mocks.requireCanvasAccess,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvasEvent: { findFirst: mocks.findFirst, findMany: mocks.findMany },
  },
}));

import { GET } from "@/app/api/v1/canvases/[canvasId]/events/route";

const canvasId = "cjld2cjxh0000qzrmn831i7rn";

function row(sequence: bigint, operation: string) {
  return {
    id: `cjld2cjxh0000qzrmn831i${sequence.toString().padStart(3, "0")}`,
    sequence,
    canvasId,
    actorId: "user-1",
    entityId: operation === "restored" ? canvasId : `citem00000000${sequence}`,
    entityVersion: 2,
    operation,
    permissionScope: "VIEW",
    schemaVersion: 1,
    createdAt: new Date("2026-11-11T00:00:00.000Z"),
  };
}

async function get(cursor: string) {
  const response = await GET(
    new NextRequest(
      `http://localhost/api/v1/canvases/${canvasId}/events?cursor=${cursor}`,
    ),
    { params: Promise.resolve({ canvasId }) },
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  mocks.requireAuth.mockReset();
  mocks.requireCanvasAccess.mockReset();
  mocks.findFirst.mockReset();
  mocks.findMany.mockReset();
  mocks.requireAuth.mockResolvedValue({
    userId: "user-1",
    email: "u@example.com",
  });
  mocks.requireCanvasAccess.mockResolvedValue(undefined);
  mocks.findFirst.mockResolvedValue({ sequence: 1n });
});

describe("GET canvas events with a restore in range", () => {
  it("stops at the restore, requires a snapshot and moves to its sequence", async () => {
    mocks.findMany.mockResolvedValue([
      row(10n, "updated"),
      row(11n, "restored"),
      row(12n, "created"),
    ]);
    const { status, body } = await get("9");
    expect(status).toBe(200);
    expect(body.snapshotRequired).toBe(true);
    expect(BigInt(body.nextCursor)).toBeGreaterThanOrEqual(11n);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      cursor: "10",
      operation: "updated",
      entity: { type: "canvas-item", id: "citem0000000010", version: 2 },
    });
    expect(mocks.requireCanvasAccess).toHaveBeenCalledWith(
      canvasId,
      "user-1",
      "u@example.com",
      "VIEW",
    );
  });

  it("replays normally from a cursor at the restore", async () => {
    mocks.findMany.mockResolvedValue([row(12n, "created")]);
    const { status, body } = await get("11");
    expect(status).toBe(200);
    expect(body.snapshotRequired).toBe(false);
    expect(body.nextCursor).toBe("12");
    expect(body.events).toHaveLength(1);
  });

  it("asks for a snapshot when the first row is the restore", async () => {
    mocks.findMany.mockResolvedValue([
      row(11n, "restored"),
      row(12n, "created"),
    ]);
    const { status, body } = await get("10");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      events: [],
      nextCursor: "11",
      snapshotRequired: true,
    });
  });
});
