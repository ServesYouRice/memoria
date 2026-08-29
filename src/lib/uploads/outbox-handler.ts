import type { OutboxHandler } from "@/lib/outbox/types";
import {
  UploadAssetStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { deletePrivateUploadObject } from "./private-storage";

export function createUploadDeleteHandler(prisma: PrismaClient): OutboxHandler {
  return async (job, context) => {
    const payload = job.payload as {
      assetId: string;
      userId: string;
      storageMode: string;
      storageKey: string;
      size: number;
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
      if (marked.count !== 1) return;
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
        throw new Error("Upload quota invariant prevented deletion accounting");
      }
    });
  };
}
