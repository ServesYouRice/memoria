import {
  OutboxJobStatus,
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

const logger = createLogger("uploads/lifecycle");

type Tx = Prisma.TransactionClient;

export async function reserveUploadAsset(
  prisma: PrismaClient,
  input: {
    userId: string;
    canvasId: string;
    storageKey: string;
    storageMode: string;
    filename: string;
    mimeType: string;
    size: number;
    maxFiles: number;
    maxBytes: number;
  },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "UploadQuota" ("userId", "assetCount", "totalBytes", "updatedAt")
      VALUES (${input.userId}, 0, 0, NOW()) ON CONFLICT ("userId") DO NOTHING
    `;
    const reservation = await tx.uploadQuota.updateMany({
      where: {
        userId: input.userId,
        assetCount: { lt: input.maxFiles },
        totalBytes: { lte: BigInt(input.maxBytes - input.size) },
      },
      data: {
        assetCount: { increment: 1 },
        totalBytes: { increment: BigInt(input.size) },
      },
    });
    if (reservation.count !== 1) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Upload quota exceeded",
        "Upload limit reached for this account",
      );
    }
    return tx.uploadAsset.create({
      data: {
        userId: input.userId,
        canvasId: input.canvasId,
        storageKey: input.storageKey,
        storageMode: input.storageMode,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        status: UploadAssetStatus.PENDING,
      },
    });
  });
}

export async function activateUploadAsset(
  prisma: PrismaClient,
  assetId: string,
) {
  return prisma.uploadAsset.update({
    where: { id: assetId },
    data: { status: UploadAssetStatus.ACTIVE, lastError: null },
  });
}

export async function failUploadReservation(
  prisma: PrismaClient,
  assetId: string,
  safeError: string,
) {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.uploadAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.status !== UploadAssetStatus.PENDING) return;
    await tx.uploadAsset.update({
      where: { id: assetId },
      data: {
        status: UploadAssetStatus.FAILED,
        lastError: safeError.slice(0, 500),
      },
    });
    await tx.uploadQuota.update({
      where: { userId: asset.userId },
      data: {
        assetCount: { decrement: 1 },
        totalBytes: { decrement: BigInt(asset.size) },
      },
    });
  });
}

/**
 * Statuses whose bytes are charged to the owner's UploadQuota: the charge is
 * taken at PENDING (reserveUploadAsset) and given back on PENDING -> FAILED
 * (failUploadReservation) or on entering DELETING (enqueueUploadDeletion).
 * RECONCILING is set by nothing today and is only reachable from a charged
 * state, so it is treated as charged.
 */
export const QUOTA_CHARGED_UPLOAD_STATUSES = [
  UploadAssetStatus.PENDING,
  UploadAssetStatus.ACTIVE,
  UploadAssetStatus.RECONCILING,
] as const;

/**
 * Move an asset to DELETING and queue its upload.delete job. The quota charge
 * is released here, in the caller's transaction, so it is released even when
 * the row is cascade-deleted (canvas or account deletion) before the job
 * runs. The job is marked `quotaReleased` so the handler does not release it
 * again. A DEAD job for the same asset is put back to PENDING, so deleting
 * again recovers a cleanup that failed for good.
 */
export async function enqueueUploadDeletion(tx: Tx, assetId: string) {
  const asset = await tx.uploadAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status === UploadAssetStatus.DELETED) return asset;

  const charged = await tx.uploadAsset.updateMany({
    where: { id: assetId, status: { in: [...QUOTA_CHARGED_UPLOAD_STATUSES] } },
    data: { status: UploadAssetStatus.DELETING },
  });
  if (charged.count === 1) {
    const released = await tx.uploadQuota.updateMany({
      where: {
        userId: asset.userId,
        assetCount: { gt: 0 },
        totalBytes: { gte: BigInt(asset.size) },
      },
      data: {
        assetCount: { decrement: 1 },
        totalBytes: { decrement: BigInt(asset.size) },
      },
    });
    if (released.count !== 1) {
      logger.warn(
        { assetId, userId: asset.userId },
        "Upload quota was lower than the asset being deleted; left unchanged",
      );
    }
  } else {
    // FAILED (already released) or DELETING (released when it entered
    // DELETING, or by its legacy job): no second release.
    await tx.uploadAsset.updateMany({
      where: { id: assetId, status: { not: UploadAssetStatus.DELETED } },
      data: { status: UploadAssetStatus.DELETING },
    });
  }

  const payload = {
    assetId: asset.id,
    userId: asset.userId,
    storageMode: asset.storageMode,
    storageKey: asset.storageKey,
    size: asset.size,
    quotaReleased: true,
  };
  const job = await enqueueOutboxJob(tx, {
    type: "upload.delete",
    dedupeKey: `upload.delete:${asset.id}`,
    payload,
  });
  if (job.status === OutboxJobStatus.DEAD) {
    // An asset that was already DELETING keeps its job's flag: a job queued
    // before quota moved here has none and must still release the charge.
    const previous = job.payload as { quotaReleased?: unknown } | null;
    const rearmed =
      asset.status === UploadAssetStatus.DELETING &&
      previous?.quotaReleased !== true
        ? { ...payload, quotaReleased: false }
        : payload;
    await tx.outboxJob.update({
      where: { id: job.id },
      data: {
        status: OutboxJobStatus.PENDING,
        payload: rearmed as Prisma.InputJsonValue,
        attempts: 0,
        nextRunAt: new Date(),
        completedAt: null,
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }
  return { ...asset, status: UploadAssetStatus.DELETING };
}
