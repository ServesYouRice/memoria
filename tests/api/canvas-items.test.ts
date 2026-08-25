import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { ItemType } from "@/generated/prisma/client";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCanvasAccess: vi.fn(),
  requireItemAccess: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  canvasItemCreate: vi.fn(),
  canvasItemFindUnique: vi.fn(),
  canvasItemUpdateMany: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  invalidateCanvasCache: vi.fn(),
}));

const activityMocks = vi.hoisted(() => ({
  logActivity: vi.fn(),
}));

const committedEventsMocks = vi.hoisted(() => ({
  recordCanvasItemEvent: vi.fn(),
}));

const capacityMocks = vi.hoisted(() => ({
  assertCanvasItemCapacity: vi.fn(),
}));

const mutationLockMocks = vi.hoisted(() => ({
  lockCanvasForMutation: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: authMocks.requireAuth,
  requireCanvasAccess: authMocks.requireCanvasAccess,
  requireItemAccess: authMocks.requireItemAccess,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: prismaMocks.$transaction,
    canvasItem: {
      create: prismaMocks.canvasItemCreate,
      findUnique: prismaMocks.canvasItemFindUnique,
      updateMany: prismaMocks.canvasItemUpdateMany,
    },
  },
}));

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: cacheMocks.invalidateCanvasCache,
}));

vi.mock("@/lib/activity", () => ({
  ActivityType: {
    ITEM_CREATED: "ITEM_CREATED",
    ITEM_UPDATED: "ITEM_UPDATED",
  },
  logActivity: activityMocks.logActivity,
}));

vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: committedEventsMocks.recordCanvasItemEvent,
}));

vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasItemCapacity: capacityMocks.assertCanvasItemCapacity,
}));

vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: mutationLockMocks.lockCanvasForMutation,
}));

import { POST as canvasItemsPost } from "@/app/api/v1/canvas-items/route";
import { PATCH as canvasItemPatch } from "@/app/api/v1/canvas-items/[itemId]/route";

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

