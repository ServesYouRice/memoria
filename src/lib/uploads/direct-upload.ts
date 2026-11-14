/**
 * Direct browser uploads (IMP-152, handbook ME-05).
 *
 * 1. Presign: the app reserves a PENDING asset (charging the quota with the
 *    declared size) and signs a short-lived PUT for a staging key under
 *    `incoming/`, with the content type and length in the signature.
 * 2. The browser PUTs the file straight to the bucket.
 * 3. Confirm: the app HEADs the staging object (size and type), reads it,
 *    runs the same checks as the proxied route (magic bytes, image bounds,
 *    malware scan), writes the checked bytes to the asset's own key and
 *    activates it. Writing a copy means a second PUT to the still-valid
 *    staging URL can never change a confirmed file.
 *
 * A reservation that is never confirmed is failed (quota released) and its
 * staging object deleted by the `upload.direct.expire` job, queued with the
 * reservation to run after the URL lapses. Both steps are safe to repeat.
 * A bucket lifecycle rule on `incoming/` is a backstop for objects whose
 * job could not delete them.
 */
import { randomBytes } from "crypto";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import {
  UploadAssetStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import type { OutboxHandler } from "@/lib/outbox/types";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import {
  directUploadEndpoint,
  directUploadMaxBytes,
} from "./direct-upload-config";
import { type ALLOWED_IMAGE_MIME_TYPES, PDF_MIME_TYPE } from "./file-types";
import { chargeUploadQuota, failUploadReservation } from "./lifecycle";
import { deletePrivateUploadObject } from "./private-storage";
import { createS3Client } from "./s3-client.mjs";

export const DIRECT_UPLOAD_EXPIRE_JOB = "upload.direct.expire";
/** How long a presigned PUT stays valid. */
export const DIRECT_UPLOAD_URL_TTL_SECONDS = 5 * 60;
/** Confirm may still be running when the URL lapses; expire after this. */
const DIRECT_UPLOAD_EXPIRE_GRACE_MS = 10 * 60 * 1000;
const STAGING_PREFIX = "incoming/";

/** Types the direct path takes, with the extension the stored key gets. */
export const DIRECT_UPLOAD_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  [PDF_MIME_TYPE]: ".pdf",
} as const satisfies Record<
  (typeof ALLOWED_IMAGE_MIME_TYPES)[number] | typeof PDF_MIME_TYPE,
  string
>;
export type DirectUploadType = keyof typeof DIRECT_UPLOAD_TYPES;
export const DIRECT_UPLOAD_MIME_TYPES = Object.keys(DIRECT_UPLOAD_TYPES) as [
  DirectUploadType,
  ...DirectUploadType[],
];

export function isDirectUploadType(value: string): value is DirectUploadType {
  return Object.hasOwn(DIRECT_UPLOAD_TYPES, value);
}

/** The largest direct upload of this type: PDFs keep their own budget. */
export function directUploadLimit(mimeType: string): number {
  const max = directUploadMaxBytes();
  return mimeType === PDF_MIME_TYPE
    ? Math.min(max, RESOURCE_BUDGETS.pdf.maxFileBytes)
    : max;
}

/** Where the browser puts the file before confirm copies it to `storageKey`. */
export function directUploadStagingKey(storageKey: string): string {
  return `${STAGING_PREFIX}${storageKey}`;
}

function sanitizeSegment(segment: string): string {
  const cleaned = segment.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : "anonymous";
}

/** Same layout as the proxied route: uploads/<user>/<name>-<time>-<rand>. */
export function directUploadStorageKey(
  userId: string,
  filename: string,
  mimeType: DirectUploadType,
): string {
  const base =
    filename
      .replace(/^.*[\\/]/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.[^/.]+$/, "")
      .slice(0, 100) || "upload";
  const random = randomBytes(8).toString("hex");
  return `uploads/${sanitizeSegment(userId)}/${base}-${Date.now()}-${random}${DIRECT_UPLOAD_TYPES[mimeType]}`;
}

