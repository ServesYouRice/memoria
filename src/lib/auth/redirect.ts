export function safeAuthCallbackUrl(
  callbackUrl: string | null | undefined,
  origin: string,
): string {
  if (!callbackUrl) return origin;
  try {
    const candidate = new URL(callbackUrl, origin);
    return candidate.origin === origin ? candidate.toString() : origin;
  } catch {
    return origin;
  }
}

/**
 * The same-origin path (with query and hash) to navigate to after sign-in.
 * A same-origin URL such as `https://origin//attacker.example/x` has the
 * pathname `//attacker.example/x`, which a client router reads as a
 * protocol-relative external URL, so such paths fall back too.
 */
export function toSafeCallbackPath(
  callbackUrl: string | null | undefined,
  origin: string,
  fallback: string,
): string {
  if (!callbackUrl) return fallback;
  try {
    const candidate = new URL(callbackUrl, origin);
    if (candidate.origin !== origin) return fallback;
    const path = candidate.pathname + candidate.search + candidate.hash;
    if (!path.startsWith("/") || /^\/[/\\]/.test(path)) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
