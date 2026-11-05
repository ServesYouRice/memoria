import { randomBytes } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { OutboxJob } from "@/generated/prisma/client";

vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/db";
import { ClipBatchSource, saveClipBatch } from "@/lib/services/clip-batch";
import {
  LINK_ENRICH_JOB,
  createLinkEnrichmentHandler,
} from "@/lib/services/link-enrichment";

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(autoEnrichLinks = true) {
  return prisma.user.create({
    data: {
      email: `enrich-${randomBytes(6).toString("hex")}@example.com`,
      autoEnrichLinks,
    },
  });
}

const page = {
  ok: true as const,
  html: "<html><body><main>All about sourdough</main></body></html>",
  metadata: { title: "Sourdough guide", description: "Bake bread" },
};
const suggestion = {
  ok: true as const,
  suggestion: {
    title: "Beginner sourdough guide",
    tags: ["baking", "bread"],
    summary: "A step-by-step sourdough recipe. Good for a first loaf.",
  },
};

describe("link enrichment outbox job (PostgreSQL)", () => {
  it("enqueues one job per saved link and enriches each exactly once", async () => {
    const user = await createUser();
    const result = await saveClipBatch({
      userId: user.id,
      source: ClipBatchSource.EXTENSION,
      data: {
        idempotencyKey: `enrich-${randomBytes(4).toString("hex")}`,
        links: [
          { url: "https://example.com/sourdough", title: "Tab" },
          { url: "https://example.com/other" },
        ],
      },
    });

    const rows = await prisma.itemEnrichment.findMany({
      where: { itemId: { in: result.itemIds } },
    });
    expect(rows.map((row) => row.status)).toEqual(["PENDING", "PENDING"]);
    const jobs = await prisma.outboxJob.findMany({
      where: {
        type: LINK_ENRICH_JOB,
        dedupeKey: { in: result.itemIds.map((id) => `link.enrich:${id}`) },
      },
    });
    expect(jobs).toHaveLength(2);

    const job = jobs.find(
      (entry) =>
        (entry.payload as { itemId: string }).itemId === result.itemIds[0],
    ) as OutboxJob;
    const fetchPage = vi.fn().mockResolvedValue(page);
    const suggest = vi.fn().mockResolvedValue(suggestion);
    const handler = createLinkEnrichmentHandler(prisma, {
      fetchPage,
      suggest,
    });
    await handler({ ...job, attempts: 1 });
    await handler({ ...job, attempts: 2 });

    const item = await prisma.canvasItem.findUniqueOrThrow({
      where: { id: result.itemIds[0] },
    });
    expect(item.content).toMatchObject({
      url: "https://example.com/sourdough",
      title: "Beginner sourdough guide",
      description: "Bake bread",
      summary: "A step-by-step sourdough recipe. Good for a first loaf.",
    });
    expect(item.tags).toEqual(["baking", "bread"]);
    expect(item.version).toBe(2);
    expect(suggest).toHaveBeenCalledTimes(1);

    const row = await prisma.itemEnrichment.findUniqueOrThrow({
      where: { itemId: item.id },
    });
    expect(row.status).toBe("DONE");
    expect(row.filledFields).toEqual(
      expect.arrayContaining(["title", "description", "summary", "tags"]),
    );
    expect(row.filledTitle).toBe("Beginner sourdough guide");

    const events = await prisma.canvasEvent.count({
      where: { entityId: item.id, operation: "updated" },
    });
    expect(events).toBe(1);
  });

  it("enqueues nothing for a user who turned it off", async () => {
    const user = await createUser(false);
    const result = await saveClipBatch({
      userId: user.id,
      source: ClipBatchSource.EXTENSION,
      data: {
        idempotencyKey: `enrich-${randomBytes(4).toString("hex")}`,
        links: [{ url: "https://example.com/off" }],
      },
    });
    await expect(
      prisma.itemEnrichment.count({ where: { itemId: result.itemIds[0] } }),
    ).resolves.toBe(0);
    await expect(
      prisma.outboxJob.count({
        where: { dedupeKey: `link.enrich:${result.itemIds[0]}` },
      }),
    ).resolves.toBe(0);
  });
});
