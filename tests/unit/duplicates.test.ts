import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  cosineSimilarity,
  existingFor,
  findExistingLinks,
  findSimilarLinks,
  normalizeLinkUrl,
} from "@/lib/services/duplicates";
import {
  alreadySavedLinks,
  buildBatchBody,
  existingLinkUrl,
  sendBatch,
} from "../../integrations/browser-extension/lib.js";

describe("normalizeLinkUrl", () => {
  it.each([
    ["https://Example.COM/Post", "https://example.com/Post"],
    ["https://example.com/post/", "https://example.com/post"],
    ["https://example.com/", "https://example.com"],
    ["https://example.com/post#section-2", "https://example.com/post"],
    ["https://example.com:443/post", "https://example.com/post"],
    [
      "https://example.com/post?utm_source=x&utm_medium=y&id=7",
      "https://example.com/post?id=7",
    ],
    [
      "https://example.com/post?fbclid=1&gclid=2&b=2&a=1",
      "https://example.com/post?a=1&b=2",
    ],
    ["https://example.com/post?UTM_Campaign=z", "https://example.com/post"],
  ])("%s -> %s", (raw, normalized) => {
    expect(normalizeLinkUrl(raw)).toBe(normalized);
  });

  it("keeps parameters that change the page and the scheme", () => {
    expect(normalizeLinkUrl("https://youtube.com/watch?v=abc")).toBe(
      "https://youtube.com/watch?v=abc",
    );
    expect(normalizeLinkUrl("http://example.com/a")).not.toBe(
      normalizeLinkUrl("https://example.com/a"),
    );
  });

  it("rejects anything that is not a web link", () => {
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("not a url")).toBeNull();
  });
});

describe("findExistingLinks", () => {
  it("returns only candidates whose saved URL normalizes to the same key", async () => {
    const queryRaw = vi.fn(async () => [
      {
        id: "i1",
        canvasId: "c1",
        canvasName: "Inbox",
        url: "https://EXAMPLE.com/post/?utm_source=rss",
        title: "Post",
      },
      {
        id: "i2",
        canvasId: "c1",
        canvasName: "Inbox",
        url: "https://example.com/post/comments",
        title: "Comments",
      },
    ]);
    const db = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const found = await findExistingLinks(db, "u1", [
      "https://example.com/post#top",
    ]);
    expect(existingFor(found, "https://example.com/post")).toEqual([
      {
        itemId: "i1",
        canvasId: "c1",
        canvasName: "Inbox",
        title: "Post",
        url: "https://EXAMPLE.com/post/?utm_source=rss",
        path: "/canvas/c1?item=i1",
      },
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not query for links that cannot be normalized", async () => {
    const queryRaw = vi.fn();
    const db = { $queryRaw: queryRaw } as unknown as PrismaClient;
    await expect(findExistingLinks(db, "u1", ["ftp://x"])).resolves.toEqual(
      new Map(),
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("near-duplicates", () => {
  it("scores vectors by cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });

  it("flags only close links of the same user, best first", async () => {
    const findMany = vi.fn(async () => [
      { itemId: "far", vector: [0, 1] },
      { itemId: "close", vector: [0.99, 0.05] },
      { itemId: "same", vector: [1, 0] },
    ]);
    const db = { itemEmbedding: { findMany } } as unknown as PrismaClient;
    const similar = await findSimilarLinks(db, {
      userId: "u1",
      itemId: "new",
      provider: "OPENAI",
      model: "text-embedding-3-small",
      vector: [1, 0],
    });
    expect(similar.map((entry) => entry.itemId)).toEqual(["same", "close"]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          itemId: { not: "new" },
          item: { deletedAt: null, canvas: { userId: "u1" } },
        }),
      }),
    );
  });
});

describe("browser extension duplicates", () => {
  const duplicateBody = {
    batchId: "b1",
    canvasId: "c1",
    itemIds: ["i2"],
    duplicates: [
      {
        index: 0,
        url: "https://a.example",
        savedItemId: null,
        existing: [
          {
            itemId: "old",
            canvasId: "c9",
            canvasName: "Reading",
            title: "A",
            url: "https://a.example/",
            path: "/canvas/c9?item=old",
          },
        ],
      },
    ],
  };

  it("asks the server to skip links that are already saved", () => {
    expect(
      buildBatchBody([{ url: "https://a.example" }], "", "key-12345678"),
    ).toMatchObject({ skipDuplicates: true });
  });

  it("confirms a batch where some tabs were already saved", async () => {
    const tabs = [{ url: "https://a.example" }, { url: "https://b.example" }];
    const fetchImpl = vi.fn(async () =>
      Response.json(duplicateBody, { status: 201 }),
    );
    const body = await sendBatch({
      serverUrl: "https://m.example",
      apiKey: "mk_x",
      tabs,
      idempotencyKey: "key-12345678",
      fetchImpl,
    });
    expect(alreadySavedLinks(body)).toHaveLength(1);
    expect(
      existingLinkUrl(
        "https://m.example/",
        duplicateBody.duplicates[0]!.existing[0],
      ),
    ).toBe("https://m.example/canvas/c9?item=old");
    expect(
      existingLinkUrl("https://m.example", { path: "https://evil" }),
    ).toBeNull();
  });
});
