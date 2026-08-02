import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OutboxHandler } from "@/lib/outbox/types";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import {
  deletePrivateUploadObject,
  writePrivateUploadObject,
} from "@/lib/uploads/private-storage";

const candidateSchema = z.object({ candidateId: z.string().cuid() }).strict();
const deleteSchema = z
  .object({ storageKey: z.string().min(1).max(1024) })
  .strict();

export function createThumbnailStoreHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job) => {
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
    );
    const install = await prisma.$transaction(async (tx) => {
      const currentRows = await tx.$queryRaw<Array<{ revision: bigint }>>`
        SELECT COALESCE(MAX("sequence"), 0) AS revision FROM "CanvasEvent" WHERE "canvasId" = ${candidate.canvasId}
      `;
      if ((currentRows[0]?.revision ?? 0n) !== candidate.revision) {
        await tx.canvasThumbnailCandidate.delete({
          where: { id: candidate.id },
        });
        return { installed: false, oldKey: null };
      }
      const current = await tx.canvas.findUnique({
        where: { id: candidate.canvasId },
        select: { thumbnailKey: true },
      });
      await tx.canvas.update({
        where: { id: candidate.canvasId },
        data: {
          thumbnailKey: storageKey,
          thumbnailRevision: candidate.revision,
          thumbnail: null,
        },
      });
      await tx.canvasThumbnailCandidate.delete({ where: { id: candidate.id } });
      return {
        installed: true,
        oldKey:
          current?.thumbnailKey && current.thumbnailKey !== storageKey
            ? current.thumbnailKey
            : null,
      };
    });
    if (!install.installed) {
      await deletePrivateUploadObject(storageMode, storageKey);
      return;
    }
    if (install.oldKey) {
      await prisma.$transaction((tx) =>
        enqueueOutboxJob(tx, {
          type: "thumbnail.delete",
          payload: { storageKey: install.oldKey! },
          dedupeKey: `thumbnail.delete:${install.oldKey}`,
        }),
      );
    }
  };
}

export function createThumbnailDeleteHandler(): OutboxHandler {
  return async (job) => {
    const { storageKey } = deleteSchema.parse(job.payload);
    await deletePrivateUploadObject(
      process.env.UPLOAD_STORAGE || "local",
      storageKey,
    );
  };
}
