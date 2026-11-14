import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError, UnauthorizedError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  canvasFindFirst: vi.fn(),
  canvasUpdate: vi.fn(),
  lockCanvasForMutation: vi.fn(),
  assertCanvasCapacity: vi.fn(),
  invalidateCanvasCache: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => {
  const tx = {
    canvas: { findFirst: mocks.canvasFindFirst, update: mocks.canvasUpdate },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) =>
        run(tx),
      ),
    },
  };
});
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: mocks.lockCanvasForMutation,
}));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasCapacity: mocks.assertCanvasCapacity,
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: mocks.invalidateCanvasCache,
}));

import { POST } from "@/app/api/v1/canvases/[canvasId]/restore/route";

const params = { params: Promise.resolve({ canvasId: "c1" }) };
const request = () =>
  new NextRequest("http://localhost/api/v1/canvases/c1/restore", {
    method: "POST",
  });

const restored = {
  id: "c1",
  name: "Trips",
  userId: "u1",
  workspaceId: null,
  zoomLevel: 1,
  panX: 0,
  panY: 0,
  thumbnailKey: null,
  thumbnailRevision: 4n,
  isPublic: false,
  shareToken: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ userId: "u1", email: "u@x.dev" });
  mocks.canvasFindFirst.mockResolvedValue({ id: "c1" });
  mocks.canvasUpdate.mockResolvedValue(restored);
  mocks.assertCanvasCapacity.mockResolvedValue(undefined);
});

describe("POST /api/v1/canvases/:canvasId/restore (IMP-132)", () => {
  it("rejects anonymous callers", async () => {
    mocks.requireAuth.mockRejectedValue(new UnauthorizedError());
    const response = await POST(request(), params);
    expect(response.status).toBe(401);
    expect(mocks.canvasFindFirst).not.toHaveBeenCalled();
  });

  it("restores the caller's own trashed canvas under its lock", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "c1",
      name: "Trips",
      deletedAt: null,
      thumbnailRevision: "4",
    });
    expect(mocks.lockCanvasForMutation).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
    );
    expect(mocks.canvasFindFirst).toHaveBeenCalledWith({
      where: { id: "c1", userId: "u1", deletedAt: { not: null } },
      select: { id: true },
    });
    expect(mocks.assertCanvasCapacity).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
    );
    expect(mocks.canvasUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: { deletedAt: null, deletedById: null },
      }),
    );
    expect(mocks.invalidateCanvasCache).toHaveBeenCalledWith("c1");
  });

  it("answers like a missing canvas when it is not the caller's or not in Trash", async () => {
    mocks.canvasFindFirst.mockResolvedValue(null);
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect((await response.json()).detail).toBe(
      "Canvas not found or access denied",
    );
    expect(mocks.assertCanvasCapacity).not.toHaveBeenCalled();
    expect(mocks.canvasUpdate).not.toHaveBeenCalled();
  });

  it("keeps the canvas in Trash when the canvas limit is reached", async () => {
    mocks.assertCanvasCapacity.mockRejectedValue(
      new ApiError(422, "about:blank", "Quota Exceeded", "limit"),
    );
    const response = await POST(request(), params);
    expect(response.status).toBe(422);
    expect(mocks.canvasUpdate).not.toHaveBeenCalled();
  });

  it("rejects an over-long canvas id", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ canvasId: "x".repeat(200) }),
    });
    expect(response.status).toBe(400);
    expect(mocks.canvasFindFirst).not.toHaveBeenCalled();
  });
});
