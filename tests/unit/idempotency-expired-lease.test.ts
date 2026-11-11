import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { idempotencyKey: db } }));

import { runIdempotent } from "@/lib/api/route-handler";
import { ConflictError } from "@/lib/errors";

const body = JSON.stringify({ name: "Board" });
const hash = createHash("sha256").update(body).digest("hex");

function request() {
  return new NextRequest("http://localhost/api/v1/canvases", {
    method: "POST",
    headers: {
      "x-idempotency-key": "key-1",
      "content-type": "application/json",
    },
    body,
  });
}

function row(overrides: Record<string, unknown>) {
  return {
    id: "row-1",
    requestHash: hash,
    responseCode: null,
    responseBody: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.create.mockResolvedValue({});
  db.update.mockResolvedValue({});
  db.delete.mockResolvedValue({});
});

describe("runIdempotent with an unjournaled key", () => {
  it("refuses, without rerunning the handler, once the lease expired", async () => {
    db.findUnique.mockResolvedValue(
      row({ createdAt: new Date(Date.now() - 5 * 60 * 1000) }),
    );
    const handler = vi.fn(async () =>
      NextResponse.json({ id: "c" }, { status: 201 }),
    );

    const outcome = runIdempotent(request(), "user-1", handler);

    await expect(outcome).rejects.toBeInstanceOf(ConflictError);
    const error = (await outcome.catch((e: unknown) => e)) as ConflictError;
    expect(error.detail).toMatch(/outcome is unknown/);
    expect(JSON.stringify(error)).not.toContain("Board");
    expect(handler).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("still refuses while the lease is live", async () => {
    db.findUnique.mockResolvedValue(row({}));
    const handler = vi.fn();
    await expect(
      runIdempotent(request(), "user-1", handler),
    ).rejects.toMatchObject({ detail: "Request is currently being processed" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("still replays a completed key", async () => {
    db.findUnique.mockResolvedValue(
      row({ responseCode: 201, responseBody: { id: "c" } }),
    );
    const handler = vi.fn();
    const response = await runIdempotent(request(), "user-1", handler);
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Idempotency-Hit")).toBe("true");
    expect(handler).not.toHaveBeenCalled();
  });

  it("still frees a key older than the TTL", async () => {
    db.findUnique.mockResolvedValue(
      row({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }),
    );
    const handler = vi.fn(async () =>
      NextResponse.json({ id: "c" }, { status: 201 }),
    );
    const response = await runIdempotent(request(), "user-1", handler);
    expect(response.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalled();
  });
});
