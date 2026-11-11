import type { OutboxHandler } from "@/lib/outbox/types";
import {
  type Prisma,
  UploadAssetStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { deletePrivateUploadObject } from "./private-storage";

/**
 * Statuses whose bytes are still charged to the owner's UploadQuota. FAILED
 * reservations were released by failUploadReservation and DELETED assets by
 * the upload.delete handler below.
 */
export const QUOTA_CHARGED_UPLOAD_STATUSES: readonly UploadAssetStatus[] = [
  UploadAssetStatus.PENDING,
  UploadAssetStatus.ACTIVE,
  UploadAssetStatus.DELETING,
  UploadAssetStatus.RECONCILING,
];

/**
 * Release the quota of assets whose rows are about to disappear (a canvas
 * delete cascades its UploadAsset rows before their upload.delete jobs run).
 * Call it inside the transaction that deletes the rows, with the assets read
 * under row locks. Counters are clamped at zero.
 */
export async function releaseUploadQuotaForAssets(
  tx: Prisma.TransactionClient,
  assets: ReadonlyArray<{ userId: string; size: number }>,
) {
  const perUser = new Map<string, { count: number; bytes: bigint }>();
  for (const asset of assets) {
    const entry = perUser.get(asset.userId) ?? { count: 0, bytes: 0n };
    entry.count += 1;
    entry.bytes += BigInt(asset.size);
    perUser.set(asset.userId, entry);
  }
  for (const [userId, { count, bytes }] of perUser) {
    await tx.$executeRaw`
      UPDATE "UploadQuota"
      SET "assetCount" = GREATEST("assetCount" - ${count}::int, 0),
          "totalBytes" = GREATEST("totalBytes" - ${bytes}::bigint, 0),
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
    `;
  }
}

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
      // No DELETING row: either this job already ran, or the row was removed
      // by a cascade (canvas delete) whose transaction released the quota
      // itself. Either way releasing here would release it twice.
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
