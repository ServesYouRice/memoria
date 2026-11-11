/**
 * TASK-177: transient failures (5xx, 429) are not journaled against the
 * idempotency key, so a retry runs again; deterministic results are still
 * replayed, with a Content-Type that matches the stored status.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

type Row = {
  id: string;
  key: string;
  userId: string;
  method: string;
  path: string;
  requestHash: string | null;
  responseCode: number | null;
  responseBody: unknown;
  createdAt: Date;
};

const store = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  let next = 0;
  const scopeKey = (s: {
    key: string;
    userId: string;
    method: string;
    path: string;
  }) => `${s.key}|${s.userId}|${s.method}|${s.path}`;
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([field, value]) => (row as Record<string, unknown>)[field] === value,
    );
  const api = {
    findUnique: vi.fn(async ({ where }) => {
      const found = rows.get(scopeKey(where.key_userId_method_path));
      return found ? { ...found } : null;
    }),
    create: vi.fn(async ({ data }) => {
      const id = scopeKey(data);
      if (rows.has(id)) throw new Error("unique violation");
      next += 1;
      const row: Row = {
        id: `row-${next}`,
        responseCode: null,
        responseBody: null,
        createdAt: new Date(),
        requestHash: null,
        ...data,
      };
      rows.set(id, row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = rows.get(scopeKey(where.key_userId_method_path));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return { ...row };
    }),
    delete: vi.fn(async ({ where }) => {
      for (const [id, row] of rows)
        if (row.id === where.id) {
          rows.delete(id);
          return row;
        }
      throw new Error("not found");
    }),
    deleteMany: vi.fn(async ({ where }) => {
      let count = 0;
      for (const [id, row] of rows)
        if (matches(row, where)) {
          rows.delete(id);
          count += 1;
        }
      return { count };
    }),
  };
  return { rows, api };
});
vi.mock("@/lib/db", () => ({ prisma: { idempotencyKey: store.api } }));

import { runIdempotent } from "@/lib/api/route-handler";
import { TooManyRequestsError, ValidationError } from "@/lib/errors";
import { runWithRequestContext } from "@/lib/api/request-context";

function request(key = "key-1") {
  return new NextRequest("http://localhost/api/v1/canvas-items", {
    method: "POST",
    headers: { "x-idempotency-key": key, "content-type": "application/json" },
    body: JSON.stringify({ name: "Item" }),
  });
}

beforeEach(() => {
  store.rows.clear();
  vi.clearAllMocks();
});

describe("runIdempotent transient failures", () => {
  it("runs the handler again after a thrown unexpected error", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("lock wait timeout"))
      .mockResolvedValueOnce(NextResponse.json({ id: "i1" }, { status: 201 }));

    const first = await runIdempotent(request(), "user-1", handler);
    expect(first.status).toBe(500);
    const second = await runIdempotent(request(), "user-1", handler);
    expect(second.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(second.headers.get("x-idempotency-hit")).toBeNull();

    // The success is journaled and replayed.
    const third = await runIdempotent(request(), "user-1", handler);
    expect(third.status).toBe(201);
    expect(third.headers.get("x-idempotency-hit")).toBe("true");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not journal a returned 503 or a 429", async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce(
        NextResponse.json({ title: "Unavailable" }, { status: 503 }),
      )
      .mockRejectedValueOnce(new TooManyRequestsError())
      .mockResolvedValueOnce(NextResponse.json({ ok: true }, { status: 200 }));
    expect((await runIdempotent(request(), "user-1", handler)).status).toBe(
      503,
    );
    expect((await runIdempotent(request(), "user-1", handler)).status).toBe(
      429,
    );
    expect((await runIdempotent(request(), "user-1", handler)).status).toBe(
      200,
    );
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("replays a deterministic 400 as problem+json with the request id", async () => {
    const handler = vi.fn().mockRejectedValue(new ValidationError("Bad"));
    const first = await runIdempotent(request(), "user-1", handler);
    expect(first.status).toBe(400);

    const replay = await runWithRequestContext("req-42", () =>
      runIdempotent(request(), "user-1", handler),
    );
    expect(replay.status).toBe(400);
    expect(replay.headers.get("x-idempotency-hit")).toBe("true");
    expect(replay.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(replay.headers.get("x-request-id")).toBe("req-42");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("releases only its own claim", async () => {
    const handler = vi.fn(async () => {
      // Another claim replaced this one while the handler ran.
      const [id] = store.rows.keys();
      store.rows.get(id)!.id = "someone-else";
      throw new Error("boom");
    });
    await runIdempotent(request(), "user-1", handler);
    expect([...store.rows.values()].map((row) => row.id)).toEqual([
      "someone-else",
    ]);
  });
});
