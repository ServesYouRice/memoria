/**
 * Embed origin validation
 *
 * An embed's allow-list becomes the CSP `frame-ancestors` source list, so each
 * entry must be an exact origin (scheme + host [+ port]) that is safe to
 * interpolate into a header. No wildcards, paths, credentials, or `null`.
 */

export const MAX_EMBED_ORIGINS = 10;

const ORIGIN_SHAPE = /^https?:\/\/[^/?#\s@\\]+\/?$/i;
const HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export interface EmbedOriginOptions {
  /** Permit http://localhost and http://127.0.0.1 (development only). */
  allowInsecureLocalhost?: boolean;
}

export function defaultEmbedOriginOptions(): EmbedOriginOptions {
  return { allowInsecureLocalhost: process.env.NODE_ENV !== "production" };
}

/**
 * Returns the canonical origin for `input`, or null when it is not a strict
 * origin. Ports equal to the scheme default are dropped by URL normalization.
 */
export function normalizeEmbedOrigin(
  input: string,
  options: EmbedOriginOptions = defaultEmbedOriginOptions(),
): string | null {
  const raw = input.trim();
  if (!ORIGIN_SHAPE.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/") return null;

  // WHATWG URL accepts characters such as ";" and "," in special-scheme hosts.
  // Those would break out of a CSP source expression, so require plain DNS
  // labels (IDNs arrive here already punycoded) and reject wildcards.
  if (!HOSTNAME.test(url.hostname)) return null;

  if (url.protocol === "https:") return url.origin;
  if (
    url.protocol === "http:" &&
    LOCAL_HOSTS.has(url.hostname) &&
    options.allowInsecureLocalhost
  ) {
    return url.origin;
  }
  return null;
}

/**
 * Normalizes and de-duplicates a list. Returns null if any entry is invalid or
 * the list is empty/too large.
 */
export function normalizeEmbedOrigins(
  inputs: readonly string[],
  options?: EmbedOriginOptions,
): string[] | null {
  if (inputs.length === 0 || inputs.length > MAX_EMBED_ORIGINS) return null;
  const origins = new Set<string>();
  for (const input of inputs) {
    const origin = normalizeEmbedOrigin(input, options);
    if (!origin) return null;
    origins.add(origin);
  }
  return [...origins];
}
