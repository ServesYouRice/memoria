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

import { POST } from "@/app/api/v1/extensions/clip/route";

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
});