function storageMisconfigured(detail: string) {
  return new ApiError(
    500,
    "https://memoria.local/errors/upload-storage",
    "Upload storage misconfigured",
    detail,
  );
}

let presignClient: S3Client | null = null;

/**
 * The client that signs browser URLs. It names the browser-facing endpoint
 * (S3_PUBLIC_ENDPOINT) because the host is part of the signature.
 */
function getPresignClient(): S3Client {
  if (presignClient) return presignClient;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw storageMisconfigured("S3 credentials are missing");
  }
  presignClient = createS3Client({
    region,
    endpoint: directUploadEndpoint(),
    accessKeyId,
    secretAccessKey,
  });
  return presignClient;
}

/** Test seam: drop the cached client after changing S3 settings. */
export function resetDirectUploadClientForTests() {
  presignClient = null;
}

/** Throws the configuration error before anything is reserved. */
export function requireDirectUploadStorage(): { bucket: string } {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw storageMisconfigured("S3_BUCKET is not configured");
  getPresignClient();
  return { bucket };
}

/**
 * Sign one PUT of exactly `size` bytes of `contentType`. Both headers are
 * signed, so storage refuses a body of another length or type.
 */
export async function presignDirectUpload(input: {
  bucket: string;
  stagingKey: string;
  contentType: string;
  size: number;
}): Promise<string> {
  return getSignedUrl(
    getPresignClient(),
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.stagingKey,
      ContentType: input.contentType,
      ContentLength: input.size,
    }),
    {
      expiresIn: DIRECT_UPLOAD_URL_TTL_SECONDS,
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );
}

/**
 * Charge the quota, create the PENDING asset and queue its expiry in one
 * transaction, so a reservation never exists without its cleanup.
 */
export async function reserveDirectUpload(
  prisma: PrismaClient,
  input: {
    userId: string;
    canvasId: string;
    storageKey: string;
    filename: string;
    mimeType: string;
    size: number;
    maxFiles: number;
    maxBytes: number;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await chargeUploadQuota(tx, input);
    const asset = await tx.uploadAsset.create({
      data: {
        userId: input.userId,
        canvasId: input.canvasId,
        storageKey: input.storageKey,
        storageMode: "s3",
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        status: UploadAssetStatus.PENDING,
      },
    });
    await enqueueOutboxJob(tx, {
      type: DIRECT_UPLOAD_EXPIRE_JOB,
      dedupeKey: `${DIRECT_UPLOAD_EXPIRE_JOB}:${asset.id}`,
      payload: {
        assetId: asset.id,
        stagingKey: directUploadStagingKey(asset.storageKey),
      },
      nextRunAt: new Date(
        now.getTime() +
          DIRECT_UPLOAD_URL_TTL_SECONDS * 1000 +
          DIRECT_UPLOAD_EXPIRE_GRACE_MS,
      ),
    });
    return asset;
  });
}

const expirePayloadSchema = z
  .object({ assetId: z.string().min(1), stagingKey: z.string().min(1) })
  .strict();

/**
 * Fail a direct upload that was never confirmed and delete its staging
 * object. A confirmed (ACTIVE) or already failed asset is left alone, and
 * deleting a missing object succeeds, so running twice changes nothing.
 */
export function createDirectUploadExpireHandler(
  prisma: PrismaClient,
  deleteObject: typeof deletePrivateUploadObject = deletePrivateUploadObject,
): OutboxHandler {
  return async (job, context) => {
    const { assetId, stagingKey } = expirePayloadSchema.parse(job.payload);
    if (!stagingKey.startsWith(STAGING_PREFIX)) {
      throw new Error("Direct upload staging key is outside incoming/");
    }
    await failUploadReservation(prisma, assetId, "direct_upload_expired");
    await deleteObject("s3", stagingKey, context?.signal);
  };
}
