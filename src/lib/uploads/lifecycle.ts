import {
  OutboxJobStatus,
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ApiError, ConflictError, NotFoundError } from "@/lib/errors";
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
 * Statuses whose bytes are charged to the owner's UploadQuota: the charge is
 * taken at PENDING (reserveUploadAsset) and given back on PENDING -> FAILED
 * (failUploadReservation) or on entering DELETING (enqueueUploadDeletion).
 * RECONCILING is set by nothing today and is only reachable from a charged
 * state, so it is treated as charged. A DELETING asset is charged only while
 * its upload.delete job predates that change (see `jobReleasesQuota`).
 */
export const QUOTA_CHARGED_UPLOAD_STATUSES = [
  UploadAssetStatus.PENDING,
  UploadAssetStatus.ACTIVE,
  UploadAssetStatus.RECONCILING,
] as const;

type UploadDeletePayload = {
  assetId: string;
  userId: string;
  storageMode: string;
  storageKey: string;
  size: number;
  /** Set once enqueueUploadDeletion has released the quota itself. */
  quotaReleased?: boolean;
  /** false: a FAILED upload, released by failUploadReservation. */
  quotaCharged?: boolean;
};

/**
 * Whether the handler still releases quota for this job: only jobs queued
 * before the release moved to enqueueUploadDeletion (neither flag set, or
 * `quotaCharged: true`). The handler applies the same rule.
 */
export function jobReleasesQuota(payload: unknown) {
  const flags = (payload ?? {}) as {
    quotaReleased?: unknown;
    quotaCharged?: unknown;
  };
  return flags.quotaReleased !== true && flags.quotaCharged !== false;
}

/**
 * Give back one asset's charge. Guarded so it never goes below zero; drift
 * (quota already lower than the asset) is logged and clamped to zero so it
 * never blocks a deletion.
 */
async function releaseAssetQuota(
  tx: Tx,
  asset: { id: string; userId: string; size: number },
) {
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
  if (released.count === 1) return;
  logger.warn(
    { assetId: asset.id, userId: asset.userId },
    "Upload quota was lower than the asset being deleted; clamping to zero",
  );
  await tx.$executeRaw`UPDATE "UploadQuota" SET "assetCount" = GREATEST("assetCount" - 1, 0), "totalBytes" = GREATEST("totalBytes" - ${BigInt(asset.size)}, 0), "updatedAt" = NOW() WHERE "userId" = ${asset.userId}`;
}

/**
 * Queue an asset's object deletion. The row is locked first, then:
 * - PENDING, RECONCILING, ACTIVE -> DELETING, and the quota is released here,
 *   in the caller's transaction, so a cascade (canvas or account deletion)
 *   that removes the row before the job runs cannot leak it. The job carries
 *   `quotaReleased: true` and never releases again.
 * - PENDING and RECONCILING are an upload in progress: a direct delete passes
 *   `inProgress: "conflict"` and gets a 409; cascades mark them DELETING so
 *   they never block, and activateUploadAsset then refuses to overwrite that.
 * - FAILED stays FAILED; its job (`quotaCharged: false`) deletes any written
 *   object and marks it DELETED without touching quota.
 * - DELETING keeps its status and its existing job. A job queued before the
 *   quota moved here still releases the charge itself, unless `cascade` says
 *   the row is about to be deleted with its canvas or account: the job would
 *   then find no row, so the charge is released now and the job is flagged.
 * - DELETED is left as it is.
 * A DEAD job for the same asset is put back to PENDING, so deleting again
 * recovers a cleanup that failed for good.
 */
export async function enqueueUploadDeletion(
  tx: Tx,
  assetId: string,
  options: { inProgress?: "conflict" | "delete"; cascade?: boolean } = {},
) {
  const [locked] = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT "id" FROM "UploadAsset" WHERE "id" = ${assetId} FOR UPDATE`;
  if (!locked) throw new NotFoundError("Upload not found");
  const asset = await tx.uploadAsset.findUniqueOrThrow({
    where: { id: assetId },
  });
  if (asset.status === UploadAssetStatus.DELETED) return asset;

  const inProgress =
    asset.status === UploadAssetStatus.PENDING ||
    asset.status === UploadAssetStatus.RECONCILING;
  if (inProgress && options.inProgress === "conflict") {
    throw new ConflictError("Upload is still in progress");
  }

  const dedupeKey = `upload.delete:${asset.id}`;
  const base = {
    assetId: asset.id,
    userId: asset.userId,
    storageMode: asset.storageMode,
    storageKey: asset.storageKey,
    size: asset.size,
  };
  let payload: UploadDeletePayload;
  let resulting = asset;

  if (asset.status === UploadAssetStatus.FAILED) {
    payload = { ...base, quotaCharged: false, quotaReleased: true };
  } else if (asset.status === UploadAssetStatus.DELETING) {
    const existing = await tx.outboxJob.findUnique({ where: { dedupeKey } });
    if (existing && jobReleasesQuota(existing.payload) && options.cascade) {
      // The row is locked: a running job either committed first (the row
      // would read DELETED) or finds no row after the cascade, so this is
      // the only release.
      await releaseAssetQuota(tx, asset);
      payload = { ...base, quotaReleased: true };
      await tx.outboxJob.update({
        where: { id: existing.id },
        data: { payload: payload as Prisma.InputJsonValue },
      });
    } else if (existing && jobReleasesQuota(existing.payload)) {
      // Keep the legacy job's own release, also when re-arming it below.
      payload = { ...base, quotaReleased: false };
    } else {
      payload = { ...base, quotaReleased: true };
    }
  } else {
    const charged = await tx.uploadAsset.updateMany({
      where: {
        id: assetId,
        status: { in: [...QUOTA_CHARGED_UPLOAD_STATUSES] },
      },
      data: { status: UploadAssetStatus.DELETING },
    });
    if (charged.count === 1) await releaseAssetQuota(tx, asset);
    resulting = { ...asset, status: UploadAssetStatus.DELETING };
    payload = { ...base, quotaReleased: true };
  }

  const job = await enqueueOutboxJob(tx, {
    type: "upload.delete",
    dedupeKey,
    payload,
  });
  if (job.status === OutboxJobStatus.DEAD) {
    await tx.outboxJob.update({
      where: { id: job.id },
      data: {
        status: OutboxJobStatus.PENDING,
        payload: payload as Prisma.InputJsonValue,
        attempts: 0,
        nextRunAt: new Date(),
        completedAt: null,
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }
  return resulting;
}

/**
 * Queue deletion of every upload on a canvas, in the transaction that
 * hard-deletes it. UploadAsset.canvasId cascades, so each charged asset's
 * quota is released here, per uploader (collaborators upload to canvases
 * they do not own), through enqueueUploadDeletion with `cascade`; every
 * object not yet DELETED gets a delete job, and the thumbnail is left to the
 * caller.
 *
 * A PENDING upload still in flight then fails activation (its row is gone,
 * UploadNotPendingError); that path deletes the object it wrote (TASK-221).
 */
export async function releaseCanvasUploads(tx: Tx, canvasId: string) {
  // Locks in id order. A delete job racing this either committed first (its
  // row reads DELETED and is skipped) or waits and then matches 0 rows.
  const assets = await tx.$queryRaw<
    Array<{ id: string; status: UploadAssetStatus }>
  >`SELECT "id", "status" FROM "UploadAsset" WHERE "canvasId" = ${canvasId} ORDER BY "id" FOR UPDATE`;
  for (const asset of assets) {
    if (asset.status === UploadAssetStatus.DELETED) continue;
    await enqueueUploadDeletion(tx, asset.id, { cascade: true });
  }
}
