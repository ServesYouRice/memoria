import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tokenCreate: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    passwordResetToken: { create: mocks.tokenCreate },
  },
}));
vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { POST } from "@/app/api/v1/auth/forgot-password/route";

const FLOOR_MS = 500;

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
  mocks.tokenCreate.mockReset().mockResolvedValue({ id: "tok-1" });
  // A provider that never answers: the request must not wait on it.
  mocks.sendPasswordResetEmail
    .mockReset()
    .mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/v1/auth/forgot-password", () => {
  it("does not wait on the email provider for an existing account", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "u1", name: "Ada" });
    const response = POST(request("ada@example.com"));
    const timing = await settle(response);

    expect(timing).toEqual({ beforeFloor: false, afterFloor: true });
    expect(mocks.tokenCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
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
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    const resolved = await response;
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({
      message:
        "If an account exists with this email, you will receive password reset instructions.",
    });
  });
});
