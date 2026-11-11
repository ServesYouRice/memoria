import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validatePasswordStrength: vi.fn(async () => ({
    isValid: true,
    score: 4,
    feedback: { warning: "", suggestions: [] },
  })),
  hashPassword: vi.fn(async () => "hash"),
  tokenFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/validation/password", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  validatePasswordStrength: mocks.validatePasswordStrength,
}));
vi.mock("@/lib/auth/password", () => ({ hashPassword: mocks.hashPassword }));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    passwordResetToken: { findUnique: mocks.tokenFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/env", () => ({ env: { REGISTRATION_MODE: "open" } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("password maximum length on unauthenticated routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokenFindUnique.mockResolvedValue({
      id: "t1",
      email: "ada@example.com",
      expiresAt: new Date(Date.now() + 3_600_000),
      usedAt: null,
    });
    mocks.userFindUnique.mockResolvedValue({ id: "u1", name: "Ada" });
  });

  for (const [label, password] of [
    ["129 characters", "a".repeat(129)],
    ["1 MB", "a".repeat(1024 * 1024)],
  ] as const) {
    it(`register rejects a ${label} password before analysis`, async () => {
      const response = await register(
        post("https://memoria.example/api/v1/auth/register", {
          email: "ada@example.com",
          password,
          name: "Ada",
        }),
      );
      expect(response.status).toBe(400);
      expect(mocks.validatePasswordStrength).not.toHaveBeenCalled();
      expect(mocks.hashPassword).not.toHaveBeenCalled();
    });

    it(`reset-password rejects a ${label} password before analysis`, async () => {
      const response = await resetPassword(
        post("https://memoria.example/api/v1/auth/reset-password", {
          token: "reset-token",
          password,
        }),
      );
      expect(response.status).toBe(400);
      expect(mocks.validatePasswordStrength).not.toHaveBeenCalled();
      expect(mocks.hashPassword).not.toHaveBeenCalled();
    });
  }
});
