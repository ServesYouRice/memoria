import {
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { ApiError } from "@/lib/errors";
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

export async function enqueueUploadDeletion(tx: Tx, assetId: string) {
  const asset = await tx.uploadAsset.update({
    where: { id: assetId },
    data: { status: UploadAssetStatus.DELETING },
  });
  await enqueueOutboxJob(tx, {
    type: "upload.delete",
    dedupeKey: `upload.delete:${asset.id}`,
    payload: {
      assetId: asset.id,
      userId: asset.userId,
      storageMode: asset.storageMode,
      storageKey: asset.storageKey,
      size: asset.size,
    },
  });
  return asset;
}
