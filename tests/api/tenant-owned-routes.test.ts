import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireItemOwnership: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  workspaceCount: vi.fn(),
  workspaceFindMany: vi.fn(),
  workspaceFindUnique: vi.fn(),
  workspaceUpdate: vi.fn(),
  workspaceDelete: vi.fn(),
  workspaceCreate: vi.fn(),
  canvasUpdateMany: vi.fn(),
  canvasItemFindMany: vi.fn(),
  canvasItemCount: vi.fn(),
  canvasItemUpdateMany: vi.fn(),
  notificationFindMany: vi.fn(),
  notificationCount: vi.fn(),
  notificationUpdateMany: vi.fn(),
}));

const capacityMocks = vi.hoisted(() => ({
  assertWorkspaceCapacity: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  invalidateCanvasCache: vi.fn(),
}));

const mutationLockMocks = vi.hoisted(() => ({
  lockCanvasForMutation: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: authMocks.requireAuth,
  requireItemOwnership: authMocks.requireItemOwnership,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: prismaMocks.$transaction,
    workspace: {
      count: prismaMocks.workspaceCount,
      findMany: prismaMocks.workspaceFindMany,
      findUnique: prismaMocks.workspaceFindUnique,
      update: prismaMocks.workspaceUpdate,
      create: prismaMocks.workspaceCreate,
      delete: prismaMocks.workspaceDelete,
    },
    canvas: {
      updateMany: prismaMocks.canvasUpdateMany,
    },
    canvasItem: {
      findMany: prismaMocks.canvasItemFindMany,
      count: prismaMocks.canvasItemCount,
      updateMany: prismaMocks.canvasItemUpdateMany,
    },
    notification: {
      findMany: prismaMocks.notificationFindMany,
      count: prismaMocks.notificationCount,
      updateMany: prismaMocks.notificationUpdateMany,
    },
  },
}));

vi.mock("@/lib/policy/capacity", () => ({
  assertWorkspaceCapacity: capacityMocks.assertWorkspaceCapacity,
}));

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: cacheMocks.invalidateCanvasCache,
}));

vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: mutationLockMocks.lockCanvasForMutation,
}));

import {
  GET as workspacesGet,
  POST as workspacesPost,
} from "@/app/api/v1/workspaces/route";
import {
  GET as workspaceItemGet,
  PATCH as workspaceItemPatch,
  DELETE as workspaceItemDelete,
} from "@/app/api/v1/workspaces/[workspaceId]/route";
import { GET as trashGet, PATCH as trashPatch } from "@/app/api/v1/trash/route";
import {
  GET as notificationsGet,
  PATCH as notificationsPatch,
} from "@/app/api/v1/notifications/route";

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

