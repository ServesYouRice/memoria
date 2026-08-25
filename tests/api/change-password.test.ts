import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  userUpdate: vi.fn(),
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

const sessionCacheMocks = vi.hoisted(() => ({
  invalidateSessionVersion: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: prismaMocks.findUnique,
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

vi.mock("@/lib/api/session-cache", () => ({
  invalidateSessionVersion: sessionCacheMocks.invalidateSessionVersion,
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
    passwordHash: "$argon2id$existingHash",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireAuth.mockResolvedValue({
      userId,
      email: "user@example.com",
    });
    prismaMocks.findUnique.mockResolvedValue({ ...userRecord });
    passwordMocks.verifyPassword.mockResolvedValue(false);
    passwordMocks.validatePasswordStrength.mockResolvedValue({
      isValid: true,
      score: 4,
      feedback: { warning: null, suggestions: [] },
    });
    passwordMocks.hashPassword.mockResolvedValue("$argon2id$newHashedPassword");
    prismaMocks.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        user: { update: prismaMocks.userUpdate },
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
        passwordHash: null,
      });

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
    it("updates passwordHash, increments sessionVersion, deletes DB sessions, and invalidates session version cache", async () => {
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

      // Effect 1: Password hash updated and sessionVersion incremented
      expect(prismaMocks.userUpdate).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          passwordHash: "$argon2id$newHashedPassword",
          sessionVersion: { increment: 1 },
        },
      });

      // Effect 2: DB sessions for user deleted inside transaction
      expect(prismaMocks.sessionDeleteMany).toHaveBeenCalledWith({
        where: { userId },
      });

      // Effect 3: Redis/In-memory session version cache invalidated
      expect(sessionCacheMocks.invalidateSessionVersion).toHaveBeenCalledWith(
        userId,
      );
    });
  });
});
