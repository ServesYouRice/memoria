import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tokenFindUnique: vi.fn(),
  tokenUpdateMany: vi.fn(),
  tokenCreate: vi.fn(),
  tokenUpdate: vi.fn(),
  userUpdate: vi.fn(),
  transaction: vi.fn(),
  sendEmailVerification: vi.fn(),
  outboxUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
    },
    emailVerificationToken: {
      findUnique: mocks.tokenFindUnique,
      update: mocks.tokenUpdate,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/email", () => ({
  sendEmailVerification: mocks.sendEmailVerification,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

describe("email verification API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_URL", "https://memoria.example");
    mocks.tokenCreate.mockResolvedValue({ id: "verification-1" });
    mocks.transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === "function") {
        return input({
          emailVerificationToken: {
            updateMany: mocks.tokenUpdateMany,
            create: mocks.tokenCreate,
          },
          outboxJob: { upsert: mocks.outboxUpsert },
        });
      }
      return input;
    });
  });

  it("returns the same resend response for an unknown account", async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/auth/send-verification/route");
    const response = await POST(
      new Request("https://memoria.example/api/v1/auth/send-verification", {
        method: "POST",
        body: JSON.stringify({ email: "missing@example.com" }),
      }) as never,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      message:
        "If an unverified account exists for that email, a verification message has been sent.",
    });
    expect(mocks.sendEmailVerification).not.toHaveBeenCalled();
  });

  it("retires outstanding tokens and durably queues a replacement", async () => {
    mocks.userFindUnique.mockResolvedValue({
      email: "user@example.com",
      name: "User",
      emailVerified: null,
    });
    const { POST } = await import("@/app/api/v1/auth/send-verification/route");
    const response = await POST(
      new Request("https://memoria.example/api/v1/auth/send-verification", {
        method: "POST",
        body: JSON.stringify({ email: "USER@example.com" }),
      }) as never,
    );

    expect(response.status).toBe(202);
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({
      where: { email: "user@example.com", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(mocks.tokenCreate).toHaveBeenCalledOnce();
    expect(mocks.outboxUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: "email.verification",
          payload: { verificationId: "verification-1" },
        }),
      }),
    );
  });

  it("rejects expired tokens", async () => {
    mocks.tokenFindUnique.mockResolvedValue({
      id: "token-1",
      email: "user@example.com",
      expiresAt: new Date(Date.now() - 1_000),
      usedAt: null,
    });
    const { POST } = await import("@/app/api/v1/auth/verify-email/route");
    const response = await POST(
      new Request("https://memoria.example/api/v1/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token: "expired" }),
      }) as never,
    );

    expect(response.status).toBe(400);
  });

  it("verifies a valid token and returns the login success destination", async () => {
    mocks.tokenFindUnique.mockResolvedValue({
      id: "token-1",
      email: "user@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      emailVerified: null,
    });
    const { POST } = await import("@/app/api/v1/auth/verify-email/route");
    const response = await POST(
      new Request("https://memoria.example/api/v1/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token: "valid" }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      redirectTo: "/auth/login?verified=1",
    });
  });
});
