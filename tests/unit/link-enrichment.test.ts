import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxJob, PrismaClient } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  recordEvent: vi.fn(),
  invalidate: vi.fn(),
  findAiProvider: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: mocks.recordEvent,
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: mocks.invalidate,
}));
vi.mock("@/lib/ai/provider-resolution", () => ({
  findAiProvider: mocks.findAiProvider,
}));
vi.mock("@/lib/ai/service", () => ({ generateText: mocks.generateText }));

import {
  createLinkEnrichmentHandler,
  enqueueLinkEnrichment,
  planLinkEnrichment,
  type EnrichmentBase,
} from "@/lib/services/link-enrichment";
import {
  buildLinkPrompt,
  parseLinkSuggestion,
  suggestLinkDetails,
  truncateUtf8,
} from "@/lib/ai/enrich-link";
import { resetAiBudgetForTests } from "@/lib/ai/budget";
import { AiBudgetError, AiBudgetStoreError } from "@/lib/ai/errors";
import { extractPageText } from "@/lib/services/link-page";

const URL_ = "https://example.com/post";
const base: EnrichmentBase = {
  baseTitle: "Tab title",
  baseTags: [],
  titleLocked: false,
  filledTitle: null,
  filledTags: [],
};
const metadata = {
  title: "Page title",
  description: "Page description",
  favicon: "https://example.com/favicon.ico",
  siteName: "Example",
};
const ai = {
  ok: true as const,
  suggestion: {
    title: "A clear title",
    tags: ["cooking", "recipes"],
    summary: "What it is. Why it helps.",
  },
};

describe("planLinkEnrichment", () => {
  it("writes the AI title, tags and summary on an untouched link", () => {
    const plan = planLinkEnrichment({
      content: { url: URL_, title: "Tab title" },
      tags: [],
      enrichment: base,
      metadata,
      ai,
    });
    expect(plan.content).toMatchObject({
      title: "A clear title",
      description: "Page description",
      summary: "What it is. Why it helps.",
      favicon: metadata.favicon,
      siteName: "Example",
    });
    expect(plan.tags).toEqual(["cooking", "recipes"]);
    expect(plan.filledFields).toEqual(
      expect.arrayContaining(["title", "description", "summary", "tags"]),
    );
    expect(plan.filledTitle).toBe("A clear title");
    expect(plan.filledTags).toEqual(["cooking", "recipes"]);
    expect(plan.aiSkipReason).toBeNull();
  });

  it("keeps only the unfurled title and description without AI", () => {
    const plan = planLinkEnrichment({
      content: { url: URL_, title: URL_ },
      tags: [],
      enrichment: { ...base, baseTitle: URL_ },
      metadata,
      ai: { ok: false, reason: "not-configured" },
    });
    expect(plan.content.title).toBe("Page title");
    expect(plan.content.description).toBe("Page description");
    expect(plan.content.summary).toBeUndefined();
    expect(plan.tags).toEqual([]);
    expect(plan.filledFields).not.toContain("tags");
    expect(plan.aiSkipReason).toBe("not-configured");
  });

  it("never replaces a title or tags the user edited", () => {
    const plan = planLinkEnrichment({
      content: { url: URL_, title: "My own name", description: "My clip" },
      tags: ["mine"],
      enrichment: base,
      metadata,
      ai,
    });
    expect(plan.content.title).toBe("My own name");
    expect(plan.content.description).toBe("My clip");
    expect(plan.tags).toEqual(["mine"]);
    expect(plan.filledFields).not.toContain("title");
    expect(plan.filledFields).not.toContain("tags");
    expect(plan.filledFields).not.toContain("description");
  });

  it("keeps a locked title and adds to the tags the link was saved with", () => {
    const plan = planLinkEnrichment({
      content: { url: URL_, title: "Agent title" },
      tags: ["agent"],
      enrichment: {
        ...base,
        baseTitle: "Agent title",
        baseTags: ["agent"],
        titleLocked: true,
      },
      metadata,
      ai: {
        ok: true,
        suggestion: { ...ai.suggestion, tags: ["Agent", "recipes"] },
      },
    });
    expect(plan.content.title).toBe("Agent title");
    expect(plan.tags).toEqual(["agent", "recipes"]);
    expect(plan.filledTags).toEqual(["recipes"]);
  });

  it("is a no-op when run again over its own output", () => {
    const first = planLinkEnrichment({
      content: { url: URL_, title: "Tab title" },
      tags: [],
      enrichment: base,
      metadata,
      ai,
    });
    const second = planLinkEnrichment({
      content: first.content,
      tags: first.tags,
      enrichment: {
        ...base,
        filledTitle: first.filledTitle,
        filledTags: first.filledTags,
      },
      metadata,
      ai,
    });
    expect(second.changed).toBe(false);
    expect(second.content).toEqual(first.content);
    expect(second.tags).toEqual(first.tags);
  });
});

