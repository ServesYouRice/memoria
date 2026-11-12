import type * as ArrowLinksModule from "@/lib/canvas/arrow-links";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { ForbiddenError } from "@/lib/errors";
import { LinkEndpointError } from "@/lib/canvas/arrow-links";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCanvasAccess: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  itemConnection: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  canvasItem: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

const linkMocks = vi.hoisted(() => ({
  createLinkArrow: vi.fn(),
  arrowsForLink: vi.fn(),
  lock: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/canvas/arrow-links", async (importOriginal) => ({
  ...((await importOriginal()) as typeof ArrowLinksModule),
  createLinkArrow: linkMocks.createLinkArrow,
  arrowsForLink: linkMocks.arrowsForLink,
}));
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: linkMocks.lock,
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: linkMocks.record,
}));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasItemCapacity: vi.fn(),
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: authMocks.requireAuth,
  requireCanvasAccess: authMocks.requireCanvasAccess,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    itemConnection: prismaMocks.itemConnection,
    canvasItem: prismaMocks.canvasItem,
    $transaction: (fn: (tx: unknown) => unknown) => fn(prismaMocks),
  },
}));

import {
  GET as connectionsGet,
  POST as connectionsPost,
} from "@/app/api/v1/canvases/[canvasId]/connections/route";
import {
  PATCH as connectionItemPatch,
  DELETE as connectionItemDelete,
} from "@/app/api/v1/canvases/[canvasId]/connections/[connectionId]/route";

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

