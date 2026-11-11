import {
  ItemType,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { z } from "zod";
import type { OutboxHandler } from "@/lib/outbox/types";
import { safeFetch } from "@/lib/utils/ssrf-protection";
import {
  extractMetadata,
  validateMetadata,
} from "@/lib/utils/metadata-extractor";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import {
  MAX_BOOKMARK_HISTORY_ENTRIES,
  parseCanvasItemContent,
} from "@/lib/validation/canvas-item";
import { createLogger } from "@/lib/logger";

const log = createLogger("bookmark-refresh");
const payloadSchema = z.object({ itemId: z.string().cuid() }).strict();

interface BookmarkContent {
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  history?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Mark a refresh attempt without touching content, version or events. Failed
 * and URL-less attempts are stamped too, so a permanently failing bookmark
 * moves to the back of the cron's oldest-first batch instead of taking it
 * every run. A concurrent edit (version moved on) leaves the row for a later
 * run.
 */
function stampRefreshAttempt(
  prisma: PrismaClient,
  item: { id: string; canvasId: string; version: number },
) {
  return prisma.$transaction(async (tx) => {
    await lockCanvasForMutation(tx, item.canvasId);
    await tx.$executeRaw`
      UPDATE "CanvasItem" SET "bookmarkRefreshedAt" = NOW()
      WHERE "id" = ${item.id} AND "version" = ${item.version} AND "deletedAt" IS NULL
    `;
  });
}

export function createBookmarkRefreshHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    if (process.env.FEATURE_BOOKMARK_UNFURLING === "false") {
      return;
    }
    const { itemId } = payloadSchema.parse(job.payload);
    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, type: ItemType.BOOKMARK, deletedAt: null },
    });
    if (!item) return;
    const content = item.content as BookmarkContent;
    if (!content.url) {
      await stampRefreshAttempt(prisma, item);
      return;
    }
    let fetched: Awaited<ReturnType<typeof safeFetch>>;
    try {
      fetched = await safeFetch(content.url, {
        timeout: 5000,
        signal: context?.signal,
      });
    } catch (error) {
      await stampRefreshAttempt(prisma, item);
      throw error;
    }
    if (!fetched.ok || !fetched.data) {
      // Still thrown so the outbox retries and counts the failure.
      await stampRefreshAttempt(prisma, item);
      throw new Error("Bookmark metadata fetch failed");
    }
    const metadata = validateMetadata(
      extractMetadata(fetched.data, content.url),
    );
    const next = {
      ...content,
      title: metadata.title || content.title,
      description: metadata.description || content.description,
      image: metadata.image || content.image,
    };
    const changed =
      next.title !== content.title ||
      next.description !== content.description ||
      next.image !== content.image;
    const stampRefreshed = () => stampRefreshAttempt(prisma, item);
    if (!changed) {
      await stampRefreshed();
      return;
    }
    const history = [
      ...(Array.isArray(content.history) ? content.history : []),
    ];
    history.push({
      date: new Date().toISOString(),
      previous: {
        title: content.title,
        description: content.description,
        image: content.image,
      },
    });
    // Remote page metadata goes through the canonical bookmark schema like
    // every other content writer: unsafe image schemes are dropped and
    // oversized values are refused.
    let parsedContent: ReturnType<typeof parseCanvasItemContent>;
    try {
      parsedContent = parseCanvasItemContent(ItemType.BOOKMARK, {
        ...next,
        history: history.slice(-MAX_BOOKMARK_HISTORY_ENTRIES),
      });
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      log.warn(
        { itemId: item.id, issues: error.issues.length },
        "Refreshed bookmark metadata failed validation; content not written",
      );
      await stampRefreshed();
      return;
    }
    await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, item.canvasId);
      const update = await tx.canvasItem.updateMany({
        where: { id: item.id, version: item.version, deletedAt: null },
        data: {
          content: parsedContent as Prisma.InputJsonValue,
          bookmarkRefreshedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) return;
      await recordCanvasItemEvent(tx, {
        canvasId: item.canvasId,
        actorId: item.updatedById || item.createdById,
        itemId: item.id,
        version: item.version + 1,
        operation: "updated",
      });
    });
    await invalidateCanvasCache(item.canvasId);
  };
}
