import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UnauthorizedError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
  undo: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/agents/home-board", () => ({
  acceptHomeBoardSuggestion: mocks.accept,
  dismissHomeBoardSuggestion: mocks.dismiss,
  undoHomeBoardMove: mocks.undo,
  listHomeBoardSuggestions: mocks.list,
}));

import { POST } from "@/app/api/v1/items/[itemId]/home-board/route";
import { GET } from "@/app/api/v1/canvases/[canvasId]/home-boards/route";

const itemParams = { params: Promise.resolve({ itemId: "item-1" }) };

function post(body: unknown) {
  return new NextRequest("http://localhost/api/v1/items/item-1/home-board", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ userId: "user-1", email: "a@b.c" });
  mocks.accept.mockResolvedValue({ changeSetId: "cs-1" });
  mocks.dismiss.mockResolvedValue({ status: "DISMISSED" });
  mocks.undo.mockResolvedValue({ rollbackChangeSetId: "cs-2" });
  mocks.list.mockResolvedValue({ suggestions: [], recentlyFiled: [] });
});

describe("POST /api/v1/items/[itemId]/home-board", () => {
  it.each([
    ["accept", "accept"],
    ["dismiss", "dismiss"],
    ["undo", "undo"],
  ] as const)("routes %s for the signed-in owner", async (action, mock) => {
    const response = await POST(post({ action }), itemParams);
    expect(response.status).toBe(200);
    expect(mocks[mock]).toHaveBeenCalledWith({
      userId: "user-1",
      itemId: "item-1",
    });
  });

  it("rejects unknown actions and extra fields", async () => {
    expect((await POST(post({ action: "move" }), itemParams)).status).toBe(400);
    expect(
      (await POST(post({ action: "accept", boardId: "x" }), itemParams)).status,
    ).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mocks.requireAuth.mockRejectedValue(new UnauthorizedError());
    expect((await POST(post({ action: "accept" }), itemParams)).status).toBe(
      401,
    );
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/canvases/[canvasId]/home-boards", () => {
  it("lists for the signed-in user", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/canvases/c1/home-boards"),
      { params: Promise.resolve({ canvasId: "c1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({
      userId: "user-1",
      canvasId: "c1",
    });
  });
});
