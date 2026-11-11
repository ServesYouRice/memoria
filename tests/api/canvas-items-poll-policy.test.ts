import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ItemType } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCanvasAccess: vi.fn(),
  $transaction: vi.fn(),
  canvasItemCreate: vi.fn(),
  canvasItemFindMany: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: mocks.requireAuth,
  requireCanvasAccess: mocks.requireCanvasAccess,
  requireItemAccess: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.$transaction,
    canvasItem: {
      create: mocks.canvasItemCreate,
      findMany: mocks.canvasItemFindMany,
    },
  },
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(),
}));

import { POST as commandsPost } from "@/app/api/v1/canvas-items/commands/route";
import { GET as itemsGet } from "@/app/api/v1/canvas-items/route";

const canvasId = "clxxxxxxxxxxxxxxxxxxxxxxx";

describe("disabled-poll policy on alternate item routes (TASK-042)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1", email: "a@b.c" });
    mocks.requireCanvasAccess.mockResolvedValue(undefined);
    mocks.canvasItemFindMany.mockResolvedValue([]);
  });

  it("refuses a POLL create in a command before writing anything", async () => {
    const response = await commandsPost(
      new NextRequest("http://localhost/api/v1/canvas-items/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          canvasId,
          creates: [
            {
              type: ItemType.POLL,
              positionX: 0,
              positionY: 0,
              width: 200,
              height: 200,
              content: {
                question: "Lunch?",
                options: [
                  { id: "a", text: "Pizza", votes: 0 },
                  { id: "b", text: "Sushi", votes: 0 },
                ],
              },
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).type).toBe(
      "https://memoria.local/errors/feature-disabled",
    );
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.canvasItemCreate).not.toHaveBeenCalled();
  });

  it("excludes POLL items from the ids hydration read", async () => {
    const response = await itemsGet(
      new NextRequest(
        `http://localhost/api/v1/canvas-items?canvasId=${canvasId}&ids=clzzzzzzzzzzzzzzzzzzzzzzz`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.canvasItemFindMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ type: { not: ItemType.POLL } }),
    });
  });
});
