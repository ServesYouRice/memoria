/**
 * Upload API
 *
 * Handles file uploads for canvas images and voice notes with security
 * measures:
 * - File type validation from magic bytes (images; audio only for voice notes)
 * - File size limits
 * - Sanitized filenames
 * - Private storage with an authorized read proxy
 */

import { type NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve, sep } from "path";
import { randomBytes } from "crypto";

import { runIdempotent, withApiHandler } from "@/lib/api/route-handler";
import { requireAuth, requireCanvasAccess } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { ApiError, UnprocessableEntityError } from "@/lib/errors";
import { type S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "@/lib/uploads/s3-client.mjs";
import { getRedisClient } from "@/lib/cache/redis-client";
import {
  activateUploadAsset,
  compensateWrittenUpload,
  failUploadReservation,
  reserveUploadAsset,
} from "@/lib/uploads/lifecycle";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import { createLogger } from "@/lib/logger";
import { boundRequestBody, payloadTooLarge } from "@/lib/uploads/body-limit";
import { checkImageBounds } from "@/lib/uploads/image-bounds";
import {
  ALLOWED_AUDIO_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  declaredTypeMatches,
  detectUploadType,
} from "@/lib/uploads/file-types";
import {
  assertUploadNoteOffered,
  requestUploadNote,
} from "@/lib/uploads/upload-note";

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// Multipart framing (boundaries, headers, canvasId field) on top of the file.
const MULTIPART_OVERHEAD_ALLOWANCE = 64 * 1024;
const MAX_REQUEST_BODY_BYTES = MAX_FILE_SIZE + MULTIPART_OVERHEAD_ALLOWANCE;
const MAX_FILES_PER_USER = LAUNCH_LIMITS.uploadsPerUser;
const MAX_TOTAL_BYTES_PER_USER = LAUNCH_LIMITS.uploadBytesPerUser;

// Voice notes (IMP-071): an audio upload is only accepted together with a
// request to transcribe it into a note, since the canvas has no audio item.
const VOICE_NOTE_PURPOSE = "voice-note";

const DEFAULT_SCAN_TIMEOUT_MS = 10000;

const uploadLogger = createLogger("upload");
let s3Client: S3Client | null = null;
const uploadLockWaiters = new Map<string, Promise<void>>();

/**
 * Sanitize filename to prevent path traversal attacks
 */
function sanitizeFilename(filename: string): string {
  // Remove any directory path components
  const baseName = filename.replace(/^.*[\\\/]/, "");
  // Remove any potentially dangerous characters
  return baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sanitizePathSegment(segment: string): string {
  const cleaned = segment.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : "anonymous";
}

/**
 * Generate a unique filename with timestamp and random string
 */
function generateUniqueFilename(
  originalFilename: string,
  extension: string,
): string {
  const sanitized = sanitizeFilename(originalFilename);
  const baseName = sanitized.replace(/\.[^/.]+$/, "") || "upload";
  const timestamp = Date.now();
  const random = randomBytes(8).toString("hex");
  return `${baseName}-${timestamp}-${random}${extension}`;
}

function parseNotePosition(formData: FormData) {
  const x = Number(formData.get("positionX"));
  const y = Number(formData.get("positionY"));
  const inRange = (value: number) =>
    Number.isFinite(value) && Math.abs(value) <= 1_000_000;
  return formData.has("positionX") &&
    formData.has("positionY") &&
    inRange(x) &&
    inRange(y)
    ? { positionX: x, positionY: y }
    : {};
}

function getStorageMode(): "local" | "s3" {
  return process.env.UPLOAD_STORAGE === "s3" ? "s3" : "local";
}

function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const endpoint = process.env.S3_ENDPOINT;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new ApiError(
      500,
      "https://memoria.local/errors/upload-storage",
      "Upload storage misconfigured",
      "S3 credentials are missing",
    );
  }

  s3Client = createS3Client({
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
  });

  return s3Client;
}

async function withUploadLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const redis = getRedisClient();
  const lockKey = `upload-lock:${userId}`;
  const lockToken = randomBytes(16).toString("hex");

  if (redis) {
    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
      const acquired = await redis.set(lockKey, lockToken, "PX", 30000, "NX");
      if (acquired === "OK") {
        try {
          return await fn();
        } finally {
          await redis
            .eval(
              "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
              1,
              lockKey,
              lockToken,
            )
            .catch(() => {});
        }
      }

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }

    throw new ApiError(
      503,
      "https://memoria.local/errors/upload-lock-timeout",
      "Upload system busy",
      "Could not acquire upload quota lock. Please retry.",
    );
  }

  const existingWaiter = uploadLockWaiters.get(userId);
  if (existingWaiter) {
    await existingWaiter;
  }

  let releaseLock: () => void = () => {};
  const waiter = new Promise<void>((resolvePromise) => {
    releaseLock = resolvePromise;
  });
  uploadLockWaiters.set(userId, waiter);

  try {
    return await fn();
  } finally {
    uploadLockWaiters.delete(userId);
    releaseLock();
  }
}

