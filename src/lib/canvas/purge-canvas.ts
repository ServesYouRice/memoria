import type { Prisma } from "@/generated/prisma/client";
import { releaseCanvasUploads } from "@/lib/uploads/lifecycle";
import { enqueueThumbnailDeletion } from "@/lib/thumbnails/outbox-handler";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";

/**
 * Remove a canvas for good (IMP-132). Deleting a canvas only moves it to
 * Trash; the trash sweep calls this once the retention window has passed.
 * Returns the deleted row, or `null` when the canvas is already gone, so a
 * second run of the sweep does nothing.
 */
export async function purgeCanvas(
  tx: Prisma.TransactionClient,
  canvasId: string,
) {
  await lockCanvasForMutation(tx, canvasId);
  const existing = await tx.canvas.findUnique({
    where: { id: canvasId },
    select: { id: true },
  });
  if (!existing) return null;

  // The asset rows cascade away with the canvas, so each charged
  // asset's quota is released here, once, and every object not yet
  // DELETED gets a delete job.
  await releaseCanvasUploads(tx, canvasId);
  const deleted = await tx.canvas.delete({ where: { id: canvasId } });
  // Nothing references the stored thumbnail once the row is gone.
  if (deleted.thumbnailKey) {
    await enqueueThumbnailDeletion(tx, deleted.thumbnailKey);
  }
  return deleted;
}
