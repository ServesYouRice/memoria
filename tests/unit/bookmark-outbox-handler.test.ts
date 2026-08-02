import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  extractMetadata: vi.fn(),
  validateMetadata: vi.fn(),
  recordEvent: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/utils/ssrf-protection", () => ({ safeFetch: mocks.safeFetch }));
vi.mock("@/lib/utils/metadata-extractor", () => ({
  extractMetadata: mocks.extractMetadata,
  validateMetadata: mocks.validateMetadata,
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: mocks.recordEvent,
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: mocks.invalidate,
}));

import { createBookmarkRefreshHandler } from "@/lib/bookmarks/outbox-handler";

function fakePrisma() {
  const executeRaw = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const client = {
    canvasItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: "clzzzzzzzzzzzzzzzzzzzzzzz",
        canvasId: "clxxxxxxxxxxxxxxxxxxxxxxx",
        type: "BOOKMARK",
        content: {
          url: "https://example.com",
          title: "Original",
          description: "Description",
          image: "https://example.com/image.png",
        },
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

describe("bookmark refresh outbox handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.safeFetch.mockResolvedValue({ ok: true, data: "<html></html>" });
    mocks.extractMetadata.mockReturnValue({});
  });

  it("does not bump the version when visible metadata is unchanged", async () => {
    mocks.validateMetadata.mockReturnValue({
      title: "Original",
      description: "Description",
      image: "https://example.com/image.png",
    });
    const { client, executeRaw, updateMany } = fakePrisma();
    await createBookmarkRefreshHandler(client)({
      payload: { itemId: "clzzzzzzzzzzzzzzzzzzzzzzz" },
    } as never);
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(updateMany).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("increments once and emits one event when visible metadata changes", async () => {
    mocks.validateMetadata.mockReturnValue({
      title: "Changed",
      description: "Description",
      image: "https://example.com/image.png",
    });
    const { client, updateMany } = fakePrisma();
    await createBookmarkRefreshHandler(client)({
      payload: { itemId: "clzzzzzzzzzzzzzzzzzzzzzzz" },
    } as never);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: { increment: 1 } }),
      }),
    );
    expect(mocks.recordEvent).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledWith("clxxxxxxxxxxxxxxxxxxxxxxx");
  });
});
