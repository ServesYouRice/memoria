import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OutboxJob } from "@/lib/outbox/types";
import {
  VIDEO_BUDGET,
  VIDEO_TRANSCRIPT_JOB,
  createVideoTranscriptHandler,
  enqueueTranscriptFetch,
  storeTranscript,
  videoOfItem,
} from "@/lib/video/video-items";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function job(overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    id: "job-1",
    type: VIDEO_TRANSCRIPT_JOB,
    payload: { itemId: "item-1" },
    attempts: 1,
    maxAttempts: 3,
    ...overrides,
  } as OutboxJob;
}

function fakeDb(
  options: {
    url?: string;
    liveUrl?: string;
    existing?: Record<string, unknown> | null;
    autoEnrichLinks?: boolean;
    used?: number;
  } = {},
) {
  const state = {
    transcript: (options.existing ?? null) as Record<string, unknown> | null,
    outbox: [] as Array<Record<string, unknown>>,
  };
  const client = {
    $queryRaw: vi.fn(async () => [{ locked: 1 }]),
    canvasItem: {
      findFirst: vi.fn(
        async ({ select }: { select: Record<string, unknown> }) =>
          select.canvas
            ? {
                type: "BOOKMARK",
                content: { url: options.url ?? VIDEO, title: "A talk" },
                canvas: { userId: "owner" },
              }
            : { content: { url: options.liveUrl ?? options.url ?? VIDEO } },
      ),
    },
    canvas: {
      findUnique: vi.fn(async () => ({
        user: { autoEnrichLinks: options.autoEnrichLinks ?? true },
      })),
    },
    user: {
      findUnique: vi.fn(async () => ({
        autoEnrichLinks: options.autoEnrichLinks ?? true,
      })),
    },
    itemTranscript: {
      findUnique: vi.fn(async () => state.transcript),
      aggregate: vi.fn(async () => ({
        _sum: { textBytes: options.used ?? 0 },
      })),
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          state.transcript = state.transcript
            ? { ...state.transcript, ...update }
            : { ...create };
          return state.transcript;
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

const captions = {
  ok: true as const,
  text: "0:05 The quokka lives on an island.",
  language: "en",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("videoOfItem (IMP-114)", () => {
  it("is a video only for saved links and link previews to a known video", () => {
    expect(
      videoOfItem({ type: "BOOKMARK", content: { url: VIDEO, title: " T " } }),
    ).toMatchObject({ url: VIDEO, title: "T", host: "youtube.com" });
    expect(
      videoOfItem({
        type: "EMBED",
        content: { url: VIDEO, embedType: "youtube" },
      }),
    ).toMatchObject({ title: null });
    expect(videoOfItem({ type: "NOTE", content: { url: VIDEO } })).toBeNull();
    expect(
      videoOfItem({ type: "BOOKMARK", content: { url: "https://x.example" } }),
    ).toBeNull();
  });
});

describe("storeTranscript", () => {
  it("refuses a pasted transcript over the video budget, and cuts a fetched one", async () => {
    const big = "a".repeat(VIDEO_BUDGET.maxBytesPerVideo + 10);
    const pasted = fakeDb();
    await expect(
      storeTranscript(pasted.client, {
        itemId: "item-1",
        userId: "owner",
        url: VIDEO,
        text: big,
        source: "PASTED",
      }),
    ).resolves.toBe("too-large");
    expect(pasted.raw.itemTranscript.upsert).not.toHaveBeenCalled();

    const fetched = fakeDb();
    await expect(
      storeTranscript(fetched.client, {
        itemId: "item-1",
        userId: "owner",
        url: VIDEO,
        text: big,
        source: "FETCHED",
      }),
    ).resolves.toBe("stored");
    expect(fetched.state.transcript?.textBytes).toBe(
      VIDEO_BUDGET.maxBytesPerVideo,
    );
  });

  it("keeps nothing once the account budget is full", async () => {
    const db = fakeDb({ used: VIDEO_BUDGET.maxBytesPerAccount - 3 });
    await expect(
      storeTranscript(db.client, {
        itemId: "item-1",
        userId: "owner",
        url: VIDEO,
        text: "more than three bytes",
        source: "PASTED",
      }),
    ).resolves.toBe("over-budget");
    expect(db.raw.itemTranscript.upsert).not.toHaveBeenCalled();
  });
});

describe("enqueueTranscriptFetch", () => {
  const youtubeItem = {
    itemId: "item-1",
    type: "BOOKMARK",
    content: { url: VIDEO },
    canvasId: "canvas-1",
  };

  it("queues nothing while the deployment switch is off", async () => {
    const db = fakeDb();
    await expect(enqueueTranscriptFetch(db.client, youtubeItem)).resolves.toBe(
      false,
    );
    expect(db.state.outbox).toEqual([]);
    expect(db.raw.canvas.findUnique).not.toHaveBeenCalled();
  });

  it("queues one keyed job for a YouTube video when the switch is on", async () => {
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const db = fakeDb();
    await expect(enqueueTranscriptFetch(db.client, youtubeItem)).resolves.toBe(
      true,
    );
    expect(db.state.outbox).toEqual([
      expect.objectContaining({
        type: VIDEO_TRANSCRIPT_JOB,
        payload: { itemId: "item-1" },
        dedupeKey: "video.transcript:item-1:dQw4w9WgXcQ",
      }),
    ]);
  });

  it("skips other videos, other items, and owners who turned link reading off", async () => {
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const db = fakeDb();
    await enqueueTranscriptFetch(db.client, {
      ...youtubeItem,
      content: { url: "https://vimeo.com/76979871" },
    });
    await enqueueTranscriptFetch(db.client, {
      ...youtubeItem,
      type: "NOTE",
    });
    const off = fakeDb({ autoEnrichLinks: false });
    await enqueueTranscriptFetch(off.client, youtubeItem);
    expect(db.state.outbox).toEqual([]);
    expect(off.state.outbox).toEqual([]);
  });
});

describe("video.transcript job", () => {
  it("does nothing while the deployment switch is off", async () => {
    const db = fakeDb();
    const fetchCaptions = vi.fn();
    await createVideoTranscriptHandler(db.client, { fetchCaptions })(job());
    expect(fetchCaptions).not.toHaveBeenCalled();
    expect(db.state.transcript).toBeNull();
  });

  it("keeps the captions as the transcript, and is safe to run twice", async () => {
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const db = fakeDb();
    const fetchCaptions = vi.fn().mockResolvedValue(captions);
    const handler = createVideoTranscriptHandler(db.client, { fetchCaptions });
    await handler(job());
    await handler(job());
    expect(fetchCaptions).toHaveBeenCalledTimes(1);
    expect(fetchCaptions).toHaveBeenCalledWith("dQw4w9WgXcQ", {
      signal: undefined,
    });
    expect(db.state.transcript).toMatchObject({
      itemId: "item-1",
      userId: "owner",
      url: VIDEO,
      text: captions.text,
      source: "FETCHED",
      language: "en",
      fetchedAt: expect.any(Date),
    });
  });

  it("records that a video has no captions and stops", async () => {
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const db = fakeDb();
    const fetchCaptions = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "no-captions" });
    const handler = createVideoTranscriptHandler(db.client, { fetchCaptions });
    await handler(job());
    await handler(job());
    expect(fetchCaptions).toHaveBeenCalledTimes(1);
    expect(db.state.transcript).toMatchObject({
      text: "",
      source: "FETCHED",
      fetchedAt: expect.any(Date),
    });
  });

  it("retries while YouTube does not answer, then gives up quietly", async () => {
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const db = fakeDb();
    const fetchCaptions = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "unavailable", status: 503 });
    const handler = createVideoTranscriptHandler(db.client, { fetchCaptions });
    await expect(handler(job())).rejects.toThrow(/status 503/);
    await expect(handler(job({ attempts: 3 }))).resolves.toBeUndefined();
    expect(db.state.transcript).toMatchObject({ text: "" });
  });

  it("never replaces a pasted or cleared transcript", async () => {
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const db = fakeDb({
      existing: {
        itemId: "item-1",
        url: VIDEO,
        text: "Pasted words",
        source: "PASTED",
        fetchedAt: null,
      },
    });
    const fetchCaptions = vi.fn().mockResolvedValue(captions);
    await createVideoTranscriptHandler(db.client, { fetchCaptions })(job());
    expect(fetchCaptions).not.toHaveBeenCalled();
    expect(db.state.transcript?.text).toBe("Pasted words");
  });

  it("reads nothing for owners who turned link reading off, or non-YouTube videos", async () => {
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const fetchCaptions = vi.fn();
    await createVideoTranscriptHandler(
      fakeDb({ autoEnrichLinks: false }).client,
      { fetchCaptions },
    )(job());
    await createVideoTranscriptHandler(
      fakeDb({ url: "https://vimeo.com/76979871" }).client,
      { fetchCaptions },
    )(job());
    expect(fetchCaptions).not.toHaveBeenCalled();
  });

  it("writes nothing when the card changed while it was read", async () => {
    vi.stubEnv("VIDEO_TRANSCRIPT_FETCH", "true");
    const db = fakeDb({
      liveUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    });
    await createVideoTranscriptHandler(db.client, {
      fetchCaptions: vi.fn().mockResolvedValue(captions),
    })(job());
    expect(db.raw.itemTranscript.upsert).not.toHaveBeenCalled();
  });
});
