import { unlink } from "fs/promises";
import { join, resolve, sep } from "path";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
