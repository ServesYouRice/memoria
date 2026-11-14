import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

type Batch = {
  id: string;
  userId: string;
  canvasId: string;
  source: string;
  idempotencyKey: string;
  requestHash: string;
  note: string | null;
  createdAt: Date;
  items: Array<{ itemId: string; position: number }>;
};

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  checkApiKeyRateLimit: vi.fn(),
  invalidateCanvasCache: vi.fn(),
  recordCanvasItemEventsBatch: vi.fn(),
  enqueueLinkEnrichment: vi.fn(async () => 0),
  state: {
    canvases: [] as Array<{ id: string; userId: string; name: string }>,
    liveItems: 0,
    items: [] as Array<Record<string, unknown> & { id: string }>,
    batches: [] as Batch[],
    /** Bookmarks already in the user's boards, for the duplicate lookup. */
    existing: [] as Array<{
      id: string;
      canvasId: string;
      canvasName: string;
      url: string;
      title: string | null;
    }>,
  },
}));

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateApiKey: mocks.authenticateApiKey,
  checkApiKeyRateLimit: mocks.checkApiKeyRateLimit,
  getApiKeyRateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: mocks.invalidateCanvasCache,
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEventsBatch: mocks.recordCanvasItemEventsBatch,
}));
vi.mock("@/lib/services/link-enrichment", () => ({
  enqueueLinkEnrichment: mocks.enqueueLinkEnrichment,
}));
vi.mock("@/lib/db", () => {
  const state = mocks.state;
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}${++sequence}`;
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      strings.join("").includes('FROM "CanvasItem"')
        ? state.existing
        : [{ locked: 1 }],
    ),
    clipBatch: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            userId_idempotencyKey: { userId: string; idempotencyKey: string };
          };
        }) =>
          state.batches.find(
            (batch) =>
              batch.userId === where.userId_idempotencyKey.userId &&
              batch.idempotencyKey ===
                where.userId_idempotencyKey.idempotencyKey,
          ) ?? null,
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<Batch, "id" | "createdAt" | "items"> & {
            items: {
              createMany: {
                data: Array<{ itemId: string; position: number }>;
              };
            };
          };
        }) => {
          const batch: Batch = {
            ...data,
            id: nextId("batch"),
            createdAt: new Date(),
            items: data.items.createMany.data,
          };
          state.batches.push(batch);
          return { id: batch.id };
        },
      ),
    },
    canvas: {
      findFirst: vi.fn(
        async ({ where }: { where: { userId: string; name: string } }) =>
          state.canvases.find(
            (canvas) =>
              canvas.userId === where.userId && canvas.name === where.name,
          ) ?? null,
      ),
      count: vi.fn(async () => state.canvases.length),
      create: vi.fn(
        async ({ data }: { data: { userId: string; name: string } }) => {
          const canvas = { id: nextId("canvas"), ...data };
          state.canvases.push(canvas);
          return { id: canvas.id };
        },
      ),
    },
    // IMP-109: no items from other canvases are shown on the Inbox.
    itemPlacement: { count: vi.fn(async () => 0) },
    canvasItem: {
      count: vi.fn(async () => state.liveItems),
      findMany: vi.fn(async () => []),
      createManyAndReturn: vi.fn(
        async ({ data }: { data: Array<Record<string, unknown>> }) => {
          const created = data.map((row) => ({
            ...row,
            id: nextId("item"),
            version: 1,
          }));
          state.items.push(...created);
          state.liveItems += created.length;
          return created.map(({ id, version }) => ({ id, version }));
        },
      ),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => {
          // Roll the in-memory state back when the callback throws, like a
          // real transaction would.
          const snapshot = {
            canvases: [...state.canvases],
            items: [...state.items],
            batches: [...state.batches],
            liveItems: state.liveItems,
          };
          try {
            return await callback(tx);
          } catch (error) {
            Object.assign(state, snapshot);
            throw error;
          }
        },
      ),
      clipBatch: {
        findFirst: vi.fn(
          async ({ where }: { where: { canvasId: string; userId?: string } }) =>
            [...state.batches]
              .reverse()
              .find(
                (batch) =>
                  batch.canvasId === where.canvasId &&
                  batch.note !== null &&
                  (!where.userId || batch.userId === where.userId),
              ) ?? null,
        ),
      },
    },
  };
});

import { POST } from "@/app/api/v1/extensions/clip/batch/route";
import { getLatestClipBatchNote } from "@/lib/services/clip-batch";

let keyCounter = 0;

function request(body: unknown, apiKey: string | null = "mk_test") {
  return new NextRequest("http://localhost/api/v1/extensions/clip/batch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function links(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://example.com/page-${index}`,
    title: `Page ${index}`,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.canvases = [];
  mocks.state.items = [];
  mocks.state.batches = [];
  mocks.state.liveItems = 0;
  mocks.state.existing = [];
  // A fresh key per test keeps the real batch limiter from carrying over.
  keyCounter += 1;
  mocks.authenticateApiKey.mockResolvedValue({
    user: { id: "u1", name: null, email: "u@x.dev", image: null },
    apiKeyId: `key-${keyCounter}`,
    apiKeyName: "Browser extension",
  });
  mocks.checkApiKeyRateLimit.mockResolvedValue({
    allowed: true,
    limit: 300,
    remaining: 299,
    resetAt: 0,
    resetIn: 60,
  });
});

