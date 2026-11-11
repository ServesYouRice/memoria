/**
 * TASK-158 — failed and URL-less bookmark refresh attempts advance
 * bookmarkRefreshedAt, so permanently failing bookmarks stop taking every
 * refresh batch; the cron enqueues nothing while unfurling is switched off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  recordEvent: vi.fn(),
  enqueue: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/utils/ssrf-protection", () => ({ safeFetch: mocks.safeFetch }));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: mocks.recordEvent,
}));
vi.mock("@/lib/cache/canvas-cache", () => ({ invalidateCanvasCache: vi.fn() }));
vi.mock("@/lib/outbox/enqueue", () => ({ enqueueOutboxJob: mocks.enqueue }));
vi.mock("@/lib/db", () => {
  const tx = { canvasItem: { findMany: mocks.findMany } };
  return {
    prisma: {
      ...tx,
      $transaction: async (callback: (client: unknown) => unknown) =>
        callback(tx),
    },
  };
});

import { createBookmarkRefreshHandler } from "@/lib/bookmarks/outbox-handler";
import { GET as refreshCron } from "@/app/api/cron/refresh-bookmarks/route";

const ITEM_ID = "clzzzzzzzzzzzzzzzzzzzzzzz";

function fakePrisma(content: Record<string, unknown>) {
  const executeRaw = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const client = {
    canvasItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: ITEM_ID,
        canvasId: "clxxxxxxxxxxxxxxxxxxxxxxx",
        type: "BOOKMARK",
        content,
        version: 4,
        createdById: "user-1",
        updatedById: null,
      }),
      updateMany,
    },
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(client),
    ),
  };
  return { client: client as unknown as PrismaClient, executeRaw, updateMany };
}

function stampedSql(executeRaw: ReturnType<typeof vi.fn>) {
  return executeRaw.mock.calls.map((call) =>
    (call[0] as TemplateStringsArray).join("?"),
  );
}

const run = (client: PrismaClient) =>
  createBookmarkRefreshHandler(client)({
    payload: { itemId: ITEM_ID },
  } as never);

describe("bookmark refresh attempt stamping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps a non-OK fetch and still throws for the outbox retry", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: false, error: "404" });
    const { client, executeRaw, updateMany } = fakePrisma({
      url: "https://dead.example",
    });
    await expect(run(client)).rejects.toThrow("Bookmark metadata fetch failed");
    expect(stampedSql(executeRaw)).toEqual([
      expect.stringContaining('SET "bookmarkRefreshedAt" = NOW()'),
    ]);
    expect(updateMany).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("stamps a fetch that throws and rethrows the same error", async () => {
    const failure = new Error("socket hang up");
    mocks.safeFetch.mockRejectedValue(failure);
    const { client, executeRaw } = fakePrisma({ url: "https://slow.example" });
    await expect(run(client)).rejects.toBe(failure);
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("stamps a bookmark without a URL", async () => {
    const { client, executeRaw } = fakePrisma({ title: "No link" });
    await run(client);
    expect(mocks.safeFetch).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledOnce();
  });
});

describe("refresh-bookmarks cron with unfurling disabled", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("enqueues no refresh jobs", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.FEATURE_BOOKMARK_UNFURLING = "false";
    mocks.findMany.mockResolvedValue([{ id: ITEM_ID }]);
    const response = await refreshCron(
      new NextRequest("http://localhost/api/cron/refresh-bookmarks", {
        headers: { authorization: "Bearer secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ queued: 0 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("still refuses a bad secret before the flag check", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.FEATURE_BOOKMARK_UNFURLING = "false";
    const response = await refreshCron(
      new NextRequest("http://localhost/api/cron/refresh-bookmarks", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(response.status).toBe(401);
  });
});
