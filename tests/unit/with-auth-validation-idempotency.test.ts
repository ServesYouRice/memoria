import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const store = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
}));
const idempotencyKey = vi.hoisted(() => ({
  findUnique: vi.fn(),
  delete: vi.fn(async () => ({})),
  deleteMany: vi.fn(async () => ({ count: 1 })),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { idempotencyKey } }));
vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: vi.fn(async () => ({ user: { id: "u1" } })),
  runWithSessionCache: (fn: () => unknown) => fn(),
}));

import { withAuthValidation } from "@/lib/api/route-handler";

function keyOf(where: { key_userId_method_path: Record<string, string> }) {
  return Object.values(where.key_userId_method_path).join("|");
}

beforeEach(() => {
  store.rows.clear();
  idempotencyKey.findUnique.mockImplementation(
    async ({ where }) => store.rows.get(keyOf(where)) ?? null,
  );
  idempotencyKey.create.mockImplementation(async ({ data }) => {
    const row = {
      id: `row-${store.rows.size + 1}`,
      responseCode: null,
      responseBody: null,
      createdAt: new Date(),
      lockedAt: new Date(),
      ...data,
    };
    store.rows.set(
      [data.key, data.userId, data.method, data.path].join("|"),
      row,
    );
    return row;
  });
  const journal = async ({
    where,
    data,
  }: {
    where: { id?: string; key_userId_method_path?: Record<string, string> };
    data: Record<string, unknown>;
  }) => {
    for (const row of store.rows.values()) {
      if (
        (where.id && row.id === where.id) ||
        (where.key_userId_method_path &&
          store.rows.get(keyOf(where as never)) === row)
      ) {
        Object.assign(row, data);
        return { count: 1 };
      }
    }
    return { count: 0 };
  };
  idempotencyKey.update.mockImplementation(journal);
  idempotencyKey.updateMany.mockImplementation(journal);
});

const schema = z.object({ prompt: z.string().min(1) });

function post(body: string, key?: string) {
  return new NextRequest("http://localhost/api/v1/ai/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-idempotency-key": key } : {}),
    },
    body,
  });
}

describe("withAuthValidation with X-Idempotency-Key", () => {
  it("runs a keyed request once and replays the retry", async () => {
    const handler = vi.fn(async (data: { prompt: string }) =>
      NextResponse.json({ echo: data.prompt }),
    );
    const route = withAuthValidation(schema, handler);
    const first = await route(post('{"prompt":"hi"}', "k-1"), undefined);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ echo: "hi" });
    const second = await route(post('{"prompt":"hi"}', "k-1"), undefined);
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Idempotency-Hit")).toBe("true");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps unkeyed requests and validation errors unchanged", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withAuthValidation(schema, handler);
    expect((await route(post('{"prompt":"hi"}'), undefined)).status).toBe(200);
    expect((await route(post('{"prompt":""}'), undefined)).status).toBe(400);
    expect((await route(post("{not json"), undefined)).status).toBe(400);
    expect((await route(post('{"prompt":""}', "k-2"), undefined)).status).toBe(
      400,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
