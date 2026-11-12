import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OutboxJob } from "@/lib/outbox/types";
import {
  PAGE_COPY_BACKFILL_PAGE,
  createPageCopyBackfillHandler,
  createPageCopyHandler,
  findArchiveCopy,
  trimToBytes,
} from "@/lib/services/page-copy";

const URL_ = "https://news.example/story";

describe("trimToBytes", () => {
  it("cuts at a character boundary", () => {
    expect(trimToBytes("abc", 10)).toBe("abc");
    // "é" is two bytes: cutting inside it drops the whole character.
    expect(trimToBytes("aé", 2)).toBe("a");
    expect(Buffer.byteLength(trimToBytes("😀😀", 5))).toBe(4);
  });
});

describe("findArchiveCopy", () => {
  it("never sends an address the SSRF check refuses", async () => {
    const fetchImpl = vi.fn();
    await expect(
      findArchiveCopy("http://127.0.0.1/admin", { fetchImpl }),
    ).resolves.toBeNull();
    await expect(
      findArchiveCopy("https://user:pw@news.example/", { fetchImpl }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the newest archive.org copy, over https", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      data: JSON.stringify({
        archived_snapshots: {
          closest: {
            available: true,
            status: "200",
            url: "http://web.archive.org/web/20250101000000/https://93.184.215.14/",
          },
        },
      }),
    }));
    await expect(
      findArchiveCopy("https://93.184.215.14/", { fetchImpl }),
    ).resolves.toBe(
      "https://web.archive.org/web/20250101000000/https://93.184.215.14/",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://archive.org/wayback/available?url=https%3A%2F%2F93.184.215.14%2F",
      expect.objectContaining({ maxSize: 64 * 1024 }),
    );
  });

  it("ignores answers that are missing, broken or point elsewhere", async () => {
    const answer = (data: string) =>
      vi.fn(async () => ({ ok: true, status: 200, data }));
    const url = "https://93.184.215.14/";
    await expect(
      findArchiveCopy(url, { fetchImpl: answer('{"archived_snapshots":{}}') }),
    ).resolves.toBeNull();
    await expect(
      findArchiveCopy(url, { fetchImpl: answer("not json") }),
    ).resolves.toBeNull();
    await expect(
      findArchiveCopy(url, {
        fetchImpl: answer(
          JSON.stringify({
            archived_snapshots: {
              closest: { available: true, url: "https://evil.example/x" },
            },
          }),
        ),
      }),
    ).resolves.toBeNull();
  });
});

function job(overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    id: "job-1",
    type: "link.page-copy",
    payload: { itemId: "item-1" },
    attempts: 1,
    maxAttempts: 4,
    ...overrides,
  } as OutboxJob;
}

function fakeDb(
  options: {
    user?: { autoEnrichLinks: boolean; webArchiveLookup: boolean };
    existing?: Record<string, unknown> | null;
    liveUrl?: string;
  } = {},
) {
  const state = {
    copy: (options.existing ?? null) as Record<string, unknown> | null,
    outbox: [] as Array<Record<string, unknown>>,
  };
  const client = {
    $queryRaw: vi.fn(async () => [{ locked: 1 }]),
    canvasItem: {
      findFirst: vi.fn(
        async ({ select }: { select: Record<string, unknown> }) =>
          select.canvas
            ? { content: { url: URL_ }, canvas: { userId: "u1" } }
            : { content: { url: options.liveUrl ?? URL_ } },
      ),
      findMany: vi.fn(async () => [] as Array<{ id: string }>),
    },
    user: {
      findUnique: vi.fn(
        async () =>
          options.user ?? { autoEnrichLinks: true, webArchiveLookup: false },
      ),
    },
    itemPageCopy: {
      findUnique: vi.fn(async () => state.copy),
      aggregate: vi.fn(async () => ({ _sum: { textBytes: 0 } })),
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          state.copy = state.copy
            ? { ...state.copy, ...update }
            : { ...create };
          return state.copy;
        },
      ),
    },
    outboxJob: {
      createMany: vi.fn(
        async ({ data }: { data: Array<Record<string, unknown>> }) => {
          state.outbox.push(...data);
          return { count: data.length };
        },
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(client),
    ),
  };
  return { state, raw: client, client: client as unknown as PrismaClient };
}

const page = {
  ok: true as const,
  html: "<html><body><article>Only in the page body</article></body></html>",
  metadata: {},
};