describe("link AI prompt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("caps the whole prompt, page text included, at AI_MAX_PROMPT_BYTES", () => {
    vi.stubEnv("AI_MAX_PROMPT_BYTES", "2048");
    const prompt = buildLinkPrompt({
      url: URL_,
      title: "Title",
      pageText: "é".repeat(50_000),
    });
    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(2048);
    expect(prompt).toContain(`URL: ${URL_}`);
    expect(prompt).not.toContain("�");
  });

  it("truncates on character boundaries", () => {
    expect(truncateUtf8("aé", 2)).toBe("a");
    expect(truncateUtf8("abc", 10)).toBe("abc");
  });

  it("reads the model's JSON and cleans tags", () => {
    expect(
      parseLinkSuggestion(
        '```json\n{"title":" Hi ","tags":["#Food","food"," Long  Tag "],"summary":"S"}\n```',
      ),
    ).toEqual({ title: "Hi", tags: ["food", "long tag"], summary: "S" });
    expect(parseLinkSuggestion("not json")).toBeNull();
  });

  it("extracts readable page text without scripts", () => {
    expect(
      extractPageText(
        "<html><body><nav>Menu</nav><script>x()</script><main><p>Hello</p>  <p>world</p></main></body></html>",
      ),
    ).toBe("Hello world");
  });
});

describe("suggestLinkDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiBudgetForTests();
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("AI_ENABLED", "true");
    mocks.findAiProvider.mockResolvedValue({ provider: "OPENAI" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAiBudgetForTests();
  });

  it("skips quietly when AI is not configured", async () => {
    mocks.findAiProvider.mockResolvedValue(null);
    await expect(
      suggestLinkDetails({ userId: "u1", url: URL_ }),
    ).resolves.toEqual({ ok: false, reason: "not-configured" });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("skips quietly when the daily AI budget is spent", async () => {
    vi.stubEnv("AI_DAILY_TOKEN_BUDGET", "10");
    await expect(
      suggestLinkDetails({ userId: "u1", url: URL_ }),
    ).resolves.toEqual({ ok: false, reason: "budget" });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rethrows a busy AI slot so the job retries", async () => {
    vi.stubEnv("AI_MAX_CONCURRENT_PER_USER", "1");
    let release!: () => void;
    mocks.generateText.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('{"title":"T","tags":[],"summary":"S"}');
        }),
    );
    const first = suggestLinkDetails({ userId: "u1", url: URL_ });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalled());
    const second = suggestLinkDetails({ userId: "u1", url: URL_ });
    await expect(second).rejects.toMatchObject({
      extensions: expect.objectContaining({ code: "AI_CONCURRENCY_BUDGET" }),
    });
    release();
    await first;
  });

  it("returns the parsed suggestion within budget", async () => {
    mocks.generateText.mockResolvedValue(
      '{"title":"T","tags":["a"],"summary":"S"}',
    );
    await expect(
      suggestLinkDetails({ userId: "u1", url: URL_, pageText: "Body" }),
    ).resolves.toEqual({
      ok: true,
      suggestion: { title: "T", tags: ["a"], summary: "S" },
    });
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", maxTokens: 300 }),
    );
  });
});

type Row = EnrichmentBase & {
  itemId: string;
  userId: string;
  status: "PENDING" | "DONE" | "SKIPPED";
  filledFields: string[];
  aiSkipReason: string | null;
  similarItemIds?: string[];
};

