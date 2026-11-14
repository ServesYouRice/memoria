/**
 * Browser side of direct uploads (IMP-152): presign, PUT to storage,
 * confirm. Returns the confirm response, which has the same shape as
 * `/api/v1/upload`, so callers handle both paths alike.
 *
 * Falls back to the proxied upload (`fallback`) when the server has no
 * direct path (local-disk storage) or when the PUT cannot reach storage
 * and the file fits the proxied route's cap.
 */

const DIRECT_UNAVAILABLE =
  "https://memoria.local/errors/direct-upload-unavailable";

/** The proxied route's cap for images (`/api/v1/upload`). */
export const PROXIED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Learned once per page load: a server without direct uploads keeps that.
let directUnavailable = false;

/** Test seam. */
export function resetDirectUploadClientState() {
  directUnavailable = false;
}

interface PresignResponse {
  assetId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
}

export async function uploadFileDirect(
  file: File,
  options: {
    canvasId: string;
    /** The proxied upload, used when the direct path is not available. */
    fallback: () => Promise<Response>;
    /** The largest file the fallback accepts. */
    fallbackMaxBytes: number;
  },
): Promise<Response> {
  if (directUnavailable) return options.fallback();

  const presign = await fetch("/api/v1/upload/direct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      canvasId: options.canvasId,
      filename: file.name || "upload",
      contentType: file.type,
      size: file.size,
    }),
  });
  if (presign.status === 409 || presign.status === 404) {
    const problem = (await presign
      .clone()
      .json()
      .catch(() => null)) as { type?: string } | null;
    if (presign.status === 404 || problem?.type === DIRECT_UNAVAILABLE) {
      directUnavailable = true;
      return options.fallback();
    }
  }
  // An unsupported type (validation) still goes through the proxied route,
  // which answers with its own messages for wrong formats.
  if (presign.status === 400 && file.size <= options.fallbackMaxBytes) {
    return options.fallback();
  }
  if (!presign.ok) return presign;

  const target = (await presign.json()) as PresignResponse;
  let stored: Response;
  try {
    stored = await fetch(target.uploadUrl, {
      method: target.method,
      headers: target.headers,
      body: file,
    });
  } catch (error) {
    // Storage unreachable (network, or a bucket without CORS for this
    // origin). The reservation expires on its own.
    if (file.size <= options.fallbackMaxBytes) return options.fallback();
    throw error;
  }
  if (!stored.ok) {
    if (file.size <= options.fallbackMaxBytes) return options.fallback();
    throw new Error("The file could not be uploaded to storage.");
  }

  return fetch("/api/v1/upload/direct/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId: target.assetId }),
  });
}