describe("link.page-copy job", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the page text of a link saved earlier, and is safe to run twice", async () => {
    const db = fakeDb();
    const fetchPage = vi.fn().mockResolvedValue(page);
    const handler = createPageCopyHandler(db.client, { fetchPage });
    await handler(job());
    expect(db.state.copy).toMatchObject({
      itemId: "item-1",
      url: URL_,
      text: "Only in the page body",
      readAt: expect.any(Date),
    });
    await handler(job());
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("retries a page that does not load, and keeps nothing on the last try", async () => {
    const db = fakeDb();
    const fetchPage = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, error: "HTTP 503" });
    const handler = createPageCopyHandler(db.client, { fetchPage });
    await expect(handler(job())).rejects.toThrow(/status 503/);
    await handler(job({ attempts: 4 }));
    expect(db.state.copy).toBeNull();
  });

  it("reads nothing when the person turned link reading off", async () => {
    const db = fakeDb({
      user: { autoEnrichLinks: false, webArchiveLookup: true },
    });
    const fetchPage = vi.fn();
    await createPageCopyHandler(db.client, { fetchPage })(job());
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("writes nothing when the link changed while it was read", async () => {
    const db = fakeDb({ liveUrl: "https://other.example/" });
    await createPageCopyHandler(db.client, {
      fetchPage: vi.fn().mockResolvedValue(page),
    })(job());
    expect(db.raw.itemPageCopy.upsert).not.toHaveBeenCalled();
  });

  it("looks the link up in the web archive only when the deployment and the person allow it", async () => {
    const findArchive = vi
      .fn()
      .mockResolvedValue("https://web.archive.org/web/1/x");
    const off = fakeDb({
      user: { autoEnrichLinks: true, webArchiveLookup: true },
    });
    await createPageCopyHandler(off.client, {
      fetchPage: vi.fn().mockResolvedValue(page),
      findArchive,
    })(job());
    expect(findArchive).not.toHaveBeenCalled();

    vi.stubEnv("WEB_ARCHIVE_LOOKUP", "true");
    const notOptedIn = fakeDb();
    await createPageCopyHandler(notOptedIn.client, {
      fetchPage: vi.fn().mockResolvedValue(page),
      findArchive,
    })(job());
    expect(findArchive).not.toHaveBeenCalled();

    // A dead link still gets its archive link.
    const on = fakeDb({
      user: { autoEnrichLinks: true, webArchiveLookup: true },
    });
    await createPageCopyHandler(on.client, {
      fetchPage: vi
        .fn()
        .mockResolvedValue({ ok: false, status: 404, error: "HTTP 404" }),
      findArchive,
    })(job({ attempts: 4 }));
    expect(on.state.copy).toMatchObject({
      text: "",
      textBytes: 0,
      archiveUrl: "https://web.archive.org/web/1/x",
      archiveCheckedAt: expect.any(Date),
    });
  });

  it("keeps no text once the account budget is full", async () => {
    const db = fakeDb();
    db.raw.itemPageCopy.aggregate.mockResolvedValue({
      _sum: { textBytes: 64 * 1024 * 1024 },
    });
    await createPageCopyHandler(db.client, {
      fetchPage: vi.fn().mockResolvedValue(page),
    })(job());
    expect(db.state.copy).toBeNull();
  });
});

describe("link.page-copy.backfill job", () => {
  it("hands one keyed page of older links on and chains the next page", async () => {
    const db = fakeDb();
    const ids = Array.from(
      { length: PAGE_COPY_BACKFILL_PAGE },
      (_, i) => `item-${String(i).padStart(3, "0")}`,
    );
    db.raw.canvasItem.findMany.mockResolvedValue(ids.map((id) => ({ id })));
    await createPageCopyBackfillHandler(db.client)(
      job({ type: "link.page-copy.backfill", payload: {} }),
    );
    expect(db.raw.canvasItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "BOOKMARK",
          deletedAt: null,
          pageCopy: { is: null },
          canvas: { isTemplate: false, user: { autoEnrichLinks: true } },
        }),
      }),
    );
    const copies = db.state.outbox.filter((j) => j.type === "link.page-copy");
    expect(copies).toHaveLength(PAGE_COPY_BACKFILL_PAGE);
    expect(copies[0]).toMatchObject({ dedupeKey: "link.page-copy:item-000" });
    expect(db.state.outbox.at(-1)).toMatchObject({
      type: "link.page-copy.backfill",
      payload: { after: "item-099" },
      dedupeKey: "link.page-copy.backfill:item-099",
    });
  });

  it("stops after the last page", async () => {
    const db = fakeDb();
    db.raw.canvasItem.findMany.mockResolvedValue([{ id: "last" }]);
    await createPageCopyBackfillHandler(db.client)(
      job({ type: "link.page-copy.backfill", payload: { after: "x" } }),
    );
    expect(db.state.outbox.map((j) => j.type)).toEqual(["link.page-copy"]);
  });
});
