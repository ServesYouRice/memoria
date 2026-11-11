import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  commentFindUnique: vi.fn(),
  commentUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    comment: {
      findUnique: mocks.commentFindUnique,
      update: mocks.commentUpdate,
    },
  },
}));

import {
  DELETE,
  GET,
  PATCH,
} from "@/app/api/v1/items/[itemId]/comments/[commentId]/route";

const ownerId = "user-owner";
const authorId = "user-author";
const itemId = "item-1";
const commentId = "comment-1";

function comment(options: {
  authorShare?: "VIEW" | "COMMENT" | "EDIT" | null;
  itemDeletedAt?: Date | null;
}) {
  return {
    id: commentId,
    itemId,
    userId: authorId,
    content: "Hello",
    deletedAt: null,
    user: { id: authorId, name: "Author", image: null },
    item: {
      id: itemId,
      deletedAt: options.itemDeletedAt ?? null,
      canvas: {
        id: "canvas-1",
        userId: ownerId,
        isPublic: false,
        shares: options.authorShare
          ? [{ recipientId: authorId, role: options.authorShare }]
          : [],
      },
    },
  };
}

const params = () => ({ params: Promise.resolve({ itemId, commentId }) });
const url = `http://localhost/api/v1/items/${itemId}/comments/${commentId}`;
const patch = () =>
  PATCH(
    new NextRequest(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Edited" }),
    }),
    params(),
  );

describe("single-comment route requires current canvas access (TASK-048)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: authorId } });
    mocks.commentUpdate.mockResolvedValue({ id: commentId });
  });

  it("denies a revoked author PATCH, GET and DELETE", async () => {
    mocks.commentFindUnique.mockResolvedValue(comment({ authorShare: null }));
    expect((await patch()).status).toBe(403);
    expect((await GET(new NextRequest(url), params())).status).toBe(403);
    expect(
      (await DELETE(new NextRequest(url, { method: "DELETE" }), params()))
        .status,
    ).toBe(403);
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it("denies a PATCH by an author downgraded to VIEW", async () => {
    mocks.commentFindUnique.mockResolvedValue(comment({ authorShare: "VIEW" }));
    expect((await patch()).status).toBe(403);
    expect(mocks.commentUpdate).not.toHaveBeenCalled();
  });

  it("allows a PATCH by an author with a current COMMENT share", async () => {
    mocks.commentFindUnique.mockResolvedValue(
      comment({ authorShare: "COMMENT" }),
    );
    expect((await patch()).status).toBe(200);
  });

  it("lets the owner delete any comment", async () => {
    mocks.auth.mockResolvedValue({ user: { id: ownerId } });
    mocks.commentFindUnique.mockResolvedValue(comment({ authorShare: null }));
    expect(
      (await DELETE(new NextRequest(url, { method: "DELETE" }), params()))
        .status,
    ).toBe(200);
  });

  it("treats a comment on a trashed item as not found", async () => {
    mocks.commentFindUnique.mockResolvedValue(
      comment({ authorShare: "EDIT", itemDeletedAt: new Date() }),
    );
    expect((await GET(new NextRequest(url), params())).status).toBe(404);
    expect((await patch()).status).toBe(404);
  });
});
