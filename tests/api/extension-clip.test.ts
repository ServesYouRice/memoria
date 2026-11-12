import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  checkApiKeyRateLimit: vi.fn(),
  enqueueLinkEnrichment: vi.fn(async () => 1),
  existing: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateApiKey: mocks.authenticateApiKey,
  checkApiKeyRateLimit: mocks.checkApiKeyRateLimit,
  getApiKeyRateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(),
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: vi.fn(),
}));
vi.mock("@/lib/policy/capacity", () => ({
  assertCanvasItemCapacity: vi.fn(),
}));
vi.mock("@/lib/services/link-enrichment", () => ({
  enqueueLinkEnrichment: mocks.enqueueLinkEnrichment,
}));
vi.mock("@/lib/db", () => {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    canvasItem: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const item = { ...data, id: `new-${mocks.created.length}`, version: 1 };
        mocks.created.push(item);
        return item;
      }),
    },
  };
  return {
    prisma: {
      // The duplicate lookup.
      $queryRaw: vi.fn(async () => mocks.existing),
      canvas: {
        findFirst: vi.fn(async () => ({ id: "inbox-1", name: "Inbox" })),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === MINE
            ? { id: MINE, userId: "u1" }
            : where.id === THEIRS
              ? { id: THEIRS, userId: "u2" }
              : null,
        ),
      },
      canvasItem: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          type: "BOOKMARK",
        })),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  };
});

const MINE = "ctrip000000000000000000b";
const THEIRS = "cother00000000000000000c";

import { POST } from "@/app/api/v1/extensions/clip/route";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { ItemType } from "@/types/canvas";

function clip(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/v1/extensions/clip", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "mk_x" },
      body: JSON.stringify(body),
    }),
    {},
  );
}

const saved = {
  id: "old-1",
  canvasId: "board-1",
  canvasName: "Reading",
  url: "https://example.com/article/",
  title: "The article",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing = [];
  mocks.created = [];
  mocks.authenticateApiKey.mockResolvedValue({
    user: { id: "u1" },
    apiKeyId: "key-1",
  });
  mocks.checkApiKeyRateLimit.mockResolvedValue({ allowed: true });
});

describe("POST /api/v1/extensions/clip", () => {
  it("saves a new link, keeps its normalized URL and enqueues enrichment", async () => {
    const response = await clip({
      url: "https://Example.com/article?utm_source=x",
      title: "Tab",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      created: true,
      duplicate: false,
      duplicates: [],
    });
    expect(mocks.created[0]).toMatchObject({
      normalizedUrl: "https://example.com/article",
    });
    expect(mocks.enqueueLinkEnrichment).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      [{ itemId: "new-0", baseTitle: "Tab" }],
    );
  });

  it("returns the existing copy instead of saving a link twice", async () => {
    mocks.existing = [saved];
    const response = await clip({
      url: "https://example.com/article#comments",
    });
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      created: false,
      duplicate: true,
      item: { id: "old-1" },
      duplicates: [
        {
          itemId: "old-1",
          canvasName: "Reading",
          path: "/canvas/board-1?item=old-1",
        },
      ],
    });
    expect(mocks.created).toHaveLength(0);
    expect(mocks.enqueueLinkEnrichment).not.toHaveBeenCalled();
  });

  it("saves it again when asked, still naming the existing copy", async () => {
    mocks.existing = [saved];
    const body = await (
      await clip({ url: "https://example.com/article", allowDuplicate: true })
    ).json();
    expect(body).toMatchObject({ created: true, duplicate: true });
    expect(body.duplicates).toHaveLength(1);
    expect(mocks.created).toHaveLength(1);
  });

  // TASK-226: the same bookmark rules as every other write path.
  it.each([
    ["a javascript: URL", { url: "javascript:alert(1)" }],
    ["a data: URL", { url: "data:text/html,<script>alert(1)</script>" }],
    ["an ftp: URL", { url: "ftp://example.com/file" }],
    [
      "a URL over the length limit",
      { url: `https://example.com/${"a".repeat(2048)}` },
    ],
    [
      "a title over 500 characters",
      { url: "https://example.com/a", title: "t".repeat(600) },
    ],
    [
      "a selection over 2000 characters",
      { url: "https://example.com/a", selection: "s".repeat(2001) },
    ],
  ])("refuses %s", async (_label, body) => {
    const response = await clip(body);
    expect(response.status).toBe(400);
    expect(mocks.created).toHaveLength(0);
    expect(mocks.enqueueLinkEnrichment).not.toHaveBeenCalled();
  });

  it("stores the content the bookmark schema produces", async () => {
    const response = await clip({
      url: "https://example.com/article",
      title: "Tab",
      selection: "A highlight",
    });
    expect(response.status).toBe(200);
    expect(mocks.created[0]!.content).toEqual(
      parseCanvasItemContent(ItemType.BOOKMARK, {
        url: "https://example.com/article",
        title: "Tab",
        description: "A highlight",
      }),
    );
  });

  it("cuts a long URL used as the title to the title limit", async () => {
    const url = `https://example.com/${"a".repeat(700)}`;
    const response = await clip({ url });
    expect(response.status).toBe(200);
    const content = mocks.created[0]!.content as { url: string; title: string };
    expect(content.url).toBe(url);
    expect(content.title).toBe(url.slice(0, 500));
  });

  // The browser button's canvas picker (IMP-093).
  it("saves to a chosen canvas the key owner owns", async () => {
    const response = await clip({
      url: "https://example.com/picked",
      canvasId: MINE,
    });
    expect(response.status).toBe(200);
    expect(mocks.created[0]!.canvasId).toBe(MINE);
  });

  it("refuses a canvas that belongs to someone else", async () => {
    const response = await clip({
      url: "https://example.com/picked",
      canvasId: THEIRS,
    });
    expect(response.status).toBe(404);
    expect(mocks.created).toHaveLength(0);
  });
});