describe("Connection Authorization and Canvas Binding (IMP-066)", () => {
  const ownerUser = { userId: "user-owner-1", email: "owner@example.com" };
  const viewShareUser = { userId: "user-view-2", email: "view@example.com" };
  const editShareUser = { userId: "user-edit-3", email: "edit@example.com" };
  const outsiderUser = {
    userId: "user-outsider-4",
    email: "outsider@example.com",
  };

  const canvasId = "canvas-target-123";
  const connectionId = "conn-target-456";
  const fromItemId = "cjld2cjxh0000qzrmn831i7rn";
  const toItemId = "cjld2cjxh0001qzrmn831i7rn";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/canvases/:canvasId/connections (List Connections)", () => {
    const params = Promise.resolve({ canvasId });

    it("requires VIEW access and denies unauthorized requests without querying database", async () => {
      authMocks.requireAuth.mockResolvedValue(outsiderUser);
      authMocks.requireCanvasAccess.mockRejectedValue(
        new ForbiddenError("Access denied"),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections`,
      );
      const res = await connectionsGet(req, { params });

      expect(res.status).toBe(403);
      expect(authMocks.requireCanvasAccess).toHaveBeenCalledWith(
        canvasId,
        outsiderUser.userId,
        outsiderUser.email,
        "VIEW",
      );
      expect(prismaMocks.itemConnection.findMany).not.toHaveBeenCalled();
      expect(prismaMocks.itemConnection.count).not.toHaveBeenCalled();
    });

    it("allows shared user with VIEW capability to list connections with canvasId scope and pagination", async () => {
      authMocks.requireAuth.mockResolvedValue(viewShareUser);
      authMocks.requireCanvasAccess.mockResolvedValue("VIEW");

      const mockConnections = [
        {
          id: connectionId,
          fromId: fromItemId,
          toId: toItemId,
          label: "connects to",
          style: "SOLID",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ];
      prismaMocks.itemConnection.findMany.mockResolvedValue(mockConnections);
      prismaMocks.itemConnection.count.mockResolvedValue(1);

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections?limit=10&offset=0`,
      );
      const res = await connectionsGet(req, { params });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.connections).toHaveLength(1);
      expect(json.pagination.total).toBe(1);

      expect(authMocks.requireCanvasAccess).toHaveBeenCalledWith(
        canvasId,
        viewShareUser.userId,
        viewShareUser.email,
        "VIEW",
      );
      expect(prismaMocks.itemConnection.findMany).toHaveBeenCalledWith({
        where: { canvasId },
        orderBy: { createdAt: "asc" },
        take: 10,
        skip: 0,
      });
      expect(prismaMocks.itemConnection.count).toHaveBeenCalledWith({
        where: { canvasId },
      });
    });

    it("allows canvas owner to list connections", async () => {
      authMocks.requireAuth.mockResolvedValue(ownerUser);
      authMocks.requireCanvasAccess.mockResolvedValue("OWNER");
      prismaMocks.itemConnection.findMany.mockResolvedValue([]);
      prismaMocks.itemConnection.count.mockResolvedValue(0);

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections`,
      );
      const res = await connectionsGet(req, { params });

      expect(res.status).toBe(200);
      expect(authMocks.requireCanvasAccess).toHaveBeenCalledWith(
        canvasId,
        ownerUser.userId,
        ownerUser.email,
        "VIEW",
      );
    });
  });

  describe("POST /api/v1/canvases/:canvasId/connections (Create Connection)", () => {
    const params = Promise.resolve({ canvasId });

    it("requires EDIT capability and denies VIEW-only share recipient without querying items or creating connection", async () => {
      authMocks.requireAuth.mockResolvedValue(viewShareUser);
      authMocks.requireCanvasAccess.mockRejectedValue(
        new ForbiddenError("EDIT capability required"),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections`,
        {
          method: "POST",
          body: { fromId: fromItemId, toId: toItemId },
        },
      );
      const res = await connectionsPost(req, { params });

      expect(res.status).toBe(403);
      expect(authMocks.requireCanvasAccess).toHaveBeenCalledWith(
        canvasId,
        viewShareUser.userId,
        viewShareUser.email,
        "EDIT",
      );
      expect(prismaMocks.canvasItem.findFirst).not.toHaveBeenCalled();
      expect(prismaMocks.itemConnection.create).not.toHaveBeenCalled();
    });

    it("rejects when an endpoint item is not found, soft-deleted, or belongs to another canvas", async () => {
      authMocks.requireAuth.mockResolvedValue(editShareUser);
      authMocks.requireCanvasAccess.mockResolvedValue("EDIT");
      linkMocks.createLinkArrow.mockRejectedValue(new LinkEndpointError());

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections`,
        {
          method: "POST",
          body: { fromId: fromItemId, toId: toItemId },
        },
      );
      const res = await connectionsPost(req, { params });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/One or both items not found in this canvas/i);
      // The arrow is drawn on the path canvas only.
      expect(linkMocks.createLinkArrow).toHaveBeenCalledWith(
        prismaMocks,
        expect.objectContaining({
          canvasId,
          fromId: fromItemId,
          toId: toItemId,
        }),
      );
      expect(prismaMocks.itemConnection.create).not.toHaveBeenCalled();
    });

    it("creates connection under path canvas when user has EDIT capability and both endpoints exist on canvas", async () => {
      authMocks.requireAuth.mockResolvedValue(editShareUser);
      authMocks.requireCanvasAccess.mockResolvedValue("EDIT");

      const mockCreated = {
        id: connectionId,
        canvasId,
        fromId: fromItemId,
        toId: toItemId,
        label: "relates to",
        style: "DASHED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      linkMocks.createLinkArrow.mockResolvedValue({
        arrow: { id: "arrow-1" },
        link: mockCreated,
      });

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections`,
        {
          method: "POST",
          body: {
            fromId: fromItemId,
            toId: toItemId,
            label: "relates to",
            style: "DASHED",
          },
        },
      );
      const res = await connectionsPost(req, { params });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe(connectionId);
      expect(json.label).toBe("relates to");
      expect(json.style).toBe("DASHED");
      expect(linkMocks.lock).toHaveBeenCalledWith(prismaMocks, canvasId);
      expect(linkMocks.createLinkArrow).toHaveBeenCalledWith(prismaMocks, {
        canvasId,
        actorId: editShareUser.userId,
        fromId: fromItemId,
        toId: toItemId,
        label: "relates to",
        style: "DASHED",
      });
    });
  });

  describe("PATCH /api/v1/canvases/:canvasId/connections/:connectionId (Update Connection)", () => {
    const params = Promise.resolve({ canvasId, connectionId });

    it("requires EDIT capability and denies VIEW-only user without looking up connection", async () => {
      authMocks.requireAuth.mockResolvedValue(viewShareUser);
      authMocks.requireCanvasAccess.mockRejectedValue(
        new ForbiddenError("EDIT capability required"),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections/${connectionId}`,
        {
          method: "PATCH",
          body: { label: "new label" },
        },
      );
      const res = await connectionItemPatch(req, { params });

      expect(res.status).toBe(403);
      expect(authMocks.requireCanvasAccess).toHaveBeenCalledWith(
        canvasId,
        viewShareUser.userId,
        viewShareUser.email,
        "EDIT",
      );
      expect(prismaMocks.itemConnection.findFirst).not.toHaveBeenCalled();
      expect(prismaMocks.itemConnection.update).not.toHaveBeenCalled();
    });

    it("returns 404 when connection does not belong to path canvasId and performs zero update", async () => {
      authMocks.requireAuth.mockResolvedValue(editShareUser);
      authMocks.requireCanvasAccess.mockResolvedValue("EDIT");
      prismaMocks.itemConnection.findFirst.mockResolvedValue(null);

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections/${connectionId}`,
        {
          method: "PATCH",
          body: { label: "new label" },
        },
      );
      const res = await connectionItemPatch(req, { params });

      expect(res.status).toBe(404);
      expect(prismaMocks.itemConnection.findFirst).toHaveBeenCalledWith({
        where: { id: connectionId, canvasId },
      });
      expect(prismaMocks.canvasItem.update).not.toHaveBeenCalled();
      expect(prismaMocks.itemConnection.updateMany).not.toHaveBeenCalled();
    });

    it("updates connection when EDIT user targets connection matching path canvasId", async () => {
      authMocks.requireAuth.mockResolvedValue(editShareUser);
      authMocks.requireCanvasAccess.mockResolvedValue("EDIT");
      const existing = {
        id: connectionId,
        canvasId,
        fromId: fromItemId,
        toId: toItemId,
      };
      prismaMocks.itemConnection.findFirst.mockResolvedValue(existing);
      linkMocks.arrowsForLink.mockResolvedValue([
        {
          id: "arrow-1",
          content: { startItemId: fromItemId, endItemId: toItemId },
        },
      ]);
      prismaMocks.canvasItem.update.mockResolvedValue({
        id: "arrow-1",
        version: 2,
      });
      prismaMocks.itemConnection.findUnique.mockResolvedValue({
        ...existing,
        label: "updated label",
        style: "DOTTED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections/${connectionId}`,
        {
          method: "PATCH",
          body: { label: "updated label", style: "DOTTED" },
        },
      );
      const res = await connectionItemPatch(req, { params });

      expect(res.status).toBe(200);
      expect((await res.json()).style).toBe("DOTTED");
      expect(linkMocks.arrowsForLink).toHaveBeenCalledWith(
        prismaMocks,
        existing,
      );
      expect(prismaMocks.canvasItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "arrow-1" },
          data: expect.objectContaining({
            content: {
              startItemId: fromItemId,
              endItemId: toItemId,
              label: "updated label",
              lineStyle: "DOTTED",
            },
          }),
        }),
      );
      expect(linkMocks.record).toHaveBeenCalledWith(
        prismaMocks,
        expect.objectContaining({ itemId: "arrow-1", operation: "updated" }),
      );
    });
  });

  describe("DELETE /api/v1/canvases/:canvasId/connections/:connectionId (Delete Connection)", () => {
    const params = Promise.resolve({ canvasId, connectionId });

    it("requires EDIT capability and denies VIEW-only user without looking up connection", async () => {
      authMocks.requireAuth.mockResolvedValue(viewShareUser);
      authMocks.requireCanvasAccess.mockRejectedValue(
        new ForbiddenError("EDIT capability required"),
      );

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections/${connectionId}`,
        {
          method: "DELETE",
        },
      );
      const res = await connectionItemDelete(req, { params });

      expect(res.status).toBe(403);
      expect(authMocks.requireCanvasAccess).toHaveBeenCalledWith(
        canvasId,
        viewShareUser.userId,
        viewShareUser.email,
        "EDIT",
      );
      expect(prismaMocks.itemConnection.findFirst).not.toHaveBeenCalled();
      expect(prismaMocks.itemConnection.delete).not.toHaveBeenCalled();
    });

    it("returns 404 when connection does not belong to path canvasId and performs zero delete", async () => {
      authMocks.requireAuth.mockResolvedValue(ownerUser);
      authMocks.requireCanvasAccess.mockResolvedValue("OWNER");
      prismaMocks.itemConnection.findFirst.mockResolvedValue(null);

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections/${connectionId}`,
        {
          method: "DELETE",
        },
      );
      const res = await connectionItemDelete(req, { params });

      expect(res.status).toBe(404);
      expect(prismaMocks.itemConnection.findFirst).toHaveBeenCalledWith({
        where: { id: connectionId, canvasId },
      });
      expect(prismaMocks.canvasItem.update).not.toHaveBeenCalled();
      expect(prismaMocks.itemConnection.deleteMany).not.toHaveBeenCalled();
    });

    it("deletes connection when authorized user targets connection matching path canvasId", async () => {
      authMocks.requireAuth.mockResolvedValue(ownerUser);
      authMocks.requireCanvasAccess.mockResolvedValue("OWNER");
      prismaMocks.itemConnection.findFirst.mockResolvedValue({
        id: connectionId,
        canvasId,
      });
      linkMocks.arrowsForLink.mockResolvedValue([{ id: "arrow-1" }]);
      prismaMocks.canvasItem.update.mockResolvedValue({
        id: "arrow-1",
        version: 3,
      });

      const req = createNextRequest(
        `http://localhost/api/v1/canvases/${canvasId}/connections/${connectionId}`,
        {
          method: "DELETE",
        },
      );
      const res = await connectionItemDelete(req, { params });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      // The arrow goes to the trash (restorable); the link row follows.
      expect(prismaMocks.canvasItem.update).toHaveBeenCalledWith({
        where: { id: "arrow-1" },
        data: expect.objectContaining({ deletedById: ownerUser.userId }),
      });
      expect(linkMocks.record).toHaveBeenCalledWith(
        prismaMocks,
        expect.objectContaining({ itemId: "arrow-1", operation: "deleted" }),
      );
      expect(prismaMocks.itemConnection.deleteMany).toHaveBeenCalledWith({
        where: { id: connectionId },
      });
    });
  });
});