async function runMalwareScan(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<void> {
  const scanUrl = process.env.UPLOAD_SCAN_URL;
  const scanRequired = process.env.UPLOAD_SCAN_REQUIRED === "true";

  if (!scanUrl) {
    if (scanRequired) {
      throw new ApiError(
        503,
        "https://memoria.local/errors/upload-scan",
        "Malware scan unavailable",
        "UPLOAD_SCAN_URL is not configured",
      );
    }
    return;
  }

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    filename,
  );

  const timeoutMs = Number(
    process.env.UPLOAD_SCAN_TIMEOUT_MS || DEFAULT_SCAN_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const unavailable = (detail: string) =>
    new ApiError(
      503,
      "https://memoria.local/errors/upload-scan",
      "Malware scan unavailable",
      detail,
    );

  // fetch resolves once headers arrive, so the deadline must also cover the
  // body: a scanner that sends 200 and then stalls would otherwise hold the
  // upload forever.
  let response: Response;
  let bodyText: string;
  try {
    try {
      response = await fetch(scanUrl, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
    } catch (error) {
      throw unavailable(
        error instanceof Error ? error.message : "Scan service unavailable",
      );
    }

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new ApiError(
        503,
        "https://memoria.local/errors/upload-scan",
        "Malware scan failed",
        `Scan service returned ${response.status}`,
      );
    }

    const body = response;
    bodyText = await new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        void body.body?.cancel().catch(() => undefined);
        reject(unavailable("Scan service response timed out"));
      };
      if (controller.signal.aborted) return onAbort();
      controller.signal.addEventListener("abort", onAbort, { once: true });
      body.text().then(
        (text) => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve(text);
        },
        (error: unknown) => {
          controller.signal.removeEventListener("abort", onAbort);
          reject(
            controller.signal.aborted
              ? unavailable("Scan service response timed out")
              : unavailable(
                  error instanceof Error
                    ? error.message
                    : "Scan service unavailable",
                ),
          );
        },
      );
    });
  } finally {
    clearTimeout(timeout);
  }

  let scanResult: { clean?: boolean; reason?: string } | null;
  try {
    scanResult = JSON.parse(bodyText) as {
      clean?: boolean;
      reason?: string;
    } | null;
  } catch {
    scanResult = null;
  }
  if (!scanResult || typeof scanResult.clean !== "boolean") {
    throw new ApiError(
      502,
      "https://memoria.local/errors/upload-scan",
      "Malware scan failed",
      "Scan service response was invalid",
    );
  }

  if (!scanResult.clean) {
    throw new UnprocessableEntityError(
      scanResult.reason || "File failed malware scan",
    );
  }
}

