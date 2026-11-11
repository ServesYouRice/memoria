import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  uploadAssetFindMany: vi.fn(),
  accountExportFindMany: vi.fn(),
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
  txPasskeyDeleteMany: vi.fn(),
  txTwoFactorDeleteMany: vi.fn(),
  txVerificationDeleteMany: vi.fn(),
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
    // The password hash lives on the Better Auth credential Account row.
    account: {
      findUnique: prismaMocks.findUnique,
    },
    accountExport: {
      findMany: prismaMocks.accountExportFindMany,
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
    prismaMocks.accountExportFindMany.mockResolvedValue([]);
    prismaMocks.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        // Uploads are read inside the transaction, after the user's canvases.
        uploadAsset: {
          findMany: prismaMocks.uploadAssetFindMany,
        },
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
        passkey: {
          deleteMany: prismaMocks.txPasskeyDeleteMany,
        },
        twoFactor: {
          deleteMany: prismaMocks.txTwoFactorDeleteMany,
        },
        verification: {
          deleteMany: prismaMocks.txVerificationDeleteMany,
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
    it("refuses the former unbounded synchronous export and points to the background API", async () => {
      const response = await GET(createJsonRequest("GET"));

      expect(response.status).toBe(405);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const json = await response.json();
      expect(json.detail).toContain("POST /api/v1/users/account/exports");
      expect(prismaMocks.findUnique).not.toHaveBeenCalled();
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

    it("rejects accounts without a credential password", async () => {
      prismaMocks.findUnique.mockResolvedValue(null);

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
        userId,
        password: "$argon2id$storedHash",
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
        userId,
        password: "$argon2id$storedHash",
      });
      argon2Mocks.verify.mockResolvedValue(true);

      prismaMocks.uploadAssetFindMany.mockResolvedValue([
        { id: "asset-1" },
        { id: "asset-2" },
      ]);

      // User owns canvas-1; the user authored an item on Bob's canvas, so
      // Bob is the one foreign owner.
      prismaMocks.txCanvasFindMany
        .mockResolvedValueOnce([{ id: "canvas-1" }])
        .mockResolvedValueOnce([{ userId: "user-bob" }]);

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

      // Assert foreign item authorship reassignment to the canvas owner, one
      // statement per owner.
      expect(prismaMocks.txCanvasItemUpdateMany).toHaveBeenCalledWith({
        where: { createdById: userId, canvas: { userId: "user-bob" } },
        data: { createdById: "user-bob" },
      });
      expect(prismaMocks.txCanvasItemUpdate).not.toHaveBeenCalled();
      // The deletion runs with its own transaction timeout, not the default.
      expect(prismaMocks.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );

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
      // Credentials, passkeys, and two-factor material go with the account.
      expect(prismaMocks.txAccountDeleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
      expect(prismaMocks.txPasskeyDeleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
      expect(prismaMocks.txTwoFactorDeleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
      expect(prismaMocks.txVerificationDeleteMany).toHaveBeenCalledWith({
        where: { value: userId },
      });
      expect(prismaMocks.txUserDelete).toHaveBeenCalledWith({
        where: { id: userId },
      });
    });
  });
});
