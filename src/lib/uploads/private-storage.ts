import { createReadStream, createWriteStream } from "fs";
import { mkdir, unlink, stat, writeFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createS3Client } from "./s3-client.mjs";

let s3Client: S3Client | null = null;

function getS3Client() {
  if (s3Client) return s3Client;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("Private upload storage is not configured");
  }
  s3Client = createS3Client({
    region,
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId,
    secretAccessKey,
  });
  return s3Client;
}

/**
 * Where local uploads live: UPLOAD_LOCAL_DIR (the small set-up's mounted
 * folder, IMP-100), else `.data/uploads` for development.
 */
export function localUploadRoot() {
  const configured = process.env.UPLOAD_LOCAL_DIR?.trim();
  return resolve(configured || join(process.cwd(), ".data", "uploads"));
}

/** Production keeps uploads on disk only when a folder was chosen for it. */
export function localUploadsAllowed() {
  return (
    process.env.NODE_ENV !== "production" ||
    Boolean(process.env.UPLOAD_LOCAL_DIR?.trim())
  );
}

function getLocalPath(storageKey: string) {
  const root = localUploadRoot();
  const relativeKey = storageKey.replace(/^uploads[\\/]/, "");
  const target = resolve(join(root, relativeKey));
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(prefix)) {
    throw new Error("Invalid private upload storage key");
  }
  return target;
}

export async function writePrivateUploadObject(
  storageMode: string,
  storageKey: string,
  body: Uint8Array,
  contentType: string,
  signal?: AbortSignal,
) {
  if (storageMode === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("Private upload bucket is not configured");
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: body,
        ContentType: contentType,
        CacheControl: "private, max-age=86400, immutable",
      }),
      { abortSignal: signal },
    );
    return;
  }
  const localPath = getLocalPath(storageKey);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, body);
}

export async function writePrivateUploadStream(
  storageMode: string,
  storageKey: string,
  body: Readable,
  contentType: string,
  contentLength: number,
  signal?: AbortSignal,
) {
  if (storageMode === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("Private upload bucket is not configured");
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: body,
        ContentLength: contentLength,
        ContentType: contentType,
        CacheControl: "private, no-store",
      }),
      { abortSignal: signal },
    );
    return;
  }
  const localPath = getLocalPath(storageKey);
  await mkdir(dirname(localPath), { recursive: true });
  await pipeline(body, createWriteStream(localPath), { signal });
}

export interface PrivateUploadRead {
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType?: string;
  etag: string;
}

export async function readPrivateUploadObject(
  storageMode: string,
  storageKey: string,
  signal?: AbortSignal,
): Promise<PrivateUploadRead> {
  signal?.throwIfAborted();
  if (storageMode === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("Private upload bucket is not configured");
    const object = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
      { abortSignal: signal },
    );
    if (!object.Body) throw new Error("Private upload object body is missing");
    return {
      body: object.Body.transformToWebStream(),
      contentLength: object.ContentLength,
      contentType: object.ContentType,
      etag: object.ETag || `W/\"${encodeURIComponent(storageKey)}\"`,
    };
  }

  const localPath = getLocalPath(storageKey);
  const metadata = await stat(localPath);
  return {
    body: Readable.toWeb(
      createReadStream(localPath),
    ) as ReadableStream<Uint8Array>,
    contentLength: metadata.size,
    contentType: storageKey.endsWith(".png")
      ? "image/png"
      : storageKey.endsWith(".webp")
        ? "image/webp"
        : storageKey.endsWith(".jpg") || storageKey.endsWith(".jpeg")
          ? "image/jpeg"
          : undefined,
    etag: `W/\"${metadata.size.toString(16)}-${Math.trunc(metadata.mtimeMs).toString(16)}\"`,
  };
}

export async function deletePrivateUploadObject(
  storageMode: string,
  storageKey: string,
  signal?: AbortSignal,
) {
  if (storageMode === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("Private upload bucket is not configured");
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
      { abortSignal: signal },
    );
    return;
  }

  await unlink(getLocalPath(storageKey)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}

export async function checkPrivateUploadStorage(): Promise<void> {
  if (process.env.UPLOAD_STORAGE !== "s3") {
    if (!localUploadsAllowed()) {
      throw new Error("Production private upload storage is not configured");
    }
    if (process.env.UPLOAD_LOCAL_DIR?.trim()) {
      // The folder must exist and take writes (a mounted, writable volume).
      const root = localUploadRoot();
      await mkdir(root, { recursive: true });
      const probe = join(root, `.ready-${process.pid}-${Date.now()}`);
      await writeFile(probe, "ok");
      await unlink(probe);
    }
    return;
  }

  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("Private upload bucket is not configured");
  await getS3Client().send(new HeadBucketCommand({ Bucket: bucket }));
}
