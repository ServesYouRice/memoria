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

const payloadSchema = z.object({ itemId: z.string().cuid() }).strict();
const MAX_HISTORY_ENTRIES = 20;

interface BookmarkContent {
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  history?: Array<Record<string, unknown>>;
  [key: string]: unknown;
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
    if (!content.url) return;
    const fetched = await safeFetch(content.url, {
      timeout: 5000,
      signal: context?.signal,
    });
    if (!fetched.ok || !fetched.data)
      throw new Error("Bookmark metadata fetch failed");
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
    if (!changed) {
      await prisma.$transaction(async (tx) => {
        await lockCanvasForMutation(tx, item.canvasId);
        await tx.$executeRaw`
          UPDATE "CanvasItem" SET "bookmarkRefreshedAt" = NOW()
          WHERE "id" = ${item.id} AND "version" = ${item.version} AND "deletedAt" IS NULL
        `;
      });
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
    await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, item.canvasId);
      const update = await tx.canvasItem.updateMany({
        where: { id: item.id, version: item.version, deletedAt: null },
        data: {
          content: {
            ...next,
            history: history.slice(-MAX_HISTORY_ENTRIES),
          } as Prisma.InputJsonValue,
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
