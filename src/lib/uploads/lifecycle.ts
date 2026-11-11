import {
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ApiError, ConflictError, NotFoundError } from "@/lib/errors";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";

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

/** Activation found the asset no longer PENDING (deleted, failed, ...). */
export class UploadNotPendingError extends Error {
  constructor(assetId: string) {
    super(`Upload ${assetId} is no longer pending`);
    this.name = "UploadNotPendingError";
  }
}

/** PENDING -> ACTIVE only; a deletion or failure that landed first wins. */
export async function activateUploadAsset(
  prisma: PrismaClient,
  assetId: string,
) {
  const activated = await prisma.uploadAsset.updateMany({
    where: { id: assetId, status: UploadAssetStatus.PENDING },
    data: { status: UploadAssetStatus.ACTIVE, lastError: null },
  });
  if (activated.count !== 1) throw new UploadNotPendingError(assetId);
  return prisma.uploadAsset.findUniqueOrThrow({ where: { id: assetId } });
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
 * Queue an asset's object deletion. Quota is charged while an asset is
 * PENDING, RECONCILING, ACTIVE or DELETING and released in FAILED and
 * DELETED, so:
 * - ACTIVE -> DELETING, and the job releases the quota (quotaCharged).
 * - FAILED stays FAILED; the job deletes any written object and marks it
 *   DELETED without touching quota (failUploadReservation released it).
 * - DELETING and DELETED are left as they are (no second job).
 * - PENDING and RECONCILING (an upload in progress): a direct delete passes
 *   `inProgress: "conflict"` and gets a 409; cascades (canvas or account
 *   deletion) keep marking them DELETING so they never block, and
 *   activateUploadAsset then refuses to overwrite that.
 */
export async function enqueueUploadDeletion(
  tx: Tx,
  assetId: string,
  options: { inProgress?: "conflict" | "delete" } = {},
) {
  const [locked] = await tx.$queryRaw<
    Array<{ id: string; status: UploadAssetStatus }>
  >`SELECT "id", "status" FROM "UploadAsset" WHERE "id" = ${assetId} FOR UPDATE`;
  if (!locked) throw new NotFoundError("Upload not found");
  const asset = await tx.uploadAsset.findUniqueOrThrow({
    where: { id: assetId },
  });

  if (
    asset.status === UploadAssetStatus.DELETING ||
    asset.status === UploadAssetStatus.DELETED
  ) {
    return asset;
  }
  const inProgress =
    asset.status === UploadAssetStatus.PENDING ||
    asset.status === UploadAssetStatus.RECONCILING;
  if (inProgress && options.inProgress === "conflict") {
    throw new ConflictError("Upload is still in progress");
  }

  const quotaCharged = asset.status !== UploadAssetStatus.FAILED;
  const resulting = quotaCharged
    ? await tx.uploadAsset.update({
        where: { id: assetId },
        data: { status: UploadAssetStatus.DELETING },
      })
    : asset;
  await enqueueOutboxJob(tx, {
    type: "upload.delete",
    dedupeKey: `upload.delete:${asset.id}`,
    payload: {
      assetId: asset.id,
      userId: asset.userId,
      storageMode: asset.storageMode,
      storageKey: asset.storageKey,
      size: asset.size,
      quotaCharged,
    },
  });
  return resulting;
}
