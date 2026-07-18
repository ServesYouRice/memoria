import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { safeFetch } from "@/lib/utils/ssrf-protection";
import {
  extractMetadata,
  validateMetadata,
} from "@/lib/utils/metadata-extractor";
import { ItemType } from "@/types/canvas";
import { withApiHandler } from "@/lib/api/route-handler";
import { InternalServerError, UnauthorizedError } from "@/lib/errors";

// Helper for type safety
interface BookmarkContent {
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  history?: any[];
  [key: string]: any;
}

const MAX_HISTORY_ENTRIES = 20;

export const GET = withApiHandler(async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    throw new InternalServerError("Cron secret not configured");
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    throw new UnauthorizedError("Invalid cron secret");
  }

  // Fetch oldest updated bookmarks
  const bookmarks = await prisma.canvasItem.findMany({
    where: { type: ItemType.BOOKMARK, deletedAt: null },
    take: 10,
    orderBy: { updatedAt: "asc" },
  });

  const results = [];
  const invalidatedCanvasIds = new Set<string>();

  for (const item of bookmarks) {
    try {
      const content = item.content as BookmarkContent;
      if (!content.url) continue;

      const fetchResult = await safeFetch(content.url, { timeout: 5000 });
      if (!fetchResult.ok || !fetchResult.data) {
        await prisma.canvasItem.updateMany({
          where: { id: item.id, version: item.version, deletedAt: null },
          data: { updatedAt: new Date(), version: { increment: 1 } },
        });
        results.push({ id: item.id, status: "fetch-failed" });
        continue;
      }

      const metadata = extractMetadata(fetchResult.data, content.url);
      const cleaned = validateMetadata(metadata);

      // Access Typed Content
      const nextContent = {
        ...content,
        title: cleaned.title || content.title,
        description: cleaned.description || content.description,
        image: cleaned.image || content.image,
      };
      const changed =
        nextContent.title !== content.title ||
        nextContent.description !== content.description ||
        nextContent.image !== content.image;
      if (changed) {
        // Update
        const history = Array.isArray(content.history)
          ? [...content.history]
          : [];
        history.push({
          date: new Date().toISOString(),
          previous: {
            title: content.title,
            description: content.description,
            image: content.image,
          },
        });

        const update = await prisma.canvasItem.updateMany({
          where: { id: item.id, version: item.version, deletedAt: null },
          data: {
            content: {
              ...nextContent,
              history: history.slice(-MAX_HISTORY_ENTRIES),
            },
            version: { increment: 1 },
          },
        });
        if (update.count === 0) {
          results.push({ id: item.id, status: "skipped-concurrent-change" });
          continue;
        }
        invalidatedCanvasIds.add(item.canvasId);
        results.push({ id: item.id, status: "updated" });
      } else {
        // Just touch updatedAt
        const update = await prisma.canvasItem.updateMany({
          where: { id: item.id, version: item.version, deletedAt: null },
          data: {
            updatedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (update.count === 0) {
          results.push({ id: item.id, status: "skipped-concurrent-change" });
          continue;
        }
        invalidatedCanvasIds.add(item.canvasId);
        results.push({ id: item.id, status: "unchanged" });
      }
    } catch {
      results.push({ id: item.id, status: "error" });
    }
  }

  for (const canvasId of invalidatedCanvasIds) {
    await invalidateCanvasCache(canvasId);
  }

  return NextResponse.json({ results });
});
