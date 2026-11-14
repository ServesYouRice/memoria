/**
 * PDF cards (IMP-113): queueing their text reading and releasing their file
 * when the card is purged. Server only; the reading itself lives in
 * `outbox-handler.ts` so routes never load the PDF reader.
 */

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import { enqueueUploadDeletion } from "@/lib/uploads/lifecycle";

type Store = Prisma.TransactionClient | PrismaClient;

export const PDF_READ_JOB = "pdf.read";
export const PDF_READ_MAX_ATTEMPTS = 4;

export function pdfReadDedupeKey(itemId: string) {
  return `${PDF_READ_JOB}:${itemId}`;
}

/**
 * Queue a text read for each new PDF card among `items`, in the transaction
 * that creates them. Other item types are ignored, so every create path can
 * pass what it made.
 */
export async function enqueuePdfReads(
  tx: Store,
  items: ReadonlyArray<{ id: string; type: string }>,
) {
  const ids = items.filter((item) => item.type === "PDF").map((i) => i.id);
  if (ids.length === 0) return;
  await enqueueOutboxJobs(
    tx,
    ids.map((itemId) => ({
      type: PDF_READ_JOB,
      payload: { itemId },
      dedupeKey: pdfReadDedupeKey(itemId),
      maxAttempts: PDF_READ_MAX_ATTEMPTS,
    })),
  );
}

/**
 * Queue deletion of the files of PDF cards about to be removed for good
 * (`itemIds`, locked by the caller's transaction). A file is released only
 * when it is an upload of the card's own canvas and no other card, in the
 * trash or not, still names it. Their saved text goes with the item rows
 * (`ItemPageCopy` cascades). Safe to run twice: deletion is keyed per upload.
 */
export async function releasePdfUploadsOf(
  tx: Prisma.TransactionClient,
  itemIds: string[],
) {
  if (itemIds.length === 0) return;
  const ids = Prisma.join(itemIds);
  const rows = await tx.$queryRaw<Array<{ assetId: string }>>`
    SELECT DISTINCT a."id" AS "assetId"
    FROM "CanvasItem" i
    JOIN "UploadAsset" a
      ON a."id" = i."content"->>'assetId' AND a."canvasId" = i."canvasId"
    WHERE i."id" IN (${ids})
      AND i."type" = 'PDF'::"ItemType"
      AND a."status" <> 'DELETED'::"UploadAssetStatus"
      AND NOT EXISTS (
        SELECT 1 FROM "CanvasItem" other
        WHERE other."type" = 'PDF'::"ItemType"
          AND other."content"->>'assetId' = a."id"
          AND other."id" NOT IN (${ids})
      )
    ORDER BY a."id"
  `;
  for (const row of rows) {
    await enqueueUploadDeletion(tx, row.assetId, { inProgress: "delete" });
  }
}