export const POST = withApiHandler(async (rawRequest: NextRequest) => {
  const { userId, email } = await requireAuth();

  // Enforce the cap before anything buffers the body: formData() and the
  // idempotency hash (req.clone().arrayBuffer()) both read it whole.
  const request = await boundRequestBody(rawRequest, MAX_REQUEST_BODY_BYTES);

  return runIdempotent(request, userId, async () => {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const canvasId = formData.get("canvasId");

    if (!file) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        "No file provided",
      );
    }

    if (typeof canvasId !== "string" || !/^c[a-z0-9]{20,}$/i.test(canvasId)) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        "A valid canvasId is required",
      );
    }

    await requireCanvasAccess(canvasId, userId, email, "EDIT");

    const purpose = formData.get("purpose");
    if (purpose !== null && purpose !== VOICE_NOTE_PURPOSE) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        "Unsupported upload purpose",
      );
    }
    const isVoiceNote = purpose === VOICE_NOTE_PURPOSE;
    const notePosition = isVoiceNote ? parseNotePosition(formData) : {};
    // Check before storing anything: a recording nobody can transcribe would
    // only use up the quota.
    if (isVoiceNote) await assertUploadNoteOffered(userId, "speechToText");

    if (file.size > MAX_FILE_SIZE) {
      throw payloadTooLarge(MAX_FILE_SIZE);
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const detectedType = detectUploadType(buffer);
    const allowed: readonly string[] = isVoiceNote
      ? ALLOWED_AUDIO_MIME_TYPES
      : ALLOWED_IMAGE_MIME_TYPES;
    if (!detectedType || !allowed.includes(detectedType.mime)) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        isVoiceNote
          ? "Invalid or unsupported audio format"
          : "Invalid or unsupported image format",
      );
    }

    if (detectedType.kind === "image") {
      const bounds = checkImageBounds(buffer, detectedType.mime);
      if (!bounds.ok) {
        throw new UnprocessableEntityError(bounds.reason);
      }
    }

    if (!declaredTypeMatches(file.type, detectedType)) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        "File type does not match content",
      );
    }

    await runMalwareScan(buffer, file.name, detectedType.mime);

    const uniqueFilename = generateUniqueFilename(
      file.name,
      detectedType.extension,
    );
    const safeUserId = sanitizePathSegment(userId);
    const storageMode = getStorageMode();
    if (storageMode === "local" && process.env.NODE_ENV === "production") {
      throw new ApiError(
        500,
        "https://memoria.local/errors/upload-storage",
        "Upload storage misconfigured",
        "Local uploads are development-only. Configure S3-compatible storage in production.",
      );
    }

    const voiceNote = async (assetId: string) =>
      isVoiceNote
        ? {
            note: await requestUploadNote(prisma, {
              userId,
              assetId,
              ...notePosition,
            }),
          }
        : {};

    /**
     * Activate an asset whose object is already stored. On failure the
     * object must not be left behind: fail the reservation and queue its
     * deletion. If that compensation itself fails, the object stays until
     * an operator removes it, so its key is logged (residual risk).
     */
    const activateWrittenUpload = async (asset: {
      id: string;
      storageKey: string;
      storageMode: string;
      size: number;
    }) => {
      try {
        await activateUploadAsset(prisma, asset.id);
      } catch (activationError) {
        try {
          await compensateWrittenUpload(prisma, {
            assetId: asset.id,
            userId,
            storageMode: asset.storageMode,
            storageKey: asset.storageKey,
            size: asset.size,
            reason: "activation_failed",
          });
        } catch {
          uploadLogger.error(
            { assetId: asset.id, storageKey: asset.storageKey },
            "Upload activation and its cleanup both failed; object retained",
          );
        }
        throw activationError;
      }
    };

    // Everything that can reject the upload without touching storage runs
    // before the reservation: a PENDING asset holds quota until it is failed.
    let s3Target: { bucket: string; client: S3Client } | null = null;
    if (storageMode === "s3") {
      const bucket = process.env.S3_BUCKET;
      if (!bucket) {
        throw new ApiError(
          500,
          "https://memoria.local/errors/upload-storage",
          "Upload storage misconfigured",
          "S3_BUCKET is not configured",
        );
      }
      s3Target = { bucket, client: getS3Client() };
    }

    const uploadRoot = resolve(join(process.cwd(), ".data", "uploads"));
    const uploadDir = resolve(join(uploadRoot, safeUserId));
    const filePath = resolve(uploadDir, uniqueFilename);
    const uploadPrefix = uploadDir.endsWith(sep) ? uploadDir : uploadDir + sep;
    if (!s3Target && !filePath.startsWith(uploadPrefix)) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        "Invalid upload path",
      );
    }

    return withUploadLock(userId, async () => {
      const storageKey = `uploads/${safeUserId}/${uniqueFilename}`;
      const asset = await reserveUploadAsset(prisma, {
        userId,
        canvasId,
        storageKey,
        storageMode,
        filename: file.name,
        mimeType: detectedType.mime,
        size: file.size,
        maxFiles: MAX_FILES_PER_USER,
        maxBytes: MAX_TOTAL_BYTES_PER_USER,
      });

      if (s3Target) {
        try {
          await s3Target.client.send(
            new PutObjectCommand({
              Bucket: s3Target.bucket,
              Key: storageKey,
              Body: buffer,
              ContentType: detectedType.mime,
              CacheControl: "private, no-store",
            }),
          );
        } catch (error) {
          await failUploadReservation(prisma, asset.id, "object_write_failed");
          throw error;
        }
        await activateWrittenUpload(asset);

        return NextResponse.json({
          assetId: asset.id,
          url: `/api/v1/uploads/${asset.id}`,
          filename: file.name,
          size: file.size,
          type: detectedType.mime,
          storage: "s3",
          ...(await voiceNote(asset.id)),
        });
      }

      try {
        await mkdir(uploadDir, { recursive: true });
        await writeFile(filePath, buffer);
      } catch (error) {
        await failUploadReservation(prisma, asset.id, "object_write_failed");
        throw error;
      }
      await activateWrittenUpload(asset);

      return NextResponse.json({
        assetId: asset.id,
        url: `/api/v1/uploads/${asset.id}`,
        filename: file.name,
        size: file.size,
        type: detectedType.mime,
        storage: "local",
        ...(await voiceNote(asset.id)),
      });
    });
  });
});
