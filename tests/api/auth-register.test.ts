import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  transaction: vi.fn(),
  hashPassword: vi.fn(),
  createCredentialAccount: vi.fn(),
  enqueueOutboxJob: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/env", () => ({ env: { REGISTRATION_MODE: "open" } }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: mocks.hashPassword }));
vi.mock("@/lib/auth/credentials", () => ({
  createCredentialAccount: mocks.createCredentialAccount,
}));
vi.mock("@/lib/agents/crypto", () => ({
  encryptSecret: (value: string) => `enc:${value}`,
}));
vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: mocks.enqueueOutboxJob,
}));
vi.mock("@/lib/validation/password", () => ({
  validatePasswordStrength: async () => ({
    isValid: true,
    score: 4,
    feedback: { warning: "", suggestions: [] },
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { POST } from "@/app/api/v1/auth/register/route";

const FLOOR_MS = 500;

function runTransaction(run: (tx: unknown) => unknown) {
  return run({
    registrationInvite: { updateMany: vi.fn() },
    user: { create: mocks.userCreate },
    workspace: { create: vi.fn().mockResolvedValue({ id: "ws-1" }) },
    canvas: { create: vi.fn() },
    emailVerificationToken: {
      create: vi.fn().mockResolvedValue({ id: "verification-1" }),
    },
  });
}

function register(email: string) {
  return POST(
    new Request("https://memoria.example/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "a correct horse battery staple",
        name: "Ada",
      }),
    }) as never,
  );
}

async function timed(email: string) {
  const startedAt = performance.now();
  const response = await register(email);
  const elapsedMs = performance.now() - startedAt;
  return { response, elapsedMs, body: await response.json() };
}

describe("POST /api/v1/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashPassword.mockResolvedValue("argon2-hash");
    mocks.userCreate.mockResolvedValue({
      id: "cmh3k2a9v0000abcdxyz12345",
      email: "new@example.com",
    });
    mocks.transaction.mockImplementation(runTransaction);
  });

  it("answers a new and an existing email identically", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);
    const created = await timed("new@example.com");
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueOutboxJob).toHaveBeenCalledTimes(1);

    mocks.userFindUnique.mockResolvedValueOnce({ id: "existing-user" });
    const existing = await timed("New@Example.com");
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);

    expect(existing.response.status).toBe(created.response.status);
    expect(created.response.status).toBe(202);
    expect(existing.body).toEqual(created.body);
    expect(created.body).toEqual({
      email: "new@example.com",
      name: "Ada",
      verificationRequired: true,
      verificationEmailQueued: true,
      message:
        "If this email can be registered, a verification message is on its way.",
    });
    expect(JSON.stringify(created.body)).not.toContain(
      "cmh3k2a9v0000abcdxyz12345",
    );
    expect(created.body).not.toHaveProperty("id");
    expect(created.body).not.toHaveProperty("createdAt");
  });

  it("holds both answers to the same response-time floor", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ id: "existing-user" });
    const existing = await timed("existing@example.com");

    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.transaction.mockImplementationOnce(
      async (run: (tx: unknown) => unknown) => {
        // A slower account transaction still finishes inside the floor.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return runTransaction(run);
      },
    );
    const created = await timed("new@example.com");

    // Timer granularity allows answering a millisecond or so early.
    expect(existing.elapsedMs).toBeGreaterThanOrEqual(FLOOR_MS - 5);
    expect(created.elapsedMs).toBeGreaterThanOrEqual(FLOOR_MS - 5);
    expect(Math.abs(existing.elapsedMs - created.elapsedMs)).toBeLessThan(150);
  });

  it("answers a lost unique-email race like any other registration", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.transaction.mockRejectedValueOnce(
      Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["email"] },
      }),
    );
    const raced = await timed("race@example.com");

    expect(raced.response.status).toBe(202);
    expect(raced.body).toEqual({
      email: "race@example.com",
      name: "Ada",
      verificationRequired: true,
      verificationEmailQueued: true,
      message:
        "If this email can be registered, a verification message is on its way.",
    });
  });
});
