/**
 * Direct browser uploads (IMP-152): configuration shared by the presign and
 * confirm routes and the CSP. Dependency-free so the request proxy can read
 * it without loading the AWS SDK.
 *
 * - `UPLOAD_STORAGE=s3` turns direct uploads on; local-disk storage (the
 *   small set-up's `UPLOAD_LOCAL_DIR`) keeps the proxied upload route only.
 * - `UPLOAD_DIRECT_UPLOADS=false` switches them off with S3 (for a bucket
 *   whose CORS rules do not allow the app's origin yet).
 * - `UPLOAD_DIRECT_MAX_BYTES` caps one direct upload (default 25 MB).
 * - `S3_PUBLIC_ENDPOINT` is the endpoint browsers reach when `S3_ENDPOINT`
 *   is an in-cluster or container address; it defaults to `S3_ENDPOINT`.
 */
import { isR2Endpoint } from "./s3-endpoint.mjs";

export const DEFAULT_DIRECT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export function directUploadsEnabled(): boolean {
  return (
    process.env.UPLOAD_STORAGE === "s3" &&
    process.env.UPLOAD_DIRECT_UPLOADS !== "false"
  );
}

export function directUploadMaxBytes(): number {
  const configured = Number(process.env.UPLOAD_DIRECT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_DIRECT_UPLOAD_MAX_BYTES;
}

/** The S3 endpoint presigned URLs name: the browser-facing one if set. */
export function directUploadEndpoint(): string | undefined {
  return (
    process.env.S3_PUBLIC_ENDPOINT?.trim() ||
    process.env.S3_ENDPOINT?.trim() ||
    undefined
  );
}

/**
 * The origin presigned upload URLs point at, for CSP `connect-src`. It
 * mirrors the S3 client's addressing (createS3Client): R2 and AWS use
 * virtual-hosted buckets, other custom endpoints (SeaweedFS, MinIO) are
 * path-style. Null when direct uploads are off or storage is incomplete.
 */
export function directUploadOrigin(): string | null {
  if (!directUploadsEnabled()) return null;
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) return null;
  const endpoint = directUploadEndpoint();
  if (!endpoint) {
    const region = process.env.S3_REGION?.trim();
    return region ? `https://${bucket}.s3.${region}.amazonaws.com` : null;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return isR2Endpoint(endpoint)
    ? `${url.protocol}//${bucket}.${url.host}`
    : url.origin;
}
