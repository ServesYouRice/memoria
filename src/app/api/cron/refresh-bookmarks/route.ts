import { type NextRequest, NextResponse } from "next/server";
import { ItemType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { withApiHandler } from "@/lib/api/route-handler";
import { InternalServerError, UnauthorizedError } from "@/lib/errors";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export const GET = withApiHandler(async (request: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) throw new InternalServerError("Cron secret not configured");
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    throw new UnauthorizedError("Invalid cron secret");
  }

  const cutoff = new Date(Date.now() - REFRESH_INTERVAL_MS);
  const bucket = Math.floor(Date.now() / REFRESH_INTERVAL_MS);
  const queued = await prisma.$transaction(async (tx) => {
    const items = await tx.canvasItem.findMany({
      where: {
        type: ItemType.BOOKMARK,
        deletedAt: null,
        OR: [
          { bookmarkRefreshedAt: null },
          { bookmarkRefreshedAt: { lt: cutoff } },
        ],
      },
      select: { id: true },
      orderBy: { bookmarkRefreshedAt: { sort: "asc", nulls: "first" } },
      take: 100,
    });
    await Promise.all(
      items.map((item) =>
        enqueueOutboxJob(tx, {
          type: "bookmark.refresh",
          payload: { itemId: item.id },
          dedupeKey: `bookmark.refresh:${item.id}:${bucket}`,
          maxAttempts: 6,
        }),
      ),
    );
    return items.length;
  });
  return NextResponse.json({ queued });
});
