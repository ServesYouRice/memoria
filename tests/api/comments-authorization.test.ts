import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const authMocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  canvasItemFindUnique: vi.fn(),
  commentFindUnique: vi.fn(),
  commentFindMany: vi.fn(),
  commentCount: vi.fn(),
  commentCreate: vi.fn(),
  commentUpdate: vi.fn(),
}));

const activityMocks = vi.hoisted(() => ({
  logActivity: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    canvasItem: {
      findUnique: prismaMocks.canvasItemFindUnique,
    },
    comment: {
      findUnique: prismaMocks.commentFindUnique,
      findMany: prismaMocks.commentFindMany,
      count: prismaMocks.commentCount,
      create: prismaMocks.commentCreate,
      update: prismaMocks.commentUpdate,
    },
  },
}));

vi.mock("@/lib/activity", () => ({
  ActivityType: {
    COMMENT_ADDED: "COMMENT_ADDED",
  },
  logActivity: activityMocks.logActivity,
}));

import {
  GET as commentsGet,
  POST as commentsPost,
} from "@/app/api/v1/items/[itemId]/comments/route";
import {
  GET as commentItemGet,
  PATCH as commentItemPatch,
  DELETE as commentItemDelete,
} from "@/app/api/v1/items/[itemId]/comments/[commentId]/route";

