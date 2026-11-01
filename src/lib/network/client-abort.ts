/**
 * Node emits `Error: aborted` (code ECONNRESET) on an IncomingMessage whose
 * client closed the socket before the request body was consumed, for example a
 * browser dropping a CSP report beacon or a frame navigation that the browser
 * itself blocked. When no handler consumed the stream, nothing listens for the
 * error and it surfaces as an uncaught exception. It describes a departed
 * client, not a corrupt server, so it must not take the process down.
 */
export function isClientAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ECONNRESET" && error.message === "aborted";
}
