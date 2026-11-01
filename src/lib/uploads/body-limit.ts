/**
 * Bounded request-body reads.
 *
 * `request.formData()` and `request.clone().arrayBuffer()` buffer the whole
 * body before any size check runs, and the Node server (and the k3s ingress,
 * which has no Caddy in front) imposes no cap of its own. These helpers
 * enforce the cap first: a declared Content-Length over the limit is rejected
 * without reading a byte, and chunked or lying bodies are cut off by a
 * streaming byte counter as soon as the limit is crossed.
 */

import { NextRequest } from "next/server";

import { ApiError } from "@/lib/errors";

export function payloadTooLarge(maxBytes: number): ApiError {
  return new ApiError(
    413,
    "https://memoria.local/errors/payload-too-large",
    "Payload Too Large",
    `Request body exceeds the maximum allowed size of ${maxBytes} bytes`,
  );
}

/**
 * Read the request body into memory, throwing a 413 ApiError as soon as it
 * exceeds `maxBytes`. Returns an empty buffer for body-less requests.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      throw new ApiError(
        400,
        "https://memoria.local/errors/upload",
        "Bad Request",
        "Invalid Content-Length header",
      );
    }
    if (length > maxBytes) {
      // Do not read the body; release the stream so the socket can close.
      await request.body?.cancel().catch(() => {});
      throw payloadTooLarge(maxBytes);
    }
  }

  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw payloadTooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Return a request equivalent to `request` whose body has already been read
 * under the size cap. Safe to hand to `formData()` and to idempotency
 * hashing (`clone().arrayBuffer()`), which then buffer at most `maxBytes`.
 */
export async function boundRequestBody(
  request: NextRequest,
  maxBytes: number,
): Promise<NextRequest> {
  const bytes = await readBodyWithLimit(request, maxBytes);
  const headers = new Headers(request.headers);
  headers.set("content-length", String(bytes.byteLength));
  return new NextRequest(request.url, {
    method: request.method,
    headers,
    body: bytes.byteLength > 0 ? Buffer.from(bytes) : undefined,
  });
}
