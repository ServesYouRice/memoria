import { OutboxDeferError } from "@/lib/outbox/types";

/** How long a job about an item on a canvas in Trash waits to look again. */
export const TRASHED_CANVAS_RETRY_MS = 60 * 60 * 1000;

/**
 * IMP-132: background work for an item on a canvas in Trash (reading a PDF,
 * a video's captions or a page) waits, without using an attempt, instead of
 * reading files or the web for something the person deleted. A restore lets
 * the next try run, so nothing is lost; once the canvas is purged the item
 * is gone and the job finds nothing to do.
 */
export function deferWhileCanvasInTrash(canvas: {
  deletedAt?: Date | null;
}): void {
  if (!canvas.deletedAt) return;
  throw new OutboxDeferError(
    new Date(Date.now() + TRASHED_CANVAS_RETRY_MS),
    "The canvas is in Trash",
  );
}