function fakeDb(options: { autoEnrichLinks?: boolean } = {}) {
  const state = {
    user: { autoEnrichLinks: options.autoEnrichLinks ?? true },
    row: {
      itemId: "item-1",
      userId: "u1",
      status: "PENDING",
      ...base,
      filledFields: [],
      aiSkipReason: null,
    } as Row,
    item: {
      id: "item-1",
      canvasId: "canvas-1",
      type: "BOOKMARK",
      version: 1,
      deletedAt: null,
      content: { url: URL_, title: "Tab title" } as Record<string, unknown>,
      tags: [] as string[],
      normalizedUrl: null as string | null,
      createdById: "u1",
      updatedById: null,
    },
    outbox: [] as Array<Record<string, unknown>>,
  };
  const client = {
    $queryRaw: vi.fn(async () => [{ id: "canvas-1" }]),
    user: { findUnique: vi.fn(async () => state.user) },
    itemEnrichment: {
      findUnique: vi.fn(async () => ({ ...state.row })),
      createMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        Object.assign(state.row, data);
        return state.row;
      }),
      updateMany: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        if (state.row.status !== "PENDING") return { count: 0 };
        Object.assign(state.row, data);
        return { count: 1 };
      }),
    },
    outboxJob: {
      createMany: vi.fn(
        async ({ data }: { data: Array<Record<string, unknown>> }) => {
          state.outbox.push(...data);
          return { count: data.length };
        },
      ),
    },
    itemEmbedding: {
      upsert: vi.fn(async () => ({})),
      findMany: vi.fn(async () => [] as Array<Record<string, unknown>>),
    },
    canvasItem: {
      findFirst: vi.fn(async () =>
        state.item.deletedAt ? null : { ...state.item },
      ),
      // Similar-link candidates are other live items in these fixtures.
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id })),
      ),
      update: vi.fn(async ({ data }: { data: { normalizedUrl: string } }) => {
        Object.assign(state.item, data);
        return state.item;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { version: number };
          data: { content: Record<string, unknown>; tags: string[] };
        }) => {
          if (where.version !== state.item.version) return { count: 0 };
          state.item.content = data.content;
          state.item.tags = data.tags;
          state.item.version += 1;
          return { count: 1 };
        },
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(client),
    ),
  };
  return { state, client: client as unknown as PrismaClient, raw: client };
}

function job(overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    id: "job-1",
    type: "link.enrich",
    payload: { itemId: "item-1" },
    attempts: 1,
    maxAttempts: 4,
    ...overrides,
  } as OutboxJob;
}

const noEmbedding = vi.fn(async () => ({
  ok: false as const,
  reason: "not-configured" as const,
}));

const page = {
  ok: true as const,
  html: "<html><body><main>Recipe body</main></body></html>",
  metadata,
};

