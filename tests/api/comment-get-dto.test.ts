import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  commentFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    comment: { findUnique: mocks.commentFindUnique, update: vi.fn() },
  },
}));

import { GET } from "@/app/api/v1/items/[itemId]/comments/[commentId]/route";

const itemId = "item-1";
const commentId = "comment-1";

function fixture(options: {
  thumbnailRevision: bigint;
  itemDeleted?: boolean;
}) {
  return {
    id: commentId,
    itemId,
    userId: "author",
    content: "Hello",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    deletedAt: null,
    user: { id: "author", name: "Author", image: null },
    item: {
      id: itemId,
      canvasId: "canvas-1",
      content: { text: "secret item body" },
      deletedAt: options.itemDeleted ? new Date() : null,
      canvas: {
        id: "canvas-1",
        userId: "owner",
        workspaceId: "ws-1",
        isPublic: true,
        shareToken: "share-token-secret",
        thumbnailRevision: options.thumbnailRevision,
        shares: [
          {
            id: "s1",
            email: "alice-share@example.com",
            recipientId: "a",
            role: "VIEW",
          },
          {
            id: "s2",
            email: "bob-share@example.com",
            recipientId: "b",
            role: "EDIT",
          },
        ],
      },
    },
  };
}

function call() {
  const req = new Request(
    `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
  ) as unknown as NextRequest;
  return GET(req, { params: Promise.resolve({ itemId, commentId }) });
}

describe("GET /api/v1/items/:itemId/comments/:commentId DTO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "outsider" } });
  });

  it.each([0n, 5n])(
    "returns only allowlisted comment fields (thumbnailRevision %s)",
    async (thumbnailRevision) => {
      mocks.commentFindUnique.mockResolvedValue(fixture({ thumbnailRevision }));
      const res = await call();
      expect(res.status).toBe(200);
      const text = await res.text();
      const body = JSON.parse(text);
      expect(Object.keys(body).sort()).toEqual([
        "content",
        "createdAt",
        "deletedAt",
        "id",
        "itemId",
        "updatedAt",
        "user",
        "userId",
      ]);
      expect(Object.keys(body.user).sort()).toEqual(["id", "image", "name"]);
      expect(text).not.toContain("share@example.com");
      expect(text).not.toContain("share-token-secret");
      expect(text).not.toContain("secret item body");
    },
  );

  it("returns 404 when the parent item is soft-deleted", async () => {
    mocks.commentFindUnique.mockResolvedValue(
      fixture({ thumbnailRevision: 0n, itemDeleted: true }),
    );
    const res = await call();
    expect(res.status).toBe(404);
  });
});
