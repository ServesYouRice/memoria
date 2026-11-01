import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  accountFindUnique: vi.fn(),
  accountUpdateMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  $transaction: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
}));

const passwordMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  validatePasswordStrength: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: prismaMocks.findUnique,
    },
    // The password hash lives on the Better Auth credential Account row.
    account: {
      findUnique: prismaMocks.accountFindUnique,
    },
    $transaction: prismaMocks.$transaction,
  },
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: authMocks.requireAuth,
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: passwordMocks.hashPassword,
  verifyPassword: passwordMocks.verifyPassword,
}));

vi.mock("@/lib/validation/password", () => ({
  PASSWORD_MIN_LENGTH: 8,
  validatePasswordStrength: passwordMocks.validatePasswordStrength,
}));

import { POST } from "@/app/api/v1/users/change-password/route";

function createJsonRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/v1/users/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/v1/users/change-password (IMP-057)", () => {
  const userId = "user-123";
  const userRecord = {
    email: "user@example.com",
    name: "Alice",
  };
  const credentialAccount = {
    userId,
    password: "$argon2id$existingHash",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireAuth.mockResolvedValue({
      userId,
      email: "user@example.com",
    });
    prismaMocks.findUnique.mockResolvedValue({ ...userRecord });
    prismaMocks.accountFindUnique.mockResolvedValue({ ...credentialAccount });
    prismaMocks.accountUpdateMany.mockResolvedValue({ count: 1 });
    passwordMocks.verifyPassword.mockResolvedValue(false);
    passwordMocks.validatePasswordStrength.mockResolvedValue({
      isValid: true,
      score: 4,
      feedback: { warning: null, suggestions: [] },
    });
    passwordMocks.hashPassword.mockResolvedValue("$argon2id$newHashedPassword");
    prismaMocks.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        account: { updateMany: prismaMocks.accountUpdateMany },
        session: { deleteMany: prismaMocks.sessionDeleteMany },
      };
      return callback(tx);
    });
  });

  describe("rejection boundaries", () => {
    it("rejects accounts without a password hash", async () => {
      prismaMocks.findUnique.mockResolvedValue({
        email: "oauth@example.com",
        name: "OAuth User",
      });
      prismaMocks.accountFindUnique.mockResolvedValue(null);

      const response = await POST(
        createJsonRequest({
          currentPassword: "OldPassword123!",
          newPassword: "NewPassword123!",
        }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.detail).toMatch(
        /Cannot change password for this account type/i,
      );
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("rejects incorrect current password without opening a transaction", async () => {
      passwordMocks.verifyPassword.mockResolvedValue(false);

      const response = await POST(
        createJsonRequest({
          currentPassword: "WrongPassword123!",
          newPassword: "NewPassword123!",
        }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.detail).toMatch(/Current password is incorrect/i);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("rejects reusing the current password as the new password", async () => {
      // First verifyPassword call (currentPassword check) passes
      passwordMocks.verifyPassword
        .mockResolvedValueOnce(true)
        // Second verifyPassword call (same password check) passes -> returns true (is same)
        .mockResolvedValueOnce(true);

      const response = await POST(
        createJsonRequest({
          currentPassword: "SamePassword123!",
          newPassword: "SamePassword123!",
        }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.detail).toMatch(/New password must be different/i);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });

    it("rejects weak new passwords based on validatePasswordStrength feedback", async () => {
      passwordMocks.verifyPassword
        .mockResolvedValueOnce(true) // current password ok
        .mockResolvedValueOnce(false); // not same password

      passwordMocks.validatePasswordStrength.mockResolvedValue({
        isValid: false,
        score: 1,
        feedback: {
          warning: "Password is too common.",
          suggestions: ["Add another word or two."],
        },
      });

      const response = await POST(
        createJsonRequest({
          currentPassword: "ValidCurrent123!",
          newPassword: "password123",
        }),
      );

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.detail).toMatch(/Password is too common/i);
      expect(prismaMocks.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("successful password change and session invalidation", () => {
    it("updates the credential hash and deletes every server-side session in one transaction", async () => {
      passwordMocks.verifyPassword
        .mockResolvedValueOnce(true) // current password correct
        .mockResolvedValueOnce(false); // new password is distinct

      const response = await POST(
        createJsonRequest({
          currentPassword: "OldPassword123!",
          newPassword: "BrandNewSecurePassword123!",
        }),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.message).toMatch(/Password changed successfully/i);

      // Assert transaction was executed
      expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1);

      // Effect 1: The credential Account row receives the new hash
      expect(prismaMocks.accountUpdateMany).toHaveBeenCalledWith({
        where: { userId, accountId: userId, providerId: "credential" },
        data: { password: "$argon2id$newHashedPassword" },
      });

      // Effect 2: Every server-side session (this one included) is deleted
      // inside the same transaction, which revokes all cookies and closes
      // WebSockets at their next authorization refresh.
      expect(prismaMocks.sessionDeleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it("refuses to report success when no credential row was updated", async () => {
      passwordMocks.verifyPassword
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      prismaMocks.accountUpdateMany.mockResolvedValue({ count: 0 });

      const response = await POST(
        createJsonRequest({
          currentPassword: "OldPassword123!",
          newPassword: "BrandNewSecurePassword123!",
        }),
      );

      expect(response.status).toBe(400);
      expect(prismaMocks.sessionDeleteMany).not.toHaveBeenCalled();
    });
  });
});
