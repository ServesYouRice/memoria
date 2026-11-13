import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import {
  deletePrivateUploadObject,
  writePrivateUploadObject,
} from "@/lib/uploads/private-storage";

const candidateSchema = z.object({ candidateId: z.string().cuid() }).strict();
const deleteSchema = z
  .object({ storageKey: z.string().min(1).max(1024) })
  .strict();

/**
 * Queue deletion of a stored thumbnail object. The job carries only the
 * storage key, so it still runs after the canvas row is gone; call it in the
 * transaction that drops the reference (thumbnail reset, canvas or account
 * deletion).
 */
export function enqueueThumbnailDeletion(
  tx: Prisma.TransactionClient,
  storageKey: string,
) {
  return enqueueOutboxJob(tx, {
    type: "thumbnail.delete",
    payload: { storageKey },
    dedupeKey: `thumbnail.delete:${storageKey}`,
  });
}

export function createThumbnailStoreHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job, context) => {
    const { candidateId } = candidateSchema.parse(job.payload);
    const candidate = await prisma.canvasThumbnailCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) return;
    const revisionRows = await prisma.$queryRaw<Array<{ revision: bigint }>>`
      SELECT COALESCE(MAX("sequence"), 0) AS revision FROM "CanvasEvent" WHERE "canvasId" = ${candidate.canvasId}
    `;
    if ((revisionRows[0]?.revision ?? 0n) !== candidate.revision) {
      await prisma.canvasThumbnailCandidate.delete({
        where: { id: candidate.id },
      });
      return;
    }
    const extension =
      candidate.mimeType === "image/png"
        ? "png"
        : candidate.mimeType === "image/webp"
          ? "webp"
          : "jpg";
    const storageKey = `thumbnails/${candidate.canvasId}/${candidate.revision}.${extension}`;
    const storageMode = process.env.UPLOAD_STORAGE || "local";
    await writePrivateUploadObject(
      storageMode,
      storageKey,
      candidate.bytes,
      candidate.mimeType,
      context?.signal,
    );
    // Every follow-up deletion is queued in the transaction that deletes the
    // candidate: once the candidate is gone a retry of this job does nothing,
    // so cleanup must already be durable by then.
    await prisma.$transaction(async (tx) => {
      // Mutations take this lock before writing events, so no event can land
      // between the revision check below and the write.
      await lockCanvasForMutation(tx, candidate.canvasId);
      const currentRows = await tx.$queryRaw<Array<{ revision: bigint }>>`
        SELECT COALESCE(MAX("sequence"), 0) AS revision FROM "CanvasEvent" WHERE "canvasId" = ${candidate.canvasId}
      `;
      const current = await tx.canvas.findUnique({
        where: { id: candidate.canvasId },
        select: { thumbnailKey: true },
      });
      // Never replace a newer installed thumbnail.
      const updated =
        (currentRows[0]?.revision ?? 0n) === candidate.revision
          ? await tx.canvas.updateMany({
              where: {
                id: candidate.canvasId,
                // A canvas with no preview takes any current one, including
                // revision 0: canvases seeded without change history
                // (IMP-083) never reach a higher revision until edited.
                OR: [
                  { thumbnailRevision: { lt: candidate.revision } },
                  { thumbnailKey: null },
                ],
              },
              data: {
                thumbnailKey: storageKey,
                thumbnailRevision: candidate.revision,
              },
            })
          : { count: 0 };
      await tx.canvasThumbnailCandidate.delete({ where: { id: candidate.id } });
      if (updated.count === 0) {
        // Stale: the object written above is not referenced by the canvas.
        if (current?.thumbnailKey !== storageKey) {
          await enqueueThumbnailDeletion(tx, storageKey);
        }
        return;
      }
      if (current?.thumbnailKey && current.thumbnailKey !== storageKey) {
        await enqueueThumbnailDeletion(tx, current.thumbnailKey);
      }
    });
  };
}

export function createThumbnailDeleteHandler(): OutboxHandler {
  return async (job, context) => {
    const { storageKey } = deleteSchema.parse(job.payload);
    await deletePrivateUploadObject(
      process.env.UPLOAD_STORAGE || "local",
      storageKey,
      context?.signal,
    );
  };
}
