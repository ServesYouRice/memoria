import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "@/lib/agents/crypto";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tokenCreate: vi.fn(),
  enqueueOutboxJob: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ passwordResetToken: { create: mocks.tokenCreate } }),
  },
}));
vi.mock("@/lib/outbox/enqueue", () => ({
  enqueueOutboxJob: mocks.enqueueOutboxJob,
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { POST } from "@/app/api/v1/auth/forgot-password/route";

const FLOOR_MS = 500;
const RESET_ID = "clreset1234567890123456789";

function request(email: string) {
  return new NextRequest("http://localhost/api/v1/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

async function settle(promise: Promise<Response>) {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(FLOOR_MS - 1);
  const beforeFloor = done;
  await vi.advanceTimersByTimeAsync(1);
  return { beforeFloor, afterFloor: done };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.userFindUnique.mockReset();
  mocks.tokenCreate.mockReset().mockResolvedValue({ id: RESET_ID });
  mocks.enqueueOutboxJob.mockReset().mockResolvedValue({ id: "job-1" });
  mocks.sendPasswordResetEmail.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/v1/auth/forgot-password", () => {
  it("enqueues the reset mail with its token instead of sending it inline", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u1", name: "Ada" });
    const response = POST(request("Ada@Example.com"));
    const timing = await settle(response);

    expect(timing).toEqual({ beforeFloor: false, afterFloor: true });
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mocks.tokenCreate).toHaveBeenCalledTimes(1);
    const { data } = mocks.tokenCreate.mock.calls[0]![0] as {
      data: { token: string; email: string; deliverySecret: string };
    };
    expect(data.email).toBe("ada@example.com");
    // The lookup key is a hash; the raw token is kept encrypted for the job.
    const raw = decryptSecret(data.deliverySecret);
    expect(raw).toHaveLength(32);
    expect(data.token).not.toBe(raw);

    expect(mocks.enqueueOutboxJob).toHaveBeenCalledTimes(1);
    const [, job] = mocks.enqueueOutboxJob.mock.calls[0]!;
    expect(job).toEqual({
      type: "email.password-reset",
      payload: { resetTokenId: RESET_ID },
      dedupeKey: `email.password-reset:${RESET_ID}`,
    });
    // The secret never enters the job payload.
    expect(JSON.stringify(job)).not.toContain(raw);

    const body = await (await response).json();
    expect(body).toEqual({
      message:
        "If an account exists with this email, you will receive password reset instructions.",
    });
  });

  it("waits out the same floor and returns the same body for an unknown email", async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    const response = POST(request("nobody@example.com"));
    const timing = await settle(response);

    expect(timing).toEqual({ beforeFloor: false, afterFloor: true });
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
    expect(mocks.enqueueOutboxJob).not.toHaveBeenCalled();
    const resolved = await response;
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({
      message:
        "If an account exists with this email, you will receive password reset instructions.",
    });
  });
});