describe("POST /api/v1/extensions/clip/batch", () => {
  it("rejects a request without a valid API key before reading the body", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    const response = await POST(request("not json", null), {});
    expect(response.status).toBe(401);
    expect(mocks.state.items).toHaveLength(0);
  });

  it("returns 429 when the API key is over its rate limit", async () => {
    mocks.checkApiKeyRateLimit.mockResolvedValue({
      allowed: false,
      limit: 300,
      remaining: 0,
      resetAt: 0,
      resetIn: 30,
    });
    const response = await POST(
      request({ idempotencyKey: "batch-0001", links: links(1) }),
      {},
    );
    expect(response.status).toBe(429);
    expect(mocks.state.items).toHaveLength(0);
  });

  it("limits batches per key separately from the general API budget", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      const response = await POST(
        request({ idempotencyKey: `batch-limit-${index}`, links: links(1) }),
        {},
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it.each([
    ["invalid JSON", "{"],
    ["no links", { idempotencyKey: "batch-0001", links: [] }],
    [
      "more than 100 links",
      { idempotencyKey: "batch-0001", links: links(101) },
    ],
    ["a missing idempotency key", { links: links(1) }],
    ["a short idempotency key", { idempotencyKey: "abc", links: links(1) }],
    [
      "a non-web link",
      {
        idempotencyKey: "batch-0001",
        links: [{ url: "chrome://extensions" }],
      },
    ],
    [
      "a javascript: link",
      { idempotencyKey: "batch-0001", links: [{ url: "javascript:alert(1)" }] },
    ],
    [
      "an overlong note",
      { idempotencyKey: "batch-0001", links: links(1), note: "x".repeat(2001) },
    ],
  ])("rejects %s", async (_label, body) => {
    const response = await POST(request(body), {});
    expect(response.status).toBe(400);
    expect(mocks.state.items).toHaveLength(0);
    expect(mocks.state.batches).toHaveLength(0);
  });

  it("saves 100 links to a new Inbox in one transaction and stores the note", async () => {
    const response = await POST(
      request({
        idempotencyKey: "batch-0001",
        links: links(100),
        note: "  Group by project  ",
      }),
      {},
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.itemIds).toHaveLength(100);
    expect(body.replayed).toBe(false);

    expect(mocks.state.canvases).toEqual([
      expect.objectContaining({ id: body.canvasId, name: "Inbox" }),
    ]);
    expect(mocks.state.items).toHaveLength(100);
    expect(mocks.state.items[0]).toMatchObject({
      canvasId: body.canvasId,
      type: "BOOKMARK",
      createdById: "u1",
      content: { url: "https://example.com/page-0", title: "Page 0" },
    });
    // Each link gets its own slot instead of stacking.
    const slots = new Set(
      mocks.state.items.map((item) => `${item.positionX},${item.positionY}`),
    );
    expect(slots.size).toBe(100);

    expect(mocks.state.batches).toEqual([
      expect.objectContaining({
        id: body.batchId,
        source: "EXTENSION",
        note: "Group by project",
        items: body.itemIds.map((itemId: string, position: number) => ({
          itemId,
          position,
        })),
      }),
    ]);
    expect(mocks.recordCanvasItemEventsBatch).toHaveBeenCalledTimes(1);
    expect(mocks.recordCanvasItemEventsBatch.mock.calls[0]![1]).toHaveLength(
      100,
    );
    expect(mocks.invalidateCanvasCache).toHaveBeenCalledWith(body.canvasId);
    // One enrichment job per link, enqueued in the batch transaction.
    expect(mocks.enqueueLinkEnrichment).toHaveBeenCalledTimes(1);
    const [, enrichUserId, targets] = mocks.enqueueLinkEnrichment.mock
      .calls[0] as unknown as [unknown, string, Array<Record<string, unknown>>];
    expect(enrichUserId).toBe("u1");
    expect(targets).toHaveLength(100);
    expect(targets[0]).toEqual({
      itemId: body.itemIds[0],
      baseTitle: "Page 0",
    });

    await expect(getLatestClipBatchNote(body.canvasId)).resolves.toMatchObject({
      batchId: body.batchId,
      note: "Group by project",
      itemIds: body.itemIds,
    });
  });

  it("uses the existing Inbox board and stores no note when it is blank", async () => {
    mocks.state.canvases.push({ id: "inbox-1", userId: "u1", name: "Inbox" });
    const response = await POST(
      request({ idempotencyKey: "batch-0002", links: links(2), note: "   " }),
      {},
    );
    expect(response.status).toBe(201);
    expect((await response.json()).canvasId).toBe("inbox-1");
    expect(mocks.state.canvases).toHaveLength(1);
    expect(mocks.state.batches[0]!.note).toBeNull();
    await expect(getLatestClipBatchNote("inbox-1")).resolves.toBeNull();
  });

  it("replays a repeated batch without creating duplicates", async () => {
    const body = {
      idempotencyKey: "batch-replay-1",
      links: links(3),
      note: "Read later",
    };
    const first = await POST(request(body), {});
    const second = await POST(request(body), {});

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Idempotency-Hit")).toBe("true");
    const [firstBody, secondBody] = [await first.json(), await second.json()];
    expect(secondBody).toEqual({ ...firstBody, replayed: true });
    expect(mocks.state.items).toHaveLength(3);
    expect(mocks.state.batches).toHaveLength(1);
    expect(mocks.recordCanvasItemEventsBatch).toHaveBeenCalledTimes(1);
    // A replay enqueues no second set of enrichment jobs.
    expect(mocks.enqueueLinkEnrichment).toHaveBeenCalledTimes(1);
  });

  it("refuses to reuse an idempotency key for a different batch", async () => {
    await POST(
      request({ idempotencyKey: "batch-reuse-1", links: links(1) }),
      {},
    );
    const response = await POST(
      request({ idempotencyKey: "batch-reuse-1", links: links(2) }),
      {},
    );
    expect(response.status).toBe(409);
    expect(mocks.state.items).toHaveLength(1);
  });

  it("creates nothing when the Inbox has no room for every link", async () => {
    mocks.state.canvases.push({ id: "inbox-1", userId: "u1", name: "Inbox" });
    mocks.state.liveItems = LAUNCH_LIMITS.itemsPerCanvas - 2;
    const response = await POST(
      request({ idempotencyKey: "batch-full-1", links: links(3) }),
      {},
    );
    expect(response.status).toBe(422);
    expect(mocks.state.items).toHaveLength(0);
    expect(mocks.state.batches).toHaveLength(0);

    // The rejected key is not burned: the same batch succeeds once there is room.
    mocks.state.liveItems = 0;
    const retry = await POST(
      request({ idempotencyKey: "batch-full-1", links: links(3) }),
      {},
    );
    expect(retry.status).toBe(201);
  });

  describe("duplicates (IMP-065)", () => {
    const saved = {
      id: "old-1",
      canvasId: "board-1",
      canvasName: "Reading",
      url: "https://Example.com/page-1/?utm_source=newsletter",
      title: "Page 1, saved last week",
    };

    it("saves every link by default and reports the ones already saved", async () => {
      mocks.state.existing = [saved];
      const response = await POST(
        request({ idempotencyKey: "batch-dup-1", links: links(3) }),
        {},
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.itemIds).toHaveLength(3);
      expect(body.duplicates).toEqual([
        {
          index: 1,
          url: "https://example.com/page-1",
          savedItemId: body.itemIds[1],
          existing: [
            expect.objectContaining({
              itemId: "old-1",
              canvasName: "Reading",
              path: "/canvas/board-1?item=old-1",
            }),
          ],
        },
      ]);
      expect(mocks.state.items[1]).toMatchObject({
        normalizedUrl: "https://example.com/page-1",
      });
    });

    it("leaves out links that are already saved when asked to", async () => {
      mocks.state.existing = [saved];
      const body = {
        idempotencyKey: "batch-dup-2",
        links: links(3),
        skipDuplicates: true,
      };
      const first = await POST(request(body), {});
      expect(first.status).toBe(201);
      const firstBody = await first.json();
      expect(firstBody.itemIds).toHaveLength(2);
      expect(mocks.state.items).toHaveLength(2);
      expect(firstBody.duplicates).toEqual([
        expect.objectContaining({ index: 1, savedItemId: null }),
      ]);
      // Batch positions keep the request order, so a replay can tell which
      // link was skipped.
      expect(mocks.state.batches[0]!.items.map((i) => i.position)).toEqual([
        0, 2,
      ]);
      const [, , targets] = mocks.enqueueLinkEnrichment.mock
        .calls[0] as unknown as [unknown, string, Array<{ baseTitle: string }>];
      expect(targets.map((target) => target.baseTitle)).toEqual([
        "Page 0",
        "Page 2",
      ]);

      const replay = await POST(request(body), {});
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ ...firstBody, replayed: true });
    });

    it("treats skipDuplicates as part of what the idempotency key covers", async () => {
      await POST(
        request({ idempotencyKey: "batch-dup-3", links: links(1) }),
        {},
      );
      const response = await POST(
        request({
          idempotencyKey: "batch-dup-3",
          links: links(1),
          skipDuplicates: true,
        }),
        {},
      );
      expect(response.status).toBe(409);
    });
  });
});
