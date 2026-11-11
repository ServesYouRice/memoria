import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { MAX_BOOKMARK_TITLE_LENGTH } from "@/lib/constants";
import { ClipBatchSource, saveClipBatch } from "@/lib/services/clip-batch";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("clip batch with long untitled links (VAL-301)", () => {
  it("saves untitled and blank-titled long URLs with a title within the limit", async () => {
    const user = await prisma.user.create({
      data: {
        email: `clip-long-${randomBytes(6).toString("hex")}@example.com`,
        autoEnrichLinks: false,
      },
    });
    const longUrl = (tag: string) =>
      `https://example.com/${tag}?q=${"x".repeat(600)}`;
    const links = [
      { url: "https://example.com/short", title: "Short" },
      { url: longUrl("untitled") },
      { url: longUrl("blank"), title: "   " },
    ];

    const result = await saveClipBatch({
      userId: user.id,
      source: ClipBatchSource.EXTENSION,
      data: { idempotencyKey: `long-${randomBytes(4).toString("hex")}`, links },
    });

    expect(result.itemIds).toHaveLength(3);
    const items = await prisma.canvasItem.findMany({
      where: { id: { in: result.itemIds } },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const contents = result.itemIds.map(
      (id) => byId.get(id)!.content as { url: string; title: string },
    );
    expect(contents.map((content) => content.url)).toEqual(
      links.map((link) => link.url),
    );
    expect(contents[0]!.title).toBe("Short");
    for (const content of contents.slice(1)) {
      expect(content.title.length).toBeLessThanOrEqual(
        MAX_BOOKMARK_TITLE_LENGTH,
      );
      expect(content.url.startsWith(content.title)).toBe(true);
    }
  });
});
