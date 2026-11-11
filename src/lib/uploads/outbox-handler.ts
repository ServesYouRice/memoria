import type { OutboxHandler } from "@/lib/outbox/types";
import {
  UploadAssetStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { deletePrivateUploadObject } from "./private-storage";

const logger = createLogger("uploads/delete");

export function createUploadDeleteHandler(prisma: PrismaClient): OutboxHandler {
  return async (job, context) => {
    const payload = job.payload as {
      assetId: string;
      userId: string;
      storageMode: string;
      storageKey: string;
      size: number;
      /** Set by enqueueUploadDeletion once it releases the quota itself. */
      quotaReleased?: boolean;
    };
    await deletePrivateUploadObject(
      payload.storageMode,
      payload.storageKey,
      context?.signal,
    );
    await prisma.$transaction(async (tx) => {
      const marked = await tx.uploadAsset.updateMany({
        where: {
          id: payload.assetId,
          status: UploadAssetStatus.DELETING,
        },
        data: { status: UploadAssetStatus.DELETED },
      });
      // No DELETING row: this job already ran, or a cascade (canvas or
      // account delete) removed the row. Jobs queued since the quota moved
      // to enqueueUploadDeletion carry quotaReleased and never release here.
      if (marked.count !== 1 || payload.quotaReleased === true) return;
      // A job queued before that change: release its charge once.
      const quota = await tx.uploadQuota.updateMany({
        where: {
          userId: payload.userId,
          assetCount: { gt: 0 },
          totalBytes: { gte: BigInt(payload.size) },
        },
        data: {
          assetCount: { decrement: 1 },
          totalBytes: { decrement: BigInt(payload.size) },
        },
      });
      if (quota.count !== 1) {
        // A retry would read the same row, so failing the job only buries it
        // as DEAD. Finish the deletion and leave the mismatch for an operator.
        logger.error(
          { assetId: payload.assetId, userId: payload.userId },
          "Upload quota was lower than the deleted asset; quota left unchanged",
        );
      }
    });
  };
}
