/**
 * Image Upload API
 *
 * Handles file uploads for canvas images with security measures:
 * - File type validation (images only)
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
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getRedisClient } from "@/lib/cache/redis-client";
import {
  activateUploadAsset,
  failUploadReservation,
  reserveUploadAsset,
} from "@/lib/uploads/lifecycle";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES_PER_USER = LAUNCH_LIMITS.uploadsPerUser;
const MAX_TOTAL_BYTES_PER_USER = LAUNCH_LIMITS.uploadBytesPerUser;

// Allowed image MIME types
// NOTE: SVG removed due to XSS security risk (SVG can contain embedded scripts)
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

const DEFAULT_SCAN_TIMEOUT_MS = 10000;

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

/**
 * Identify image type from magic bytes
 */
function detectImageType(
  buffer: Buffer,
): { mime: string; extension: string } | null {
  if (buffer.length < 12) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: ".jpg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: "image/png", extension: ".png" };
  }

  // GIF: GIF87a or GIF89a
  const header = buffer.subarray(0, 6).toString("ascii");
  if (header === "GIF87a" || header === "GIF89a") {
    return { mime: "image/gif", extension: ".gif" };
  }

  // WEBP: RIFF....WEBP
  const riff = buffer.subarray(0, 4).toString("ascii");
  const webp = buffer.subarray(8, 12).toString("ascii");
  if (riff === "RIFF" && webp === "WEBP") {
    return { mime: "image/webp", extension: ".webp" };
  }

  return null;
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

  s3Client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: Boolean(endpoint),
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

  let response: Response;
  try {
    response = await fetch(scanUrl, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(
      503,
      "https://memoria.local/errors/upload-scan",
      "Malware scan unavailable",
      error instanceof Error ? error.message : "Scan service unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ApiError(
      503,
      "https://memoria.local/errors/upload-scan",
      "Malware scan failed",
      `Scan service returned ${response.status}`,
    );
  }

  const scanResult = (await response.json().catch(() => null)) as {
    clean?: boolean;
    reason?: string;
  } | null;
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

export const POST = withApiHandler(async (request: NextRequest) => {
  const { userId, email } = await requireAuth();

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

    if (file.size > MAX_FILE_SIZE) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const detectedType = detectImageType(buffer);
    if (!detectedType || !ALLOWED_MIME_TYPES.includes(detectedType.mime)) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        "Invalid or unsupported image format",
      );
    }

    if (file.type && file.type !== detectedType.mime) {
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

        const client = getS3Client();
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: storageKey,
              Body: buffer,
              ContentType: detectedType.mime,
              CacheControl: "private, no-store",
            }),
          );
          await activateUploadAsset(prisma, asset.id);
        } catch (error) {
          await failUploadReservation(prisma, asset.id, "object_write_failed");
          throw error;
        }

        return NextResponse.json({
          url: `/api/v1/uploads/${asset.id}`,
          filename: file.name,
          size: file.size,
          type: detectedType.mime,
          storage: "s3",
        });
      }

      const uploadRoot = resolve(join(process.cwd(), ".data", "uploads"));
      const uploadDir = resolve(join(uploadRoot, safeUserId));
      const filePath = resolve(uploadDir, uniqueFilename);

      const uploadPrefix = uploadDir.endsWith(sep)
        ? uploadDir
        : uploadDir + sep;
      if (!filePath.startsWith(uploadPrefix)) {
        throw new ApiError(
          400,
          "https://memoria.local/errors/upload",
          "Bad Request",
          "Invalid upload path",
        );
      }

      try {
        await mkdir(uploadDir, { recursive: true });
        await writeFile(filePath, buffer);
        await activateUploadAsset(prisma, asset.id);
      } catch (error) {
        await failUploadReservation(prisma, asset.id, "object_write_failed");
        throw error;
      }

      return NextResponse.json({
        url: `/api/v1/uploads/${asset.id}`,
        filename: file.name,
        size: file.size,
        type: detectedType.mime,
        storage: "local",
      });
    });
  });
});
