import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCanvasAccess: vi.fn(),
}));
const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  queryRaw: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: auth.requireAuth,
  requireCanvasAccess: auth.requireCanvasAccess,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvasItem: { findMany: db.findMany, groupBy: db.groupBy },
    $queryRaw: db.queryRaw,
  },
}));

import { GET as geometryGet } from "@/app/api/v1/canvas-items/geometry/route";
import { GET as searchGet } from "@/app/api/v1/canvas-items/search/route";
import { GET as summaryGet } from "@/app/api/v1/canvas-items/summary/route";

const canvasId = "clcanvasxxxxxxxxxxxxxxxxx";

function request(path: string) {
  const value = new Request(`http://localhost${path}`);
  Object.assign(value, { nextUrl: new URL(value.url) });
  return value as never;
}

describe("lightweight whole-canvas indexes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAuth.mockResolvedValue({
      userId: "user-1",
      email: "owner@example.com",
    });
    auth.requireCanvasAccess.mockResolvedValue("OWNER");
  });

  it("returns geometry without item content or tags and enforces launch capacity", async () => {
    db.findMany.mockResolvedValue([
      {
        id: "item-1",
        type: "NOTE",
        positionX: 10,
        positionY: 20,
        width: 300,
        height: 200,
        zIndex: 1,
        version: 2,
      },
    ]);

    const response = await geometryGet(
      request(`/api/v1/canvas-items/geometry?canvasId=${canvasId}`),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.items[0]).not.toHaveProperty("content");
    expect(payload.items[0]).not.toHaveProperty("tags");
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2001,
        select: expect.not.objectContaining({ content: true }),
      }),
    );
  });

  it("rejects a corrupted canvas above the supported geometry ceiling", async () => {
    db.findMany.mockResolvedValue(
      Array.from({ length: 2001 }, (_, index) => ({
        id: `item-${index}`,
      })),
    );
    const response = await geometryGet(
      request(`/api/v1/canvas-items/geometry?canvasId=${canvasId}`),
    );
    expect(response.status).toBe(409);
  });

  it("searches globally but returns only bounded item identifiers", async () => {
    db.queryRaw.mockResolvedValue([{ id: "item-2" }, { id: "item-9" }]);
    const response = await searchGet(
      request(`/api/v1/canvas-items/search?canvasId=${canvasId}&q=gravity`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ itemIds: ["item-2", "item-9"] });
    expect(auth.requireCanvasAccess).toHaveBeenCalledWith(
      canvasId,
      "user-1",
      "owner@example.com",
      "VIEW",
    );
  });

  it("publishes the durable event revision alongside counts, bounds, and tags", async () => {
    db.groupBy.mockResolvedValue([{ type: "NOTE", _count: { _all: 3 } }]);
    db.queryRaw
      .mockResolvedValueOnce([
        { count: 3n, minX: 0, minY: 10, maxX: 900, maxY: 700 },
      ])
      .mockResolvedValueOnce([{ tag: "physics", count: 2n }])
      .mockResolvedValueOnce([{ revision: 42n }]);

    const response = await summaryGet(
      request(`/api/v1/canvas-items/summary?canvasId=${canvasId}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      count: 3,
      bounds: { minX: 0, minY: 10, maxX: 900, maxY: 700 },
      types: { NOTE: 3 },
      tags: [{ value: "physics", count: 2 }],
      revision: "42",
    });
  });
});
