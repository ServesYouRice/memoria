/**
 * Image Upload API
 *
 * Handles file uploads for canvas images with security measures:
 * - File type validation (images only)
 * - File size limits
 * - Sanitized filenames
 * - Storage in public/uploads directory
 */

import { type NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, readdir, stat } from "fs/promises";
import { join, resolve, sep } from "path";
import { randomBytes } from "crypto";

import { runIdempotent, withApiHandler } from "@/lib/api/route-handler";
import { requireAuth } from "@/lib/api/auth";
import { ApiError, UnprocessableEntityError } from "@/lib/errors";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getRedisClient } from "@/lib/cache/redis-client";

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES_PER_USER = 500;
const MAX_TOTAL_BYTES_PER_USER = 100 * 1024 * 1024;

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

async function getDirectoryUsage(
  directory: string,
): Promise<{ fileCount: number; totalBytes: number }> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const stats = await Promise.all(
    files.map((entry) => stat(join(directory, entry.name))),
  );
  const totalBytes = stats.reduce((sum, entry) => sum + entry.size, 0);
  return { fileCount: files.length, totalBytes };
}

async function getS3Usage(client: S3Client, bucket: string, prefix: string) {
  let continuationToken: string | undefined;
  let fileCount = 0;
  let totalBytes = 0;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    fileCount += page.Contents?.length || 0;
    totalBytes +=
      page.Contents?.reduce((sum, entry) => sum + (entry.Size || 0), 0) || 0;
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return { fileCount, totalBytes };
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
      "https://canvascollect.com/errors/upload-storage",
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

function buildPublicUrl(key: string): string {
  const publicBase = process.env.UPLOADS_PUBLIC_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}/${key}`;
  }

  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  const endpoint = process.env.S3_ENDPOINT;

  if (endpoint) {
    return `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`;
  }

  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
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
      "https://canvascollect.com/errors/upload-lock-timeout",
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
        "https://canvascollect.com/errors/upload-scan",
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
      "https://canvascollect.com/errors/upload-scan",
      "Malware scan unavailable",
      error instanceof Error ? error.message : "Scan service unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ApiError(
      503,
      "https://canvascollect.com/errors/upload-scan",
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
      "https://canvascollect.com/errors/upload-scan",
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
  const { userId } = await requireAuth();

  return runIdempotent(request, userId, async () => {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      throw new ApiError(
        400,
        "https://canvascollect.com/errors/upload",
        "Bad Request",
        "No file provided",
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new ApiError(
        400,
        "https://canvascollect.com/errors/upload",
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
        "https://canvascollect.com/errors/upload",
        "Bad Request",
        "Invalid or unsupported image format",
      );
    }

    if (file.type && file.type !== detectedType.mime) {
      throw new ApiError(
        400,
        "https://canvascollect.com/errors/upload",
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

    return withUploadLock(userId, async () => {
      if (storageMode === "s3") {
        const bucket = process.env.S3_BUCKET;
        if (!bucket) {
          throw new ApiError(
            500,
            "https://canvascollect.com/errors/upload-storage",
            "Upload storage misconfigured",
            "S3_BUCKET is not configured",
          );
        }

        const key = `uploads/${safeUserId}/${uniqueFilename}`;
        const keyPrefix = `uploads/${safeUserId}/`;
        const client = getS3Client();
        const usage = await getS3Usage(client, bucket, keyPrefix);

        if (usage.fileCount >= MAX_FILES_PER_USER) {
          throw new ApiError(
            400,
            "https://canvascollect.com/errors/upload",
            "Bad Request",
            "Upload limit reached for this account",
          );
        }

        if (usage.totalBytes + buffer.length > MAX_TOTAL_BYTES_PER_USER) {
          throw new ApiError(
            400,
            "https://canvascollect.com/errors/upload",
            "Bad Request",
            "Storage quota exceeded for this account",
          );
        }

        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: detectedType.mime,
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );

        return NextResponse.json({
          url: buildPublicUrl(key),
          filename: file.name,
          size: file.size,
          type: detectedType.mime,
          storage: "s3",
        });
      }

      if (process.env.NODE_ENV === "production") {
        throw new ApiError(
          500,
          "https://canvascollect.com/errors/upload-storage",
          "Upload storage misconfigured",
          "Local uploads are development-only. Configure S3-compatible storage in production.",
        );
      }

      const uploadRoot = resolve(join(process.cwd(), "public", "uploads"));
      const uploadDir = resolve(join(uploadRoot, safeUserId));
      const filePath = resolve(uploadDir, uniqueFilename);

      const uploadPrefix = uploadDir.endsWith(sep)
        ? uploadDir
        : uploadDir + sep;
      if (!filePath.startsWith(uploadPrefix)) {
        throw new ApiError(
          400,
          "https://canvascollect.com/errors/upload",
          "Bad Request",
          "Invalid upload path",
        );
      }

      await mkdir(uploadDir, { recursive: true });

      const usage = await getDirectoryUsage(uploadDir);
      if (usage.fileCount >= MAX_FILES_PER_USER) {
        throw new ApiError(
          400,
          "https://canvascollect.com/errors/upload",
          "Bad Request",
          "Upload limit reached for this account",
        );
      }

      if (usage.totalBytes + buffer.length > MAX_TOTAL_BYTES_PER_USER) {
        throw new ApiError(
          400,
          "https://canvascollect.com/errors/upload",
          "Bad Request",
          "Storage quota exceeded for this account",
        );
      }

      await writeFile(filePath, buffer);

      const publicUrl = `/uploads/${safeUserId}/${uniqueFilename}`;

      return NextResponse.json({
        url: publicUrl,
        filename: file.name,
        size: file.size,
        type: detectedType.mime,
        storage: "local",
      });
    });
  });
});
