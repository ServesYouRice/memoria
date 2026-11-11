import {
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ApiError, ConflictError, NotFoundError } from "@/lib/errors";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { createLogger } from "@/lib/logger";

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

/** PENDING -> FAILED with its quota released; anything else is left alone. */
async function failPendingReservation(
  tx: Tx,
  assetId: string,
  safeError: string,
) {
  const [locked] = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT "id" FROM "UploadAsset" WHERE "id" = ${assetId} FOR UPDATE`;
  if (!locked) return;
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
}

export async function failUploadReservation(
  prisma: PrismaClient,
  assetId: string,
  safeError: string,
) {
  await prisma.$transaction((tx) =>
    failPendingReservation(tx, assetId, safeError),
  );
}

/**
 * The object was written but activation failed: fail the reservation (if
 * its row is still PENDING) and durably queue deletion of the written
 * object. Storage fields come from the caller because the row may already
 * be gone (canvas cascade) or DELETING, in which case its quota was
 * released elsewhere. The job has its own dedupe key: a regular
 * `upload.delete:<id>` job may already have run before this object existed,
 * and reusing its key would queue nothing.
 */
export async function compensateWrittenUpload(
  prisma: PrismaClient,
  input: {
    assetId: string;
    userId: string;
    storageMode: string;
    storageKey: string;
    size: number;
    reason: string;
  },
) {
  await prisma.$transaction(async (tx) => {
    await failPendingReservation(tx, input.assetId, input.reason);
    await enqueueOutboxJob(tx, {
      type: "upload.delete",
      dedupeKey: `upload.delete.compensate:${input.assetId}`,
      payload: {
        assetId: input.assetId,
        userId: input.userId,
        storageMode: input.storageMode,
        storageKey: input.storageKey,
        size: input.size,
        quotaCharged: false,
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

const canvasUploadLog = createLogger("uploads");

/**
 * Release a canvas's uploads in the transaction that hard-deletes it.
 *
 * UploadAsset.canvasId cascades, so the rows are gone by the time any
 * upload.delete job runs and the job's DELETING-guarded accounting matches
 * nothing. Quota for the charged assets (PENDING, RECONCILING, ACTIVE,
 * DELETING) is therefore released here, per uploader (collaborators upload
 * to canvases they do not own), and every object not yet DELETED gets an
 * uncharged delete job. A DELETING asset's existing job wins the dedupe; it
 * finds no row after the cascade and only deletes the object.
 *
 * A PENDING upload still in flight then fails activation (its row is gone,
 * UploadNotPendingError); that path must delete the object it wrote
 * (TASK-221).
 */
export async function releaseCanvasUploads(tx: Tx, canvasId: string) {
  // Locks in id order. A delete job racing this either committed first (its
  // row reads DELETED and is skipped) or waits and then matches 0 rows.
  const assets = await tx.$queryRaw<
    Array<{
      id: string;
      userId: string;
      status: UploadAssetStatus;
      size: number;
      storageMode: string;
      storageKey: string;
    }>
  >`SELECT "id", "userId", "status", "size", "storageMode", "storageKey" FROM "UploadAsset" WHERE "canvasId" = ${canvasId} ORDER BY "id" FOR UPDATE`;

  const charged = new Map<string, { count: number; bytes: bigint }>();
  for (const asset of assets) {
    if (!CHARGED_STATUSES.has(asset.status)) continue;
    const total = charged.get(asset.userId) ?? { count: 0, bytes: 0n };
    total.count += 1;
    total.bytes += BigInt(asset.size);
    charged.set(asset.userId, total);
  }

  for (const [userId, { count, bytes }] of [...charged].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const [before] = await tx.$queryRaw<
      Array<{ assetCount: number; totalBytes: bigint }>
    >`SELECT "assetCount", "totalBytes" FROM "UploadQuota" WHERE "userId" = ${userId} FOR UPDATE`;
    if (
      before &&
      (before.assetCount < count || BigInt(before.totalBytes) < bytes)
    ) {
      canvasUploadLog.warn(
        {
          userId,
          canvasId,
          assetCount: before.assetCount,
          totalBytes: String(before.totalBytes),
          releasing: { count, bytes: String(bytes) },
        },
        "Upload quota below the deleted canvas's assets; clamping to zero",
      );
    }
    // Clamped so existing drift never blocks canvas deletion.
    await tx.$executeRaw`UPDATE "UploadQuota" SET "assetCount" = GREATEST("assetCount" - ${count}, 0), "totalBytes" = GREATEST("totalBytes" - ${bytes}, 0), "updatedAt" = NOW() WHERE "userId" = ${userId}`;
  }

  for (const asset of assets) {
    if (asset.status === UploadAssetStatus.DELETED) continue;
    await enqueueOutboxJob(tx, {
      type: "upload.delete",
      dedupeKey: `upload.delete:${asset.id}`,
      payload: {
        assetId: asset.id,
        userId: asset.userId,
        storageMode: asset.storageMode,
        storageKey: asset.storageKey,
        size: asset.size,
        quotaCharged: false,
      },
    });
  }
}

const CHARGED_STATUSES: ReadonlySet<UploadAssetStatus> = new Set([
  UploadAssetStatus.PENDING,
  UploadAssetStatus.RECONCILING,
  UploadAssetStatus.ACTIVE,
  UploadAssetStatus.DELETING,
]);