describe("link enrichment outbox job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues one keyed job per link and nothing when turned off", async () => {
    const on = fakeDb();
    await expect(
      enqueueLinkEnrichment(on.client, "u1", [
        { itemId: "a", baseTitle: "A" },
        { itemId: "b" },
      ]),
    ).resolves.toBe(2);
    expect(on.state.outbox).toEqual([
      expect.objectContaining({
        type: "link.enrich",
        payload: { itemId: "a" },
        dedupeKey: "link.enrich:a",
      }),
      expect.objectContaining({ dedupeKey: "link.enrich:b" }),
    ]);
    expect(on.raw.itemEnrichment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );

    const off = fakeDb({ autoEnrichLinks: false });
    await expect(
      enqueueLinkEnrichment(off.client, "u1", [{ itemId: "a" }]),
    ).resolves.toBe(0);
    expect(off.state.outbox).toHaveLength(0);
  });

  it("unfurls, applies the AI suggestion and records what it filled", async () => {
    const db = fakeDb();
    const suggest = vi.fn().mockResolvedValue(ai);
    const fetchPage = vi.fn().mockResolvedValue(page);
    await createLinkEnrichmentHandler(db.client, {
      fetchPage,
      suggest,
      embed: noEmbedding,
    })(job());

    expect(fetchPage).toHaveBeenCalledWith(URL_, { signal: undefined });
    expect(suggest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", pageText: "Recipe body" }),
    );
    expect(db.state.item.content).toMatchObject({
      title: "A clear title",
      summary: "What it is. Why it helps.",
    });
    expect(db.state.item.tags).toEqual(["cooking", "recipes"]);
    expect(db.state.row).toMatchObject({
      status: "DONE",
      filledTitle: "A clear title",
      filledTags: ["cooking", "recipes"],
      aiSkipReason: null,
    });
    expect(db.state.row.filledFields).toEqual(
      expect.arrayContaining(["title", "tags", "summary"]),
    );
    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).toHaveBeenCalledWith("canvas-1");
  });

  it("is safe to run twice", async () => {
    const db = fakeDb();
    const suggest = vi.fn().mockResolvedValue(ai);
    const fetchPage = vi.fn().mockResolvedValue(page);
    const handler = createLinkEnrichmentHandler(db.client, {
      embed: noEmbedding,
      fetchPage,
      suggest,
    });
    await handler(job());
    const after = { ...db.state.item };
    await handler(job());
    expect(db.state.item).toEqual(after);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps a title and tags the user edited while the job ran", async () => {
    const db = fakeDb();
    const suggest = vi.fn().mockImplementation(async () => {
      db.state.item.content = { url: URL_, title: "Renamed by me" };
      db.state.item.tags = ["mine"];
      db.state.item.version = 2;
      return ai;
    });
    await createLinkEnrichmentHandler(db.client, {
      embed: noEmbedding,
      fetchPage: vi.fn().mockResolvedValue(page),
      suggest,
    })(job());
    expect(db.state.item.content).toMatchObject({ title: "Renamed by me" });
    expect(db.state.item.tags).toEqual(["mine"]);
    expect(db.state.row.filledFields).not.toContain("title");
    expect(db.state.row.filledFields).not.toContain("tags");
  });

  it("records a spent budget and keeps the unfurled metadata", async () => {
    const db = fakeDb();
    await createLinkEnrichmentHandler(db.client, {
      embed: noEmbedding,
      fetchPage: vi.fn().mockResolvedValue(page),
      suggest: vi.fn().mockResolvedValue({ ok: false, reason: "budget" }),
    })(job());
    expect(db.state.item.content).toMatchObject({
      title: "Page title",
      description: "Page description",
    });
    expect(db.state.item.tags).toEqual([]);
    expect(db.state.row).toMatchObject({
      status: "DONE",
      aiSkipReason: "budget",
    });
  });

  it("keeps the link PENDING and retries while the AI is busy or the budget store is down", async () => {
    for (const error of [
      new AiBudgetError(
        "AI_CONCURRENCY_BUDGET",
        "Too many AI requests at once.",
        1,
      ),
      new AiBudgetStoreError(),
    ]) {
      const db = fakeDb();
      const embed = vi.fn();
      const handler = createLinkEnrichmentHandler(db.client, {
        embed,
        fetchPage: vi.fn().mockResolvedValue(page),
        suggest: vi.fn().mockRejectedValue(error),
      });
      await expect(handler(job({ attempts: 1 }))).rejects.toBe(error);
      expect((error as { retryable?: boolean }).retryable).not.toBe(false);
      expect(db.state.row.status).toBe("PENDING");
      expect(embed).not.toHaveBeenCalled();

      // On the last attempt the link is finished as a spent budget.
      await handler(job({ attempts: 4 }));
      expect(db.state.row).toMatchObject({
        status: "DONE",
        aiSkipReason: "budget",
      });
    }
  });

  it("retries a failed page fetch, then enriches from the saved title", async () => {
    const db = fakeDb();
    const fetchPage = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, error: "down" });
    const suggest = vi.fn().mockResolvedValue({
      ok: false,
      reason: "not-configured",
    });
    const handler = createLinkEnrichmentHandler(db.client, {
      embed: noEmbedding,
      fetchPage,
      suggest,
    });
    await expect(handler(job({ attempts: 1 }))).rejects.toThrow(/fetch/);
    expect(db.state.row.status).toBe("PENDING");

    await handler(job({ attempts: 4 }));
    expect(suggest).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Tab title", pageText: "" }),
    );
    expect(db.state.row.status).toBe("DONE");
    expect(db.state.item.content).toEqual({ url: URL_, title: "Tab title" });
  });

  it("does nothing once the user turned enrichment off", async () => {
    const db = fakeDb({ autoEnrichLinks: false });
    const fetchPage = vi.fn();
    await createLinkEnrichmentHandler(db.client, {
      fetchPage,
      embed: noEmbedding,
    })(job());
    expect(fetchPage).not.toHaveBeenCalled();
    expect(db.state.row.status).toBe("SKIPPED");
  });

  it("hands the finished link to a follow-up hook in the same transaction", async () => {
    const db = fakeDb();
    const afterEnriched = vi.fn();
    await createLinkEnrichmentHandler(db.client, {
      embed: noEmbedding,
      fetchPage: vi.fn().mockResolvedValue(page),
      suggest: vi.fn().mockResolvedValue(ai),
      afterEnriched,
    })(job());
    expect(afterEnriched).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({
        itemId: "item-1",
        canvasId: "canvas-1",
        userId: "u1",
        tags: ["cooking", "recipes"],
        summary: "What it is. Why it helps.",
      }),
    );
  });

  it("stores the embedding and flags links that look like the same page", async () => {
    const db = fakeDb();
    db.raw.itemEmbedding.findMany.mockResolvedValue([
      { itemId: "twin", vector: [1, 0.01] },
      { itemId: "other", vector: [0, 1] },
    ]);
    const embed = vi.fn(async () => ({
      ok: true as const,
      provider: "OPENAI",
      model: "text-embedding-3-small",
      vector: [1, 0],
    }));
    await createLinkEnrichmentHandler(db.client, {
      fetchPage: vi.fn().mockResolvedValue(page),
      suggest: vi.fn().mockResolvedValue(ai),
      embed,
    })(job());

    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        text: `A clear title\nWhat it is. Why it helps.\n${URL_}`,
      }),
    );
    expect(db.raw.itemEmbedding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          itemId: "item-1",
          provider: "OPENAI",
          model: "text-embedding-3-small",
          vector: [1, 0],
        }),
      }),
    );
    expect(db.state.row.similarItemIds).toEqual(["twin"]);
    expect(db.state.row.filledFields).toContain("embedding");
    expect(db.state.item.normalizedUrl).toBe(URL_);
  });

  it("does not embed when the AI budget is spent", async () => {
    const db = fakeDb();
    const embed = vi.fn();
    await createLinkEnrichmentHandler(db.client, {
      fetchPage: vi.fn().mockResolvedValue(page),
      suggest: vi.fn().mockResolvedValue({ ok: false, reason: "budget" }),
      embed,
    })(job());
    expect(embed).not.toHaveBeenCalled();
    expect(db.raw.itemEmbedding.upsert).not.toHaveBeenCalled();
  });

  it("scores similar links before taking the canvas lock and drops deleted candidates", async () => {
    const db = fakeDb();
    const events: string[] = [];
    let locked = false;
    db.raw.$queryRaw.mockImplementation(async () => {
      locked = true;
      events.push("lock");
      return [{ id: "canvas-1" }];
    });
    const transaction = db.raw.$transaction.getMockImplementation()!;
    db.raw.$transaction.mockImplementation(async (callback, ...rest) => {
      try {
        return await transaction(callback, ...rest);
      } finally {
        locked = false;
      }
    });
    db.raw.itemEmbedding.findMany.mockImplementation(async () => {
      events.push(locked ? "scan-under-lock" : "scan");
      return [
        { itemId: "live", vector: [1, 0] },
        { itemId: "deleted", vector: [1, 0] },
      ];
    });
    db.raw.canvasItem.findMany.mockImplementation(async ({ where }) =>
      where.id.in.filter((id) => id !== "deleted").map((id) => ({ id })),
    );
    await createLinkEnrichmentHandler(db.client, {
      fetchPage: vi.fn().mockResolvedValue(page),
      suggest: vi.fn().mockResolvedValue(ai),
      embed: vi.fn(async () => ({
        ok: true as const,
        provider: "openai",
        model: "text-embedding-3-small",
        vector: [1, 0],
      })),
    })(job());

    expect(events).toEqual(["scan", "lock"]);
    expect(db.state.row).toMatchObject({
      status: "DONE",
      similarItemIds: ["live"],
    });
    expect(db.raw.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxWait: expect.any(Number),
        timeout: expect.any(Number),
      }),
    );
  });

  it("does not apply the old page's results after the URL changed, and re-enqueues", async () => {
    const db = fakeDb();
    const NEW_URL = "https://example.org/other";
    const suggest = vi.fn().mockImplementation(async () => {
      db.state.item.content = { url: NEW_URL, title: "Tab title" };
      db.state.item.version = 2;
      return ai;
    });
    await createLinkEnrichmentHandler(db.client, {
      fetchPage: vi.fn().mockResolvedValue(page),
      suggest,
      embed: vi.fn(async () => ({
        ok: true as const,
        provider: "OPENAI",
        model: "text-embedding-3-small",
        vector: [1, 0],
      })),
    })(job());

    expect(db.state.item.content).toEqual({ url: NEW_URL, title: "Tab title" });
    expect(db.state.item.tags).toEqual([]);
    expect(db.state.item.version).toBe(2);
    expect(db.raw.itemEmbedding.upsert).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
    expect(db.state.row.status).toBe("PENDING");
    expect(db.state.outbox).toEqual([
      expect.objectContaining({
        type: "link.enrich",
        payload: { itemId: "item-1" },
        dedupeKey: "link.enrich:item-1:v2",
      }),
    ]);
  });
});
