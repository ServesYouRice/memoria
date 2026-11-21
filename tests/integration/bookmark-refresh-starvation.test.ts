/**
 * TASK-158 — 100+ permanently failing bookmarks no longer take every refresh
 * batch: their attempts are stamped and healthy bookmarks get selected.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));

import { prisma } from "@/lib/db";
import { createBookmarkRefreshHandler } from "@/lib/bookmarks/outbox-handler";
import { GET as refreshCron } from "@/app/api/cron/refresh-bookmarks/route";

beforeEach(async () => {
  await prisma.outboxJob.deleteMany({ where: { type: "bookmark.refresh" } });
  await prisma.canvas.deleteMany({
    where: { user: { email: { startsWith: "starve-" } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: "starve-" } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("bookmark refresh starvation", () => {
  it("selects a healthy bookmark once failing ones were attempted", async () => {
    process.env.CRON_SECRET = "secret";
    delete process.env.FEATURE_BOOKMARK_UNFURLING;
    const owner = await prisma.user.create({
      data: { email: `starve-${Date.now()}@example.com` },
    });
    const canvas = await prisma.canvas.create({
      data: { name: "Starve", userId: owner.id },
    });
    const base = {
      canvasId: canvas.id,
      type: "BOOKMARK" as const,
      positionX: 0,
      positionY: 0,
      width: 10,
      height: 10,
      createdById: owner.id,
    };
    // Never refreshed and unrefreshable: no URL.
    await prisma.canvasItem.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        ...base,
        content: { title: `broken ${i}` },
      })),
    });
    const healthy = await prisma.canvasItem.create({
      data: {
        ...base,
        content: { url: "https://example.com", title: "ok" },
        bookmarkRefreshedAt: new Date(Date.now() - 3_600_000),
      },
    });

    // The cron picks the least recently refreshed bookmarks in the whole
    // database, and earlier files in this serial suite leave never-refreshed
    // bookmarks with real URLs behind (bookmark-import since IMP-091). Mark
    // those as just refreshed so the batches below see only this canvas.
    await prisma.canvasItem.updateMany({
      where: { type: "BOOKMARK", canvasId: { not: canvas.id } },
      data: { bookmarkRefreshedAt: new Date() },
    });

    const cron = () =>
      refreshCron(
        new NextRequest("http://localhost/api/cron/refresh-bookmarks", {
          headers: { authorization: "Bearer secret" },
        }),
      );
    expect(await (await cron()).json()).toEqual({ queued: 100 });
    const first = await prisma.outboxJob.findMany({
      where: { type: "bookmark.refresh" },
    });
    expect(
      first.some(
        (job) => (job.payload as { itemId: string }).itemId === healthy.id,
      ),
    ).toBe(false);

    const handler = createBookmarkRefreshHandler(prisma);
    for (const job of first) await handler(job as never);

    await prisma.outboxJob.deleteMany({ where: { type: "bookmark.refresh" } });
    expect(await (await cron()).json()).toEqual({ queued: 1 });
    const second = await prisma.outboxJob.findMany({
      where: { type: "bookmark.refresh" },
    });
    expect((second[0].payload as { itemId: string }).itemId).toBe(healthy.id);
  });
});
