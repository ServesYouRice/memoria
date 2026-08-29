import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  uploadAssetFindMany: vi.fn(),
  $transaction: vi.fn(),
  txCanvasFindMany: vi.fn(),
  txCanvasItemFindMany: vi.fn(),
  txCanvasItemUpdate: vi.fn(),
  txCanvasItemUpdateMany: vi.fn(),
  txCanvasItemDeleteMany: vi.fn(),
  txCanvasVersionDeleteMany: vi.fn(),
  txCanvasShareDeleteMany: vi.fn(),
  txPasswordResetTokenDeleteMany: vi.fn(),
  txEmailVerificationTokenDeleteMany: vi.fn(),
  txIdempotencyKeyDeleteMany: vi.fn(),
  txCommentDeleteMany: vi.fn(),
  txCanvasDeleteMany: vi.fn(),
  txActivityDeleteMany: vi.fn(),
  txSessionDeleteMany: vi.fn(),
  txAccountDeleteMany: vi.fn(),
  txUserDelete: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
}));

const argon2Mocks = vi.hoisted(() => ({
  verify: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  enqueueUploadDeletion: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: prismaMocks.findUnique,
    },
    uploadAsset: {
      findMany: prismaMocks.uploadAssetFindMany,
    },
    $transaction: prismaMocks.$transaction,
  },
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: authMocks.requireAuth,
}));

vi.mock("argon2", () => ({
  verify: argon2Mocks.verify,
}));

vi.mock("@/lib/uploads/lifecycle", () => ({
  enqueueUploadDeletion: lifecycleMocks.enqueueUploadDeletion,
}));

import { GET, DELETE } from "@/app/api/v1/users/account/route";

function createJsonRequest(
  method: string,
  body?: unknown,
  url = "http://localhost/api/v1/users/account",
): NextRequest {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init) as unknown as NextRequest;
}

