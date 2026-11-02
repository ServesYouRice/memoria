/**
 * Signed image proxy URLs for viewers without a session (IMP-057)
 *
 * The image proxy serves signed-in users for any remote URL. Embed and public
 * share viewers have no session, so the server rewrites the remote image URLs
 * of the items it hands them into proxy URLs carrying an HMAC over the exact
 * remote URL. The proxy accepts that signature in place of a session, so it is
 * never an open relay: only URLs the server itself put in front of a viewer
 * can be fetched anonymously.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { ItemType } from "@/types/canvas";
import {
  buildImageProxyPath,
  IMAGE_PROXY_MAX_URL_LENGTH,
  isRemoteHttpUrl,
} from "./proxy-url";

const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function getSigningKey(): Buffer {
  return createHash("sha256")
    .update(`memoria-image-proxy:${env.AUTH_SECRET}`)
    .digest();
}

export function signImageProxyUrl(url: string): string {
  return createHmac("sha256", getSigningKey()).update(url).digest("base64url");
}

export function verifyImageProxySignature(
  url: string,
  signature: string | null | undefined,
): boolean {
  if (!signature || !SIGNATURE_PATTERN.test(signature)) return false;
  const expected = Buffer.from(signImageProxyUrl(url));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A signed proxy path for a remote URL; any other value is returned as is. */
export function toSignedImageProxyUrl(value: unknown): unknown {
  if (
    typeof value !== "string" ||
    value.length > IMAGE_PROXY_MAX_URL_LENGTH ||
    !isRemoteHttpUrl(value)
  ) {
    return value;
  }
  return buildImageProxyPath(value, signImageProxyUrl(value));
}

const IMAGE_FIELDS: Partial<Record<string, readonly string[]>> = {
  [ItemType.IMAGE]: ["url"],
  [ItemType.BOOKMARK]: ["favicon", "previewImage"],
};

/**
 * Rewrite the remote image URLs of read-only items (embed, public share) into
 * signed proxy URLs. Bookmark target URLs are links, not images, and stay.
 */
export function withSignedImageProxyUrls<
  T extends { type: string; content: unknown },
>(items: T[]): T[] {
  return items.map((item) => {
    const fields = IMAGE_FIELDS[item.type];
    const content = item.content;
    if (!fields || !content || typeof content !== "object") return item;

    let rewritten: Record<string, unknown> | null = null;
    for (const field of fields) {
      const value = (content as Record<string, unknown>)[field];
      const signed = toSignedImageProxyUrl(value);
      if (signed !== value) {
        rewritten ??= { ...(content as Record<string, unknown>) };
        rewritten[field] = signed;
      }
    }
    return rewritten ? { ...item, content: rewritten } : item;
  });
}
