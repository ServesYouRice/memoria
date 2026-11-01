// Plain .mjs so both the app and Node scripts (scripts/lib/runtime.mjs) share
// one S3 client factory.
import { S3Client } from "@aws-sdk/client-s3";

/**
 * @typedef {object} S3ClientConfig
 * @property {string} region
 * @property {string} [endpoint]
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 */

/** @param {string | undefined} endpoint */
export function isR2Endpoint(endpoint) {
  if (!endpoint) return false;
  try {
    return new URL(endpoint).hostname.endsWith(".r2.cloudflarestorage.com");
  } catch {
    return false;
  }
}

/**
 * Single S3 client factory. Checksums are only sent or validated when an
 * operation requires them because Cloudflare R2 rejects the SDK's default
 * CRC32 trailers on some operations. R2 requires region "auto"; other custom
 * endpoints (SeaweedFS, MinIO) need path-style addressing.
 *
 * @param {S3ClientConfig} config
 * @returns {S3Client}
 */
export function createS3Client(config) {
  const r2 = isR2Endpoint(config.endpoint);
  return new S3Client({
    region: r2 ? "auto" : config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint) && !r2,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