describe("Canvas Items API (IMP-062)", () => {
  const userId = "user-123";
  const userEmail = "user@example.com";
  const validCanvasId = "cjld2cjxh0000qzrmn831i7rn";
  const validItemId = "cjld2cjxh0001qzrmn831i7rn";

  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireAuth.mockResolvedValue({ userId, email: userEmail });
    authMocks.requireCanvasAccess.mockResolvedValue("EDIT");
    authMocks.requireItemAccess.mockResolvedValue("EDIT");
  });

  describe("POST /api/v1/canvas-items (Create Canvas Item)", () => {
    it("rejects unauthenticated requests without performing transactions or writes", async () => {
      authMocks.requireAuth.mockRejectedValue(new UnauthorizedError());

      const req = createNextRequest("http://localhost/api/v1/canvas-items", {
        method: "POST",
        body: {
          canvasId: validCanvasId,
          type: "NOTE",
          content: { text: "Hello note" },
          positionX: 100,
          positionY: 100,
          width: 200,
          height: 150,
          zIndex: 1,
        },
      });

      const res = await canvasItemsPost(req);
      expect(res.status).toBe(401);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
      expect(prismaMocks.canvasItemCreate).not.toHaveBeenCalled();
    });

    it("rejects invalid request body without performing transactions or writes", async () => {
      const req = createNextRequest("http://localhost/api/v1/canvas-items", {
        method: "POST",
        body: {
          canvasId: "invalid-not-cuid",
          type: "INVALID_TYPE",
        },
      });

      const res = await canvasItemsPost(req);
      expect(res.status).toBe(400);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
      expect(prismaMocks.canvasItemCreate).not.toHaveBeenCalled();
    });

    it("rejects request when user lacks EDIT permission without performing write", async () => {
      authMocks.requireCanvasAccess.mockRejectedValue(
        new ForbiddenError("EDIT permission required"),
      );

      const req = createNextRequest("http://localhost/api/v1/canvas-items", {
        method: "POST",
        body: {
          canvasId: validCanvasId,
          type: "NOTE",
          content: { text: "Hello note" },
          positionX: 100,
          positionY: 100,
          width: 200,
          height: 150,
          zIndex: 1,
        },
      });

      const res = await canvasItemsPost(req);
      expect(res.status).toBe(403);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
      expect(prismaMocks.canvasItemCreate).not.toHaveBeenCalled();
    });

    it("creates canvas item in transaction with version 1, actor IDs, and invalidates canvas cache", async () => {
      const mockCreated = {
        id: validItemId,
        canvasId: validCanvasId,
        type: ItemType.NOTE,
        content: { text: "Hello note" },
        positionX: 100,
        positionY: 100,
        width: 200,
        height: 150,
        zIndex: 1,
        tags: [],
        version: 1,
        createdById: userId,
        updatedById: userId,
      };

      const mockTxCreate = vi.fn().mockResolvedValue(mockCreated);
      prismaMocks.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          canvasItem: { create: mockTxCreate },
        };
        return callback(tx);
      });

      const req = createNextRequest("http://localhost/api/v1/canvas-items", {
        method: "POST",
        body: {
          canvasId: validCanvasId,
          type: "NOTE",
          content: { text: "Hello note" },
          positionX: 100,
          positionY: 100,
          width: 200,
          height: 150,
          zIndex: 1,
          tags: ["tag1"],
        },
      });

      const res = await canvasItemsPost(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe(validItemId);

      expect(mutationLockMocks.lockCanvasForMutation).toHaveBeenCalledWith(
        expect.anything(),
        validCanvasId,
      );
      expect(capacityMocks.assertCanvasItemCapacity).toHaveBeenCalledWith(
        expect.anything(),
        validCanvasId,
      );
      expect(mockTxCreate).toHaveBeenCalledWith({
        data: {
          canvasId: validCanvasId,
          type: "NOTE",
          positionX: 100,
          positionY: 100,
          width: 200,
          height: 150,
          zIndex: 1,
          content: expect.objectContaining({
            text: "Hello note",
            plainText: "Hello note",
            formatVersion: 1,
          }),
          tags: ["tag1"],
          version: 1,
          createdById: userId,
          updatedById: userId,
        },
      });
      expect(committedEventsMocks.recordCanvasItemEvent).toHaveBeenCalledWith(
        expect.anything(),
        {
          canvasId: validCanvasId,
          actorId: userId,
          itemId: validItemId,
          version: 1,
          operation: "created",
        },
      );
      expect(cacheMocks.invalidateCanvasCache).toHaveBeenCalledWith(
        validCanvasId,
      );
      expect(activityMocks.logActivity).toHaveBeenCalledWith({
        userId,
        type: "ITEM_CREATED",
        canvasId: validCanvasId,
        itemId: validItemId,
      });
    });
  });

  describe("PATCH /api/v1/canvas-items/[itemId] (Optimistic Update)", () => {
    const params = Promise.resolve({ itemId: validItemId });

    it("rejects missing or invalid version before opening transaction", async () => {
      const req = createNextRequest(
        `http://localhost/api/v1/canvas-items/${validItemId}`,
        {
          method: "PATCH",
          body: {
            positionX: 150,
            // version missing
          },
        },
      );

      const res = await canvasItemPatch(req, { params });
      expect(res.status).toBe(400);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("rejects when user lacks EDIT permission without performing write", async () => {
      authMocks.requireItemAccess.mockRejectedValue(
        new ForbiddenError("EDIT permission required"),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/canvas-items/${validItemId}`,
        {
          method: "PATCH",
          body: {
            version: 1,
            positionX: 150,
          },
        },
      );

      const res = await canvasItemPatch(req, { params });
      expect(res.status).toBe(403);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("returns 409 ConflictError on version mismatch when zero rows are updated", async () => {
      prismaMocks.canvasItemFindUnique.mockResolvedValue({
        canvasId: validCanvasId,
      });

      const mockTxFindUnique = vi
        .fn()
        .mockResolvedValueOnce({
          version: 1,
          deletedAt: null,
          type: ItemType.NOTE,
          canvasId: validCanvasId,
        })
        .mockResolvedValueOnce({
          version: 2, // Latest version is 2, client sent version 1
          deletedAt: null,
        });

      const mockTxUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

      prismaMocks.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          canvasItem: {
            findUnique: mockTxFindUnique,
            updateMany: mockTxUpdateMany,
          },
        };
        return callback(tx);
      });

      const req = createNextRequest(
        `http://localhost/api/v1/canvas-items/${validItemId}`,
        {
          method: "PATCH",
          body: {
            version: 1,
            positionX: 150,
          },
        },
      );

      const res = await canvasItemPatch(req, { params });
      expect(res.status).toBe(409);
    });

    it("successfully updates item with version check, increments version, and invalidates cache", async () => {
      prismaMocks.canvasItemFindUnique.mockResolvedValue({
        canvasId: validCanvasId,
      });

      const mockUpdatedItem = {
        id: validItemId,
        canvasId: validCanvasId,
        type: ItemType.NOTE,
        content: { text: "Updated note" },
        positionX: 150,
        positionY: 250,
        version: 2,
      };

      const mockTxFindUnique = vi
        .fn()
        .mockResolvedValueOnce({
          version: 1,
          deletedAt: null,
          type: ItemType.NOTE,
          canvasId: validCanvasId,
        })
        .mockResolvedValueOnce(mockUpdatedItem);

      const mockTxUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

      prismaMocks.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          canvasItem: {
            findUnique: mockTxFindUnique,
            updateMany: mockTxUpdateMany,
          },
        };
        return callback(tx);
      });

      const req = createNextRequest(
        `http://localhost/api/v1/canvas-items/${validItemId}`,
        {
          method: "PATCH",
          body: {
            version: 1,
            positionX: 150,
            positionY: 250,
            content: { text: "Updated note" },
          },
        },
      );

      const res = await canvasItemPatch(req, { params });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.version).toBe(2);

      expect(mockTxUpdateMany).toHaveBeenCalledWith({
        where: {
          id: validItemId,
          version: 1,
          deletedAt: null,
        },
        data: {
          positionX: 150,
          positionY: 250,
          content: expect.objectContaining({
            text: "Updated note",
            plainText: "Updated note",
            formatVersion: 1,
          }),
          version: { increment: 1 },
          updatedById: userId,
        },
      });

      expect(cacheMocks.invalidateCanvasCache).toHaveBeenCalledWith(
        validCanvasId,
      );
      expect(activityMocks.logActivity).toHaveBeenCalledWith({
        userId,
        type: "ITEM_UPDATED",
        canvasId: validCanvasId,
        itemId: validItemId,
      });
    });
  });
});
