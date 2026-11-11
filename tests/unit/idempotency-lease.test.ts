import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

const idempotencyKey = vi.hoisted(() => ({
  findUnique: vi.fn(),
  delete: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { idempotencyKey } }));

import { runIdempotent } from "@/lib/api/route-handler";

const body = JSON.stringify({ a: 1 });
const hash = createHash("sha256").update(body).digest("hex");

function request() {
  return new NextRequest("http://localhost/api/v1/things", {
    method: "POST",
    headers: {
      "x-idempotency-key": "key-1",
      "content-type": "application/json",
    },
    body,
  });
}

function row(over: Record<string, unknown>) {
  return {
    id: "row-old",
    key: "key-1",
    userId: "u1",
    method: "POST",
    path: "/api/v1/things",
    requestHash: hash,
    responseCode: null,
    responseBody: null,
    createdAt: new Date(),
    lockedAt: new Date(),
    ...over,
  };
}

describe("runIdempotent in-flight lease", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    for (const fn of Object.values(idempotencyKey)) fn.mockReset();
    idempotencyKey.create.mockImplementation(async ({ data }) => ({
      id: "row-new",
      ...data,
    }));
    idempotencyKey.update.mockResolvedValue({});
    idempotencyKey.updateMany.mockResolvedValue({ count: 1 });
    idempotencyKey.deleteMany.mockResolvedValue({ count: 1 });
    idempotencyKey.delete.mockResolvedValue({});
  });
  afterEach(() => vi.useRealTimers());

  it("rejects a retry while a renewed lease is live, even 90s after createdAt", async () => {
    const now = Date.now();
    idempotencyKey.findUnique.mockResolvedValue(
      row({
        createdAt: new Date(now - 90_000),
        lockedAt: new Date(now - 5_000),
      }),
    );
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    await expect(runIdempotent(request(), "u1", handler)).rejects.toMatchObject(
      { detail: "Request is currently being processed" },
    );
    expect(handler).not.toHaveBeenCalled();
    expect(idempotencyKey.delete).not.toHaveBeenCalled();
    expect(idempotencyKey.deleteMany).not.toHaveBeenCalled();
  });

  it("takes over a stale lease only with a delete guarded by id and lockedAt", async () => {
    const now = Date.now();
    const lockedAt = new Date(now - 90_000);
    idempotencyKey.findUnique.mockResolvedValue(
      row({ createdAt: new Date(now - 90_000), lockedAt }),
    );
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await runIdempotent(request(), "u1", handler);
    expect(response.status).toBe(200);
    expect(idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: { id: "row-old", responseCode: null, lockedAt },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not run the handler when the guarded takeover loses the race", async () => {
    const now = Date.now();
    const stale = row({
      lockedAt: new Date(now - 90_000),
      createdAt: new Date(now - 90_000),
    });
    idempotencyKey.findUnique
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce({ ...stale, lockedAt: new Date(now) });
    idempotencyKey.deleteMany.mockResolvedValue({ count: 0 });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    await expect(runIdempotent(request(), "u1", handler)).rejects.toMatchObject(
      { detail: "Request is currently being processed" },
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("journals to its own row id and renews lockedAt while running", async () => {
    idempotencyKey.findUnique.mockResolvedValue(null);
    let finish!: () => void;
    const handler = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = () =>
            resolve(NextResponse.json({ ok: true }, { status: 201 }));
        }),
    );
    const pending = runIdempotent(request(), "u1", handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(45_000);
    const renewals = idempotencyKey.updateMany.mock.calls.filter(
      ([args]) => "lockedAt" in args.data,
    );
    expect(renewals.length).toBeGreaterThanOrEqual(2);
    expect(renewals[0][0].where).toEqual({ id: "row-new", responseCode: null });
    finish();
    await pending;
    const journal = idempotencyKey.updateMany.mock.calls.find(
      ([args]) => "responseCode" in args.data,
    );
    expect(journal?.[0].where).toEqual({ id: "row-new" });
    expect(idempotencyKey.update).not.toHaveBeenCalled();
    const count = idempotencyKey.updateMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(idempotencyKey.updateMany.mock.calls.length).toBe(count);
  });
});