describe("Account routes /api/v1/users/account (IMP-057)", () => {
  const userId = "user-123";
  const userEmail = "alice@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireAuth.mockResolvedValue({
      userId,
      email: userEmail,
    });
    argon2Mocks.verify.mockResolvedValue(false);
    prismaMocks.uploadAssetFindMany.mockResolvedValue([]);
    prismaMocks.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        canvas: {
          findMany: prismaMocks.txCanvasFindMany,
          deleteMany: prismaMocks.txCanvasDeleteMany,
        },
        canvasItem: {
          findMany: prismaMocks.txCanvasItemFindMany,
          update: prismaMocks.txCanvasItemUpdate,
          updateMany: prismaMocks.txCanvasItemUpdateMany,
          deleteMany: prismaMocks.txCanvasItemDeleteMany,
        },
        canvasVersion: {
          deleteMany: prismaMocks.txCanvasVersionDeleteMany,
        },
        canvasShare: {
          deleteMany: prismaMocks.txCanvasShareDeleteMany,
        },
        passwordResetToken: {
          deleteMany: prismaMocks.txPasswordResetTokenDeleteMany,
        },
        emailVerificationToken: {
          deleteMany: prismaMocks.txEmailVerificationTokenDeleteMany,
        },
        idempotencyKey: {
          deleteMany: prismaMocks.txIdempotencyKeyDeleteMany,
        },
        comment: {
          deleteMany: prismaMocks.txCommentDeleteMany,
        },
        activity: {
          deleteMany: prismaMocks.txActivityDeleteMany,
        },
        session: {
          deleteMany: prismaMocks.txSessionDeleteMany,
        },
        account: {
          deleteMany: prismaMocks.txAccountDeleteMany,
        },
        user: {
          delete: prismaMocks.txUserDelete,
        },
      };
      return callback(tx);
    });

    prismaMocks.txCanvasFindMany.mockResolvedValue([]);
    prismaMocks.txCanvasItemFindMany.mockResolvedValue([]);
  });

  describe("GET /api/v1/users/account (Account Data Export)", () => {
    it("exports user data omitting credential and secret fields, with private no-store caching", async () => {
      const exportedUserData = {
        id: userId,
        email: userEmail,
        name: "Alice",
        image: null,
        emailVerified: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        workspaces: [
          {
            id: "ws-1",
            name: "Default Workspace",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        canvases: [],
      };

      prismaMocks.findUnique.mockResolvedValue(exportedUserData);

      const response = await GET(createJsonRequest("GET"));

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Content-Disposition")).toContain(
        'attachment; filename="memoria-account-',
      );

      // Verify prisma select strictly excludes passwordHash and sessionVersion
      expect(prismaMocks.findUnique).toHaveBeenCalledTimes(1);
      const queryArg = prismaMocks.findUnique.mock.calls[0][0];
      expect(queryArg.where).toEqual({ id: userId });
      expect(queryArg.select.passwordHash).toBeUndefined();
      expect(queryArg.select.sessionVersion).toBeUndefined();

      const json = await response.json();
      expect(json.formatVersion).toBe(1);
      expect(json.exportedAt).toBeDefined();
      expect(json.user).toBeDefined();
      expect(json.user.id).toBe(userId);
      expect(json.user.passwordHash).toBeUndefined();
      expect(json.user.sessionVersion).toBeUndefined();
    });

    it("returns 400 when account is not found", async () => {
      prismaMocks.findUnique.mockResolvedValue(null);

      const response = await GET(createJsonRequest("GET"));
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.detail).toMatch(/Account not found/i);
    });
  });

  describe("DELETE /api/v1/users/account (Account Deletion)", () => {
    it("rejects when confirmation is missing or not 'DELETE'", async () => {
      const response = await DELETE(
        createJsonRequest("DELETE", {
          password: "ValidPassword123!",
          confirmation: "INVALID",
        }),
      );

      expect(response.status).toBe(400);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("rejects accounts without a passwordHash", async () => {
      prismaMocks.findUnique.mockResolvedValue({ passwordHash: null });

      const response = await DELETE(
        createJsonRequest("DELETE", {
          password: "ValidPassword123!",
          confirmation: "DELETE",
        }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.detail).toMatch(/Cannot delete this account type/i);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("rejects when password verification fails without opening a transaction", async () => {
      prismaMocks.findUnique.mockResolvedValue({
        passwordHash: "$argon2id$storedHash",
      });
      argon2Mocks.verify.mockResolvedValue(false);

      const response = await DELETE(
        createJsonRequest("DELETE", {
          password: "WrongPassword!",
          confirmation: "DELETE",
        }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.detail).toMatch(/Password is incorrect/i);
      expect(argon2Mocks.verify).toHaveBeenCalledWith(
        "$argon2id$storedHash",
        "WrongPassword!",
      );
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("reassigns foreign items to canvas owners and deletes user data atomically", async () => {
      prismaMocks.findUnique.mockResolvedValue({
        passwordHash: "$argon2id$storedHash",
      });
      argon2Mocks.verify.mockResolvedValue(true);

      prismaMocks.uploadAssetFindMany.mockResolvedValue([
        { id: "asset-1" },
        { id: "asset-2" },
      ]);

      // User owns canvas-1
      prismaMocks.txCanvasFindMany.mockResolvedValue([{ id: "canvas-1" }]);

      // User authored note-foreign on Bob's canvas (canvas-2 owned by user-bob)
      prismaMocks.txCanvasItemFindMany.mockResolvedValue([
        {
          id: "note-foreign",
          canvas: { userId: "user-bob" },
        },
      ]);

      const response = await DELETE(
        createJsonRequest("DELETE", {
          password: "CorrectPassword123!",
          confirmation: "DELETE",
        }),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);

      // Upload deletion lifecycle enqueued
      expect(lifecycleMocks.enqueueUploadDeletion).toHaveBeenCalledTimes(2);

      // Assert foreign item authorship reassignment to the canvas owner
      expect(prismaMocks.txCanvasItemUpdate).toHaveBeenCalledWith({
        where: { id: "note-foreign" },
        data: { createdById: "user-bob" },
      });

      // Assert user's canvas items deleted
      expect(prismaMocks.txCanvasItemDeleteMany).toHaveBeenCalledWith({
        where: { canvasId: { in: ["canvas-1"] } },
      });

      // Assert canvas versions deleted
      expect(prismaMocks.txCanvasVersionDeleteMany).toHaveBeenCalledWith({
        where: { canvasId: { in: ["canvas-1"] } },
      });

      // Assert canvas shares deleted
      expect(prismaMocks.txCanvasShareDeleteMany).toHaveBeenCalledWith({
        where: {
          OR: [{ canvasId: { in: ["canvas-1"] } }, { email: userEmail }],
        },
      });

      // Assert tokens and user record deleted
      expect(prismaMocks.txPasswordResetTokenDeleteMany).toHaveBeenCalledWith({
        where: { email: userEmail },
      });
      expect(
        prismaMocks.txEmailVerificationTokenDeleteMany,
      ).toHaveBeenCalledWith({
        where: { email: userEmail },
      });
      expect(prismaMocks.txSessionDeleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
      expect(prismaMocks.txUserDelete).toHaveBeenCalledWith({
        where: { id: userId },
      });
    });
  });
});