describe("Tenant Scoping for Workspaces, Trash, and Notifications (IMP-060)", () => {
  const ownerUserId = "user-owner-123";
  const outsiderUserId = "user-outsider-456";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Workspace Collection /api/v1/workspaces", () => {
    it("scopes GET count and findMany strictly to authenticated userId", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });
      prismaMocks.workspaceCount.mockResolvedValue(1);
      prismaMocks.workspaceFindMany.mockResolvedValue([
        {
          id: "ws-1",
          name: "Owner Workspace",
          _count: { canvases: 2 },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]);

      const req = createNextRequest(
        "http://localhost/api/v1/workspaces?limit=10&offset=0",
      );
      const res = await workspacesGet(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.workspaces).toHaveLength(1);
      expect(json.workspaces[0].name).toBe("Owner Workspace");

      // Verify tenant scoping
      expect(prismaMocks.workspaceCount).toHaveBeenCalledWith({
        where: { userId: ownerUserId },
      });
      expect(prismaMocks.workspaceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: ownerUserId },
          take: 10,
          skip: 0,
        }),
      );
    });

    it("passes authenticated userId to capacity check and creates workspace with userId inside transaction", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });
      const mockCreated = {
        id: "ws-new",
        name: "New Workspace",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      };

      prismaMocks.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          workspace: {
            create: vi.fn().mockResolvedValue(mockCreated),
          },
        };
        return callback(tx);
      });

      const req = createNextRequest("http://localhost/api/v1/workspaces", {
        method: "POST",
        body: { name: "New Workspace" },
      });
      const res = await workspacesPost(req);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe("ws-new");

      expect(capacityMocks.assertWorkspaceCapacity).toHaveBeenCalledWith(
        expect.anything(),
        ownerUserId,
      );
    });

    it("rejects unauthenticated requests without querying database", async () => {
      authMocks.requireAuth.mockRejectedValue(new UnauthorizedError());

      const req = createNextRequest("http://localhost/api/v1/workspaces");
      const res = await workspacesGet(req);

      expect(res.status).toBe(401);
      expect(prismaMocks.workspaceFindMany).not.toHaveBeenCalled();
      expect(prismaMocks.workspaceCount).not.toHaveBeenCalled();
    });
  });

  describe("Single Workspace Item /api/v1/workspaces/:workspaceId", () => {
    const workspaceId = "ws-owner-1";
    const ownerWorkspaceRecord = {
      id: workspaceId,
      name: "Owner Workspace",
      userId: ownerUserId,
      canvases: [
        {
          id: "canvas-1",
          name: "Project Plan",
          thumbnailKey: null,
          thumbnailRevision: 1,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    it("returns 404 when workspace does not exist", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });
      prismaMocks.workspaceFindUnique.mockResolvedValue(null);

      const params = Promise.resolve({ workspaceId: "nonexistent" });
      const req = createNextRequest(
        "http://localhost/api/v1/workspaces/nonexistent",
      );
      const res = await workspaceItemGet(req, { params });

      expect(res.status).toBe(404);
    });

    it("denies outsider GET access with 403 and returns no workspace/canvas payload", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: outsiderUserId });
      prismaMocks.workspaceFindUnique.mockResolvedValue(ownerWorkspaceRecord);

      const params = Promise.resolve({ workspaceId });
      const req = createNextRequest(
        `http://localhost/api/v1/workspaces/${workspaceId}`,
      );
      const res = await workspaceItemGet(req, { params });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.canvases).toBeUndefined();
      expect(json.name).toBeUndefined();
    });

    it("denies outsider PATCH with 403 and performs zero workspace update", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: outsiderUserId });
      prismaMocks.workspaceFindUnique.mockResolvedValue(ownerWorkspaceRecord);

      const params = Promise.resolve({ workspaceId });
      const req = createNextRequest(
        `http://localhost/api/v1/workspaces/${workspaceId}`,
        {
          method: "PATCH",
          body: { name: "Hacked Name" },
        },
      );
      const res = await workspaceItemPatch(req, { params });

      expect(res.status).toBe(403);
      expect(prismaMocks.workspaceUpdate).not.toHaveBeenCalled();
    });

    it("denies outsider DELETE with 403 and performs zero canvas unassignment or workspace delete", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: outsiderUserId });
      prismaMocks.workspaceFindUnique.mockResolvedValue(ownerWorkspaceRecord);

      const params = Promise.resolve({ workspaceId });
      const req = createNextRequest(
        `http://localhost/api/v1/workspaces/${workspaceId}`,
        {
          method: "DELETE",
        },
      );
      const res = await workspaceItemDelete(req, { params });

      expect(res.status).toBe(403);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("owner DELETE unassigns canvases scoped to workspaceId and userId before deleting workspace", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });
      prismaMocks.workspaceFindUnique.mockResolvedValue(ownerWorkspaceRecord);

      const mockTxCanvasUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockTxWorkspaceDelete = vi.fn().mockResolvedValue({});

      prismaMocks.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          canvas: { updateMany: mockTxCanvasUpdateMany },
          workspace: { delete: mockTxWorkspaceDelete },
        };
        return callback(tx);
      });

      const params = Promise.resolve({ workspaceId });
      const req = createNextRequest(
        `http://localhost/api/v1/workspaces/${workspaceId}`,
        {
          method: "DELETE",
        },
      );
      const res = await workspaceItemDelete(req, { params });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });

      expect(mockTxCanvasUpdateMany).toHaveBeenCalledWith({
        where: { workspaceId, userId: ownerUserId },
        data: { workspaceId: null },
      });
      expect(mockTxWorkspaceDelete).toHaveBeenCalledWith({
        where: { id: workspaceId },
      });
    });
  });

  describe("Trash Collection /api/v1/trash", () => {
    it("GET scopes list and count predicates to deleted items whose canvas belongs to current user", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });

      const mockItems = [
        {
          id: "item-1",
          type: "note",
          content: { text: "deleted note" },
          version: 2,
          deletedAt: new Date("2026-01-01T00:00:00.000Z"),
          canvas: { id: "c-1", name: "My Canvas" },
        },
      ];

      prismaMocks.$transaction.mockResolvedValue([mockItems, 1]);

      const req = createNextRequest(
        "http://localhost/api/v1/trash?limit=20&offset=0",
      );
      const res = await trashGet(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.items).toHaveLength(1);

      expect(prismaMocks.canvasItemFindMany).toHaveBeenCalledWith({
        where: {
          deletedAt: { not: null },
          canvas: { userId: ownerUserId },
        },
        orderBy: { deletedAt: "desc" },
        take: 20,
        skip: 0,
        select: expect.any(Object),
      });

      expect(prismaMocks.canvasItemCount).toHaveBeenCalledWith({
        where: {
          deletedAt: { not: null },
          canvas: { userId: ownerUserId },
        },
      });
    });

    it("PATCH rejects when requireItemOwnership fails without running a transaction", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: outsiderUserId });
      authMocks.requireItemOwnership.mockRejectedValue(
        new ForbiddenError("You do not own this item"),
      );

      const req = createNextRequest("http://localhost/api/v1/trash", {
        method: "PATCH",
        body: { itemId: "cjld2cjxh0000qzrmn831i7rn", version: 1 },
      });
      const res = await trashPatch(req);

      expect(res.status).toBe(403);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
      expect(cacheMocks.invalidateCanvasCache).not.toHaveBeenCalled();
    });

    it("PATCH restores item with requested version, deletedAt not null, increments version, and invalidates canvas cache", async () => {
      const validCuid = "cjld2cjxh0000qzrmn831i7rn";
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });
      authMocks.requireItemOwnership.mockResolvedValue({
        id: validCuid,
        canvasId: "c-1",
        version: 1,
      });

      const mockTxUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      prismaMocks.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          canvasItem: { updateMany: mockTxUpdateMany },
        };
        return callback(tx);
      });

      const req = createNextRequest("http://localhost/api/v1/trash", {
        method: "PATCH",
        body: { itemId: validCuid, version: 1 },
      });
      const res = await trashPatch(req);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ restored: true });

      expect(mutationLockMocks.lockCanvasForMutation).toHaveBeenCalledWith(
        expect.anything(),
        "c-1",
      );
      expect(mockTxUpdateMany).toHaveBeenCalledWith({
        where: {
          id: validCuid,
          version: 1,
          deletedAt: { not: null },
        },
        data: {
          deletedAt: null,
          deletedById: null,
          version: { increment: 1 },
          updatedById: ownerUserId,
        },
      });
      expect(cacheMocks.invalidateCanvasCache).toHaveBeenCalledWith("c-1");
    });
  });

  describe("Notifications /api/v1/notifications", () => {
    it("GET scopes list, total count, and unread count to recipientId: userId", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });

      const mockNotifications = [
        {
          id: "notif-1",
          type: "mention",
          readAt: null,
          createdAt: new Date(),
          actor: { id: "user-2", name: "Bob", image: null },
        },
      ];

      prismaMocks.notificationFindMany.mockResolvedValue(mockNotifications);
      prismaMocks.notificationCount
        .mockResolvedValueOnce(1) // total count
        .mockResolvedValueOnce(1); // unread count

      const req = createNextRequest(
        "http://localhost/api/v1/notifications?limit=25",
      );
      const res = await notificationsGet(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.notifications).toHaveLength(1);
      expect(json.unread).toBe(1);

      expect(prismaMocks.notificationFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { recipientId: ownerUserId },
          take: 25,
        }),
      );
      expect(prismaMocks.notificationCount).toHaveBeenCalledWith({
        where: { recipientId: ownerUserId },
      });
      expect(prismaMocks.notificationCount).toHaveBeenCalledWith({
        where: { recipientId: ownerUserId, readAt: null },
      });
    });

    it("PATCH updates only notifications matching both IDs and recipientId", async () => {
      const validCuid = "cjld2cjxh0000qzrmn831i7rn";
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });

      // When ID belongs to another user, updateMany returns count 0
      prismaMocks.notificationUpdateMany.mockResolvedValue({ count: 0 });

      const req = createNextRequest("http://localhost/api/v1/notifications", {
        method: "PATCH",
        body: { ids: [validCuid] },
      });
      const res = await notificationsPatch(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.updated).toBe(0);

      expect(prismaMocks.notificationUpdateMany).toHaveBeenCalledWith({
        where: {
          id: { in: [validCuid] },
          recipientId: ownerUserId,
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
    });

    it("PATCH marks every unread notification for only the authenticated recipient", async () => {
      authMocks.requireAuth.mockResolvedValue({ userId: ownerUserId });
      prismaMocks.notificationUpdateMany.mockResolvedValue({ count: 4 });

      const req = createNextRequest("http://localhost/api/v1/notifications", {
        method: "PATCH",
        body: { all: true },
      });
      const res = await notificationsPatch(req);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ updated: 4 });
      expect(prismaMocks.notificationUpdateMany).toHaveBeenCalledWith({
        where: {
          recipientId: ownerUserId,
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
    });
  });
});
