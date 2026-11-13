import { z } from "zod";
import {
  UploadAssetStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import {
  UploadNotPendingError,
  activateUploadAsset,
  compensateWrittenUpload,
  failUploadReservation,
} from "./lifecycle";
import {
  readPrivateUploadObject,
  writePrivateUploadObject,
} from "./private-storage";

/**
 * IMP-098 — copies a stored picture into the PENDING upload a duplicated
 * canvas made for it, then makes that upload ACTIVE. Safe to run twice: a
 * target that is no longer PENDING is done (or gone), and writing the same
 * bytes to the same key again changes nothing.
 */
export const UPLOAD_COPY_JOB = "upload.copy";
export const UPLOAD_COPY_TIMEOUT_MS = 60_000;

const payloadSchema = z
  .object({
    sourceAssetId: z.string().min(1),
    targetAssetId: z.string().min(1),
  })
  .strict();

async function readAll(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createUploadCopyHandler(
  prisma: PrismaClient,
  storage = { read: readPrivateUploadObject, write: writePrivateUploadObject },
): OutboxHandler {
  return async (job, context) => {
    const { sourceAssetId, targetAssetId } = payloadSchema.parse(job.payload);
    const target = await prisma.uploadAsset.findUnique({
      where: { id: targetAssetId },
    });
    if (!target || target.status !== UploadAssetStatus.PENDING) return;
    const source = await prisma.uploadAsset.findUnique({
      where: { id: sourceAssetId },
    });
    if (!source || source.status !== UploadAssetStatus.ACTIVE) {
      // The original went away first: give the storage back.
      await failUploadReservation(prisma, target.id, "copy_source_missing");
      return;
    }
    const object = await storage.read(
      source.storageMode,
      source.storageKey,
      context?.signal,
    );
    const bytes = await readAll(object.body);
    await storage.write(
      target.storageMode,
      target.storageKey,
      bytes,
      target.mimeType,
      context?.signal,
    );
    try {
      await activateUploadAsset(prisma, target.id);
    } catch (error) {
      if (!(error instanceof UploadNotPendingError)) throw error;
      // The copy was deleted while the file was written: remove the file.
      await compensateWrittenUpload(prisma, {
        assetId: target.id,
        userId: target.userId,
        storageMode: target.storageMode,
        storageKey: target.storageKey,
        size: target.size,
        reason: "copy_target_gone",
      });
    }
  };
}
