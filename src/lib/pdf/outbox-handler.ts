/**
 * `pdf.read` (IMP-113): read one PDF card's text into the saved-text store
 * (`ItemPageCopy`), so search and Ask find words that appear only inside
 * the file, and write its page count and what was found onto the card.
 *
 * Safe to run twice: a card whose file was already read is left alone, the
 * text is upserted by item, and the card is only rewritten when its page
 * count or text status changes. A card that names an upload of another
 * canvas, or a file that is not an active PDF, is never read.
 */

import {
  ItemType,
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { OutboxDeferError, type OutboxHandler } from "@/lib/outbox/types";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { deferWhileCanvasInTrash } from "@/lib/canvas/trashed-canvas-jobs";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { storePageCopy } from "@/lib/services/page-copy";
import { readPrivateUploadObject } from "@/lib/uploads/private-storage";
import { PDF_MIME_TYPE } from "@/lib/uploads/file-types";
import {
  pdfContentSchema,
  pdfFileUrl,
  type PdfContent,
  type PdfTextStatus,
} from "./pdf-content";
import {
  PDF_READ_LIMITS,
  readPdfText,
  type PdfReadLimits,
  type PdfReadResult,
} from "./read-pdf-text";

export { PDF_READ_JOB } from "./pdf-items";

const logger = createLogger("pdf-read");

/** Storage read, the bounded parse and the database write. */
export const PDF_READ_TIMEOUT_MS = PDF_READ_LIMITS.timeoutMs + 60_000;
/** One PDF is parsed at a time per worker process; others wait their turn. */
const BUSY_RETRY_MS = 5_000;
/** A file still being stored (or copied for a duplicated canvas). */
const PENDING_RETRY_MS = 30_000;

const payloadSchema = z.object({ itemId: z.string().min(1).max(64) }).strict();

async function readBounded(
  storageMode: string,
  storageKey: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const object = await readPrivateUploadObject(storageMode, storageKey, signal);
  const reader = object.body.getReader();
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        finished = true;
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function outcomeOf(result: PdfReadResult): {
  textStatus: PdfTextStatus;
  pageCount?: number;
  text?: string;
} {
  switch (result.status) {
    case "text":
      return {
        textStatus: result.truncated ? "partial" : "ready",
        pageCount: result.pageCount,
        text: result.text,
      };
    case "no-text":
    case "too-many-pages":
      return { textStatus: result.status, pageCount: result.pageCount };
    case "too-large":
      return { textStatus: "too-large" };
    case "unreadable":
      return { textStatus: "unreadable" };
  }
}

export interface PdfReadHandlerOptions {
  read?: typeof readPdfText;
  limits?: PdfReadLimits;
  now?: () => Date;
}

export function createPdfReadHandler(
  prisma: PrismaClient,
  options: PdfReadHandlerOptions = {},
): OutboxHandler {
  const read = options.read ?? readPdfText;
  const limits = options.limits ?? PDF_READ_LIMITS;
  const now = options.now ?? (() => new Date());
  let busy = false;

  return async (job, context) => {
    const { itemId } = payloadSchema.parse(job.payload);
    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, type: ItemType.PDF, deletedAt: null },
      select: {
        canvasId: true,
        content: true,
        canvas: { select: { userId: true, deletedAt: true } },
      },
    });
    const parsed = pdfContentSchema.safeParse(item?.content);
    if (!item || !parsed.success) return;
    deferWhileCanvasInTrash(item.canvas);
    const content = parsed.data;
    const fileUrl = pdfFileUrl(content.assetId);

    const [asset, existing] = await Promise.all([
      prisma.uploadAsset.findUnique({
        where: { id: content.assetId },
        select: {
          canvasId: true,
          mimeType: true,
          status: true,
          size: true,
          storageMode: true,
          storageKey: true,
        },
      }),
      prisma.itemPageCopy.findUnique({
        where: { itemId },
        select: { url: true },
      }),
    ]);
    // Already read for this file (a repeated job, or a card pasted with
    // its text already kept).
    if (
      content.textStatus !== undefined &&
      (existing?.url === fileUrl ||
        (content.textStatus !== "ready" && content.textStatus !== "partial"))
    ) {
      return;
    }

    let outcome: ReturnType<typeof outcomeOf>;
    if (
      !asset ||
      asset.canvasId !== item.canvasId ||
      asset.mimeType !== PDF_MIME_TYPE
    ) {
      // Never read a file of another canvas into this one.
      outcome = { textStatus: "unreadable" };
    } else if (
      asset.status === UploadAssetStatus.PENDING ||
      asset.status === UploadAssetStatus.RECONCILING
    ) {
      throw new OutboxDeferError(
        new Date(Date.now() + PENDING_RETRY_MS),
        "The PDF is still being stored",
      );
    } else if (asset.status !== UploadAssetStatus.ACTIVE) {
      outcome = { textStatus: "unreadable" };
    } else if (asset.size > limits.maxReadBytes) {
      outcome = { textStatus: "too-large" };
    } else {
      if (busy) {
        throw new OutboxDeferError(
          new Date(Date.now() + BUSY_RETRY_MS),
          "Another PDF is being read",
        );
      }
      busy = true;
      try {
        const bytes = await readBounded(
          asset.storageMode,
          asset.storageKey,
          limits.maxReadBytes,
          context?.signal,
        );
        outcome = outcomeOf(
          bytes
            ? await read(bytes, { signal: context?.signal, limits })
            : { status: "too-large" },
        );
      } finally {
        busy = false;
      }
    }
    context?.signal.throwIfAborted();

    const changed = await prisma.$transaction(async (tx) => {
      await lockCanvasForMutation(tx, item.canvasId);
      const current = await tx.canvasItem.findFirst({
        where: { id: itemId, deletedAt: null },
        select: {
          version: true,
          content: true,
          createdById: true,
          updatedById: true,
        },
      });
      const currentContent = pdfContentSchema.safeParse(current?.content);
      // Deleted, or now names another file, while it was being read.
      if (
        !current ||
        !currentContent.success ||
        currentContent.data.assetId !== content.assetId
      ) {
        return false;
      }
      let textStatus = outcome.textStatus;
      if (outcome.text) {
        const stored = await storePageCopy(tx, {
          itemId,
          userId: item.canvas.userId,
          url: fileUrl,
          text: outcome.text,
          readAt: now(),
          maxBytes: limits.maxTextBytes,
        });
        if (stored === "over-budget") textStatus = "over-budget";
        if (stored === "empty") textStatus = "no-text";
      }
      if (textStatus !== "ready" && textStatus !== "partial") {
        // Text kept for a file this card no longer has is not its text.
        await tx.itemPageCopy.deleteMany({ where: { itemId } });
      }
      const next: PdfContent = {
        ...currentContent.data,
        textStatus,
        ...(outcome.pageCount !== undefined
          ? { pageCount: outcome.pageCount }
          : {}),
      };
      if (
        next.textStatus === currentContent.data.textStatus &&
        next.pageCount === currentContent.data.pageCount
      ) {
        return false;
      }
      const updated = await tx.canvasItem.updateMany({
        where: { id: itemId, version: current.version, deletedAt: null },
        data: {
          content: parseCanvasItemContent(
            ItemType.PDF,
            next,
          ) as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      // The canvas lock is held, so the version cannot have moved.
      if (updated.count !== 1) return false;
      await recordCanvasItemEvent(tx, {
        canvasId: item.canvasId,
        actorId: current.updatedById || current.createdById,
        itemId,
        version: current.version + 1,
        operation: "updated",
      });
      return true;
    });

    logger.info({ itemId, textStatus: outcome.textStatus }, "PDF text read");
    if (changed) await invalidateCanvasCache(item.canvasId);
  };
}
