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