function createNextRequest(
  url: string,
  options?: {
    method?: string;
    body?: unknown;
  },
): NextRequest {
  const init: RequestInit = {
    method: options?.method || "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (options?.body !== undefined) {
    init.body =
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  }
  const req = new Request(url, init);
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

describe("Comment Authorization by Visibility and Role (IMP-065)", () => {
  const ownerUserId = "user-owner-1";
  const authorUserId = "user-author-2";
  const viewShareUserId = "user-view-3";
  const commentShareUserId = "user-comment-4";
  const editShareUserId = "user-edit-5";
  const outsiderUserId = "user-outsider-6";

  const itemId = "item-target-123";
  const canvasId = "canvas-target-456";
  const commentId = "comment-target-789";

  const makeCanvasItemFixture = (options?: {
    isPublic?: boolean;
    deletedAt?: Date | null;
  }) => ({
    id: itemId,
    canvasId,
    deletedAt: options?.deletedAt ?? null,
    canvas: {
      id: canvasId,
      name: "Team Canvas",
      userId: ownerUserId,
      isPublic: options?.isPublic ?? false,
      user: { id: ownerUserId, name: "Owner User" },
      shares: [
        { recipientId: viewShareUserId, role: "VIEW" },
        { recipientId: commentShareUserId, role: "COMMENT" },
        { recipientId: editShareUserId, role: "EDIT" },
      ],
    },
  });

  const makeCommentFixture = (options?: {
    commentItemId?: string;
    deletedAt?: Date | null;
    isPublic?: boolean;
  }) => ({
    id: commentId,
    itemId: options?.commentItemId ?? itemId,
    userId: authorUserId,
    content: "Original author comment",
    deletedAt: options?.deletedAt ?? null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    user: { id: authorUserId, name: "Author User", image: null },
    item: {
      id: options?.commentItemId ?? itemId,
      canvasId,
      canvas: {
        id: canvasId,
        userId: ownerUserId,
        isPublic: options?.isPublic ?? false,
        shares: [
          { recipientId: viewShareUserId, role: "VIEW" },
          { recipientId: commentShareUserId, role: "COMMENT" },
          { recipientId: editShareUserId, role: "EDIT" },
        ],
      },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Collection GET /api/v1/items/:itemId/comments", () => {
    const params = Promise.resolve({ itemId });

    it("allows canvas owner to list comments and includes pagination", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: ownerUserId } });
      prismaMocks.canvasItemFindUnique.mockResolvedValue(
        makeCanvasItemFixture(),
      );
      prismaMocks.commentFindMany.mockResolvedValue([
        { id: "c1", content: "hello", createdAt: new Date() },
      ]);
      prismaMocks.commentCount.mockResolvedValue(1);

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments?limit=20&offset=0`,
      );
      const res = await commentsGet(req, { params });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.comments).toHaveLength(1);
      expect(json.pagination.total).toBe(1);

      expect(prismaMocks.commentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { itemId, deletedAt: null },
          take: 20,
          skip: 0,
        }),
      );
      expect(prismaMocks.commentCount).toHaveBeenCalledWith({
        where: { itemId, deletedAt: null },
      });
    });

    it("allows share recipient (e.g. VIEW role) to list comments", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: viewShareUserId } });
      prismaMocks.canvasItemFindUnique.mockResolvedValue(
        makeCanvasItemFixture(),
      );
      prismaMocks.commentFindMany.mockResolvedValue([]);
      prismaMocks.commentCount.mockResolvedValue(0);

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments`,
      );
      const res = await commentsGet(req, { params });

      expect(res.status).toBe(200);
      expect(prismaMocks.commentFindMany).toHaveBeenCalled();
    });

    it("allows anonymous caller to list comments when canvas isPublic is true", async () => {
      authMocks.auth.mockResolvedValue(null);
      prismaMocks.canvasItemFindUnique.mockResolvedValue(
        makeCanvasItemFixture({ isPublic: true }),
      );
      prismaMocks.commentFindMany.mockResolvedValue([]);
      prismaMocks.commentCount.mockResolvedValue(0);

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments`,
      );
      const res = await commentsGet(req, { params });

      expect(res.status).toBe(200);
      expect(prismaMocks.commentFindMany).toHaveBeenCalled();
    });

    it("denies signed-in outsider on private canvas with 401 without querying comments", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: outsiderUserId } });
      prismaMocks.canvasItemFindUnique.mockResolvedValue(
        makeCanvasItemFixture({ isPublic: false }),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments`,
      );
      const res = await commentsGet(req, { params });

      expect(res.status).toBe(401);
      expect(prismaMocks.commentFindMany).not.toHaveBeenCalled();
      expect(prismaMocks.commentCount).not.toHaveBeenCalled();
    });

    it("denies anonymous caller on private canvas with 401 without querying comments", async () => {
      authMocks.auth.mockResolvedValue(null);
      prismaMocks.canvasItemFindUnique.mockResolvedValue(
        makeCanvasItemFixture({ isPublic: false }),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments`,
      );
      const res = await commentsGet(req, { params });

      expect(res.status).toBe(401);
      expect(prismaMocks.commentFindMany).not.toHaveBeenCalled();
      expect(prismaMocks.commentCount).not.toHaveBeenCalled();
    });
  });

  describe("Collection POST /api/v1/items/:itemId/comments", () => {
    const params = Promise.resolve({ itemId });

    it("rejects unauthenticated requests with 401 without database queries or activity logs", async () => {
      authMocks.auth.mockResolvedValue(null);

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments`,
        {
          method: "POST",
          body: { content: "New comment" },
        },
      );
      const res = await commentsPost(req, { params });

      expect(res.status).toBe(401);
      expect(prismaMocks.canvasItemFindUnique).not.toHaveBeenCalled();
      expect(prismaMocks.commentCreate).not.toHaveBeenCalled();
      expect(activityMocks.logActivity).not.toHaveBeenCalled();
    });

    it("rejects VIEW share recipient with 401 without creating comment or logging activity", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: viewShareUserId } });
      prismaMocks.canvasItemFindUnique.mockResolvedValue(
        makeCanvasItemFixture(),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments`,
        {
          method: "POST",
          body: { content: "Unauthorized comment attempt" },
        },
      );
      const res = await commentsPost(req, { params });

      expect(res.status).toBe(401);
      expect(prismaMocks.commentCreate).not.toHaveBeenCalled();
      expect(activityMocks.logActivity).not.toHaveBeenCalled();
    });

    it("rejects unrelated signed-in outsider with 401 without creating comment or logging activity", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: outsiderUserId } });
      prismaMocks.canvasItemFindUnique.mockResolvedValue(
        makeCanvasItemFixture(),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments`,
        {
          method: "POST",
          body: { content: "Outsider comment attempt" },
        },
      );
      const res = await commentsPost(req, { params });

      expect(res.status).toBe(401);
      expect(prismaMocks.commentCreate).not.toHaveBeenCalled();
      expect(activityMocks.logActivity).not.toHaveBeenCalled();
    });

    it.each([
      { role: "owner", userId: ownerUserId },
      { role: "COMMENT share", userId: commentShareUserId },
      { role: "EDIT share", userId: editShareUserId },
    ])(
      "allows $role ($userId) to create comment on item and logs activity",
      async ({ userId }) => {
        authMocks.auth.mockResolvedValue({ user: { id: userId } });
        prismaMocks.canvasItemFindUnique.mockResolvedValue(
          makeCanvasItemFixture(),
        );

        const mockCreated = {
          id: "new-comment-1",
          itemId,
          userId,
          content: "Valid comment content",
          createdAt: new Date(),
          user: { id: userId, name: "User Name", image: null },
        };
        prismaMocks.commentCreate.mockResolvedValue(mockCreated);

        const req = createNextRequest(
          `http://localhost/api/v1/items/${itemId}/comments`,
          {
            method: "POST",
            body: { content: "Valid comment content" },
          },
        );
        const res = await commentsPost(req, { params });

        expect(res.status).toBe(201);
        expect(prismaMocks.commentCreate).toHaveBeenCalledWith({
          data: {
            itemId,
            userId,
            content: "Valid comment content",
          },
          include: expect.any(Object),
        });

        expect(activityMocks.logActivity).toHaveBeenCalledWith({
          userId,
          type: "COMMENT_ADDED",
          canvasId,
          canvasName: "Team Canvas",
          itemId,
        });
      },
    );
  });

  describe("Item GET /api/v1/items/:itemId/comments/:commentId", () => {
    const params = Promise.resolve({ itemId, commentId });

    it("rejects unauthenticated requests with 401 even if canvas is public", async () => {
      authMocks.auth.mockResolvedValue(null);

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
      );
      const res = await commentItemGet(req, { params });

      expect(res.status).toBe(401);
      expect(prismaMocks.commentFindUnique).not.toHaveBeenCalled();
    });

    it("returns 404 when comment itemId does not match URL itemId", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: ownerUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(
        makeCommentFixture({ commentItemId: "different-item-id" }),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
      );
      const res = await commentItemGet(req, { params });

      expect(res.status).toBe(404);
    });

    it("returns 404 when comment is soft-deleted", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: ownerUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(
        makeCommentFixture({ deletedAt: new Date() }),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
      );
      const res = await commentItemGet(req, { params });

      expect(res.status).toBe(404);
    });

    it.each([
      { desc: "canvas owner", userId: ownerUserId, isPublic: false },
      { desc: "comment author", userId: authorUserId, isPublic: false },
      { desc: "share recipient", userId: viewShareUserId, isPublic: false },
      { desc: "public canvas viewer", userId: outsiderUserId, isPublic: true },
    ])("allows $desc to view comment", async ({ userId, isPublic }) => {
      authMocks.auth.mockResolvedValue({ user: { id: userId } });
      prismaMocks.commentFindUnique.mockResolvedValue(
        makeCommentFixture({ isPublic }),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
      );
      const res = await commentItemGet(req, { params });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe(commentId);
    });

    it("denies signed-in outsider on private canvas with 403", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: outsiderUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(
        makeCommentFixture({ isPublic: false }),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
      );
      const res = await commentItemGet(req, { params });

      expect(res.status).toBe(403);
    });
  });

  describe("Item PATCH /api/v1/items/:itemId/comments/:commentId", () => {
    const params = Promise.resolve({ itemId, commentId });

    it("returns 404 and performs zero update when comment itemId does not match URL itemId", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: authorUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(
        makeCommentFixture({ commentItemId: "different-item-id" }),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "PATCH",
          body: { content: "Updated content" },
        },
      );
      const res = await commentItemPatch(req, { params });

      expect(res.status).toBe(404);
      expect(prismaMocks.commentUpdate).not.toHaveBeenCalled();
    });

    it("denies canvas owner with 403 when owner is not the author", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: ownerUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(makeCommentFixture());

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "PATCH",
          body: { content: "Owner trying to edit author's comment" },
        },
      );
      const res = await commentItemPatch(req, { params });

      expect(res.status).toBe(403);
      expect(prismaMocks.commentUpdate).not.toHaveBeenCalled();
    });

    it("denies share recipients with 403 when not the author", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: editShareUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(makeCommentFixture());

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "PATCH",
          body: { content: "Editor trying to edit author's comment" },
        },
      );
      const res = await commentItemPatch(req, { params });

      expect(res.status).toBe(403);
      expect(prismaMocks.commentUpdate).not.toHaveBeenCalled();
    });

    it("allows comment author to update content", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: authorUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(makeCommentFixture());

      const mockUpdated = {
        id: commentId,
        itemId,
        userId: authorUserId,
        content: "Author updated comment",
      };
      prismaMocks.commentUpdate.mockResolvedValue(mockUpdated);

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "PATCH",
          body: { content: "Author updated comment" },
        },
      );
      const res = await commentItemPatch(req, { params });

      expect(res.status).toBe(200);
      expect(prismaMocks.commentUpdate).toHaveBeenCalledWith({
        where: { id: commentId },
        data: { content: "Author updated comment" },
        include: expect.any(Object),
      });
    });
  });

  describe("Item DELETE /api/v1/items/:itemId/comments/:commentId", () => {
    const params = Promise.resolve({ itemId, commentId });

    it("returns 404 and performs zero update when comment itemId does not match URL itemId", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: authorUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(
        makeCommentFixture({ commentItemId: "different-item-id" }),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "DELETE",
        },
      );
      const res = await commentItemDelete(req, { params });

      expect(res.status).toBe(404);
      expect(prismaMocks.commentUpdate).not.toHaveBeenCalled();
    });

    it("allows comment author to soft-delete comment", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: authorUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(makeCommentFixture());
      prismaMocks.commentUpdate.mockResolvedValue({});

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "DELETE",
        },
      );
      const res = await commentItemDelete(req, { params });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });

      expect(prismaMocks.commentUpdate).toHaveBeenCalledWith({
        where: { id: commentId },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("allows canvas owner to soft-delete comment", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: ownerUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(makeCommentFixture());
      prismaMocks.commentUpdate.mockResolvedValue({});

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "DELETE",
        },
      );
      const res = await commentItemDelete(req, { params });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });

      expect(prismaMocks.commentUpdate).toHaveBeenCalledWith({
        where: { id: commentId },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("denies EDIT share recipient with 403 from deleting another user's comment", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: editShareUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(makeCommentFixture());

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "DELETE",
        },
      );
      const res = await commentItemDelete(req, { params });

      expect(res.status).toBe(403);
      expect(prismaMocks.commentUpdate).not.toHaveBeenCalled();
    });

    it("denies outsider with 403 from deleting comment", async () => {
      authMocks.auth.mockResolvedValue({ user: { id: outsiderUserId } });
      prismaMocks.commentFindUnique.mockResolvedValue(makeCommentFixture());

      const req = createNextRequest(
        `http://localhost/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "DELETE",
        },
      );
      const res = await commentItemDelete(req, { params });

      expect(res.status).toBe(403);
      expect(prismaMocks.commentUpdate).not.toHaveBeenCalled();
    });
  });
});
