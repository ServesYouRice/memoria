/**
 * Add or change the sorting note of a clip batch after it was saved.
 *
 * The phone share target (IMP-062) saves the link the moment the share opens
 * and only then asks "How should this be sorted?", so the note arrives in a
 * second call. Setting the same note again is a no-op, so the call is safe to
 * retry. The batch's request hash is left alone: it covers what was sent at
 * save time, which keeps a reload of the share a replay.
 */

import type { ClipBatchSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

export async function setClipBatchNote(input: {
  userId: string;
  batchId: string;
  source: ClipBatchSource;
  /** Already validated; an empty note clears it. */
  note: string | undefined;
}): Promise<{ batchId: string; note: string | null }> {
  const note = input.note ? input.note : null;
  const { count } = await prisma.clipBatch.updateMany({
    where: { id: input.batchId, userId: input.userId, source: input.source },
    data: { note },
  });
  if (count === 0) {
    throw new NotFoundError("Clip batch not found");
  }
  return { batchId: input.batchId, note };
}
