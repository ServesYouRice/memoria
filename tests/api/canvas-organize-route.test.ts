import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as PilesModule from "@/lib/agents/piles";
import { NextRequest } from "next/server";
import { AgentProfileStatus } from "@/generated/prisma/client";
import { UnauthorizedError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  canvasFindFirst: vi.fn(),
  listLooseItems: vi.fn(),
  getOrganizerProfileForCanvas: vi.fn(),
  proposeCanvasPiles: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({
  prisma: { canvas: { findFirst: mocks.canvasFindFirst } },
}));
vi.mock("@/lib/agents/piles", async (importOriginal) => {
  const actual = await importOriginal<typeof PilesModule>();
  return {
    ...actual,
    listLooseItems: mocks.listLooseItems,
    getOrganizerProfileForCanvas: mocks.getOrganizerProfileForCanvas,
    proposeCanvasPiles: mocks.proposeCanvasPiles,
  };
});

import { POST } from "@/app/api/v1/canvases/[canvasId]/organize/route";

const params = { params: Promise.resolve({ canvasId: "c1" }) };

function request() {
  return new NextRequest("http://localhost/api/v1/canvases/c1/organize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

const organizer = {
  id: "org-1",
  status: AgentProfileStatus.ACTIVE,
  maxCapabilityRung: 3,
  enabledRungs: [0, 3],
  allowedCanvasIds: ["c1"],
  defaultModelCredentialId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ userId: "u1", email: "u@x.dev" });
  mocks.canvasFindFirst.mockResolvedValue({ id: "c1" });
  mocks.getOrganizerProfileForCanvas.mockResolvedValue(organizer);
});

describe("POST /api/v1/canvases/:canvasId/organize", () => {
  it("rejects anonymous callers", async () => {
    mocks.requireAuth.mockRejectedValue(new UnauthorizedError());
    const response = await POST(request(), params);
    expect(response.status).toBe(401);
  });

  it("only sorts boards the caller owns", async () => {
    mocks.canvasFindFirst.mockResolvedValue(null);
    const response = await POST(request(), params);
    expect(response.status).toBe(404);
    expect(mocks.canvasFindFirst).toHaveBeenCalledWith({
      where: { id: "c1", userId: "u1" },
      select: { id: true },
    });
  });

  it("answers with no suggestion when nothing groups", async () => {
    mocks.listLooseItems.mockResolvedValue([
      { id: "a", type: "NOTE", content: { plainText: "alpha" }, tags: [] },
    ]);
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestionId: null, piles: [] });
    expect(mocks.proposeCanvasPiles).not.toHaveBeenCalled();
  });

  it("files grouped items as an organizer suggestion", async () => {
    mocks.listLooseItems.mockResolvedValue([
      {
        id: "a",
        type: "NOTE",
        content: { plainText: "pasta recipe" },
        tags: [],
      },
      {
        id: "b",
        type: "NOTE",
        content: { plainText: "curry recipe" },
        tags: [],
      },
    ]);
    mocks.proposeCanvasPiles.mockResolvedValue({
      suggestion: { id: "s1", summary: "Sort 2 items into 1 piles: Recipe" },
    });

    const response = await POST(request(), params);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      suggestionId: "s1",
      summary: "Sort 2 items into 1 piles: Recipe",
      piles: [{ title: "Recipe", itemCount: 2 }],
    });
    expect(mocks.proposeCanvasPiles).toHaveBeenCalledWith({
      actor: { userId: "u1", agentProfileId: "org-1", modelCredentialId: null },
      canvasId: "c1",
      piles: [{ title: "Recipe", itemIds: ["a", "b"] }],
    });
  });

  it("respects a disabled organizer", async () => {
    mocks.listLooseItems.mockResolvedValue([
      {
        id: "a",
        type: "NOTE",
        content: { plainText: "pasta recipe" },
        tags: [],
      },
      {
        id: "b",
        type: "NOTE",
        content: { plainText: "curry recipe" },
        tags: [],
      },
    ]);
    mocks.getOrganizerProfileForCanvas.mockResolvedValue({
      ...organizer,
      status: AgentProfileStatus.DISABLED,
    });
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
  });
});
