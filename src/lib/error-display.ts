/**
 * Client-safe helpers for rendering caught errors.
 *
 * Error boundaries catch exceptions thrown during render. Those messages are
 * internal — stack text, Prisma or driver strings, third-party assertions — and
 * are never written for an end user, so no boundary should echo one into the
 * DOM. Boundaries render their own fixed copy instead and surface only the
 * digest, which is the correlation id that Next.js attaches to a server error
 * and that also appears in the server log.
 *
 * User-facing failures that carry a message worth reading (a failed upload, a
 * rejected AI request) are caught where they happen and rendered by that
 * component; they do not reach a boundary.
 */

interface ErrorWithDigest {
  digest?: string;
}

/**
 * Returns the Next.js error digest when one is present.
 */
export function getErrorDigest(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const digest = (error as ErrorWithDigest).digest;
  return typeof digest === "string" && digest.length > 0 ? digest : undefined;
}
