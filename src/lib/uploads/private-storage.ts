import { createReadStream } from "fs";
import { unlink, stat } from "fs/promises";
import { join, resolve, sep } from "path";
import { Readable } from "stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

function getS3Client() {
  if (s3Client) return s3Client;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("Private upload storage is not configured");
  }
  s3Client = new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Client;
}

function getLocalPath(storageKey: string) {
  const root = resolve(join(process.cwd(), ".data", "uploads"));
  const relativeKey = storageKey.replace(/^uploads[\\/]/, "");
  const target = resolve(join(root, relativeKey));
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(prefix)) {
    throw new Error("Invalid private upload storage key");
  }
  return target;
}

export interface PrivateUploadRead {
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
  etag: string;
}

export async function readPrivateUploadObject(
  storageMode: string,
  storageKey: string,
): Promise<PrivateUploadRead> {
  if (storageMode === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("Private upload bucket is not configured");
    const object = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
    if (!object.Body) throw new Error("Private upload object body is missing");
    return {
      body: object.Body.transformToWebStream(),
      contentLength: object.ContentLength,
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
    etag: `W/\"${metadata.size.toString(16)}-${Math.trunc(metadata.mtimeMs).toString(16)}\"`,
  };
}

export async function deletePrivateUploadObject(
  storageMode: string,
  storageKey: string,
) {
  if (storageMode === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("Private upload bucket is not configured");
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
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
    if (process.env.NODE_ENV === "production") {
      throw new Error("Production private upload storage is not configured");
    }
    return;
  }

  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("Private upload bucket is not configured");
  await getS3Client().send(new HeadBucketCommand({ Bucket: bucket }));
}
