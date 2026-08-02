import type { OutboxHandler } from "@/lib/outbox/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { deletePrivateUploadObject } from "./private-storage";

export function createUploadDeleteHandler(prisma: PrismaClient): OutboxHandler {
  return async (job) => {
    const payload = job.payload as {
      assetId: string;
      userId: string;
      storageMode: string;
      storageKey: string;
      size: number;
    };
    await deletePrivateUploadObject(payload.storageMode, payload.storageKey);
    await prisma.$transaction(async (tx) => {
      const asset = await tx.uploadAsset.findUnique({
        where: { id: payload.assetId },
      });
      if (asset) {
        await tx.uploadAsset.update({
          where: { id: asset.id },
          data: { status: "DELETED" },
        });
      }
      const quota = await tx.uploadQuota.findUnique({
        where: { userId: payload.userId },
      });
      if (
        quota &&
        quota.assetCount > 0 &&
        quota.totalBytes >= BigInt(payload.size)
      ) {
        await tx.uploadQuota.update({
          where: { userId: payload.userId },
          data: {
            assetCount: { decrement: 1 },
            totalBytes: { decrement: BigInt(payload.size) },
          },
        });
      }
    });
  };
}
