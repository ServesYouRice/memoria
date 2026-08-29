import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCanvasAccess: vi.fn(),
}));
const db = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: auth.requireAuth,
  requireCanvasAccess: auth.requireCanvasAccess,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvasItem: {
      count: db.count,
      findMany: db.findMany,
    },
  },
}));

import { GET } from "@/app/api/v1/canvas-items/route";

const canvasId = "clcanvasxxxxxxxxxxxxxxxxx";

function item(index: number) {
  return {
    id: `clitem${String(index).padStart(19, "0")}`,
    canvasId,
    type: "NOTE",
    positionX: index * 10,
    positionY: 0,
    width: 300,
    height: 200,
    zIndex: index,
    content: { text: `item ${index}` },
    tags: [],
    version: 1,
  };
}

function request(cursor?: string) {
  const params = new URLSearchParams({ canvasId, limit: "2" });
  if (cursor) params.set("cursor", cursor);
  const value = new Request(
    `http://localhost/api/v1/canvas-items?${params.toString()}`,
  );
  Object.assign(value, { nextUrl: new URL(value.url) });
  return value as never;
}

describe("authoritative cursor pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAuth.mockResolvedValue({
      userId: "user-1",
      email: "owner@example.com",
    });
    auth.requireCanvasAccess.mockResolvedValue("OWNER");
    db.count.mockResolvedValue(5);
  });

  it("fetches one look-ahead row and keeps hasMore true across cursor pages", async () => {
    db.findMany
      .mockResolvedValueOnce([item(0), item(1)])
      .mockResolvedValueOnce([item(2), item(3), item(4)]);

    const firstResponse = await GET(request());
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));

    const secondResponse = await GET(request(first.nextCursor));
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    expect(second.items.map((entry: { id: string }) => entry.id)).toEqual([
      item(2).id,
      item(3).id,
    ]);
    expect(second.hasMore).toBe(true);
    expect(second.nextCursor).toEqual(expect.any(String));
    expect(db.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ take: 3 }),
    );
  });
});
