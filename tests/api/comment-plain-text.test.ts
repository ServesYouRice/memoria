import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  canvasItemFindUnique: vi.fn(),
  commentFindUnique: vi.fn(),
  commentCreate: vi.fn(),
  commentUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvasItem: { findUnique: mocks.canvasItemFindUnique },
    comment: {
      findUnique: mocks.commentFindUnique,
      create: mocks.commentCreate,
      update: mocks.commentUpdate,
    },
  },
}));
vi.mock("@/lib/activity", () => ({
  ActivityType: { COMMENT_ADDED: "COMMENT_ADDED" },
  logActivity: vi.fn(),
}));

import { POST } from "@/app/api/v1/items/[itemId]/comments/route";
import { PATCH } from "@/app/api/v1/items/[itemId]/comments/[commentId]/route";

const ownerId = "user-owner";
const itemId = "item-1";
const commentId = "comment-1";
const canvas = {
  id: "c1",
  name: "C",
  userId: ownerId,
  isPublic: false,
  shares: [],
};
const literal = "Tom & Jerry <b>x</b> 1 < 2";

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("comments are stored as plain text (TASK-049)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: ownerId } });
    mocks.commentCreate.mockResolvedValue({ id: commentId });
    mocks.commentUpdate.mockResolvedValue({ id: commentId });
  });

  it("POST stores the trimmed text verbatim", async () => {
    mocks.canvasItemFindUnique.mockResolvedValue({
      id: itemId,
      canvasId: canvas.id,
      deletedAt: null,
      canvas,
    });
    const response = await POST(
      jsonRequest(`http://localhost/api/v1/items/${itemId}/comments`, "POST", {
        content: `  ${literal}  `,
      }),
      { params: Promise.resolve({ itemId }) },
    );
    expect(response.status).toBe(201);
    expect(mocks.commentCreate.mock.calls[0][0].data.content).toBe(literal);
  });

  it("PATCH with unchanged content stores identical bytes", async () => {
    mocks.commentFindUnique.mockResolvedValue({
      id: commentId,
      itemId,
      userId: ownerId,
      content: literal,
      deletedAt: null,
      item: { id: itemId, deletedAt: null, canvas },
    });
    const response = await PATCH(
      jsonRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        "PATCH",
        { content: literal },
      ),
      { params: Promise.resolve({ itemId, commentId }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.commentUpdate.mock.calls[0][0].data.content).toBe(literal);
  });

  it("still rejects whitespace-only content", async () => {
    const response = await POST(
      jsonRequest(`http://localhost/api/v1/items/${itemId}/comments`, "POST", {
        content: "   ",
      }),
      { params: Promise.resolve({ itemId }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.commentCreate).not.toHaveBeenCalled();
  });
});
