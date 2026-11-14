// Dependency-free so the request proxy (CSP) can use it without loading the
// AWS SDK; s3-client.mjs re-exports it.

/** @param {string | undefined} endpoint */
export function isR2Endpoint(endpoint) {
  if (!endpoint) return false;
  try {
    return new URL(endpoint).hostname.endsWith(".r2.cloudflarestorage.com");
  } catch {
    return false;
  }
}
