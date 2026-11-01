/**
 * WebSocket upgrade admission shared by the presence socket and the sync
 * server (IMP-042): browser origin and client identity. Server-only.
 */

import type { IncomingMessage } from "http";
import { deriveClientIp } from "@/lib/network/client-ip";

export function isAllowedCollaborationOrigin(
  origin: string | undefined,
  configuredUrl: string | undefined,
): boolean {
  if (!origin || !configuredUrl) return false;
  try {
    return new URL(origin).origin === new URL(configuredUrl).origin;
  } catch {
    return false;
  }
}

// Upgrade requests bypass the HTTP request handler that stamps
// x-memoria-client-ip, so derive identity here with the same trusted-proxy rules.
export function deriveUpgradeClientId(
  request: Pick<IncomingMessage, "socket" | "headers">,
): string {
  return deriveClientIp(
    request.socket?.remoteAddress,
    request.headers["x-forwarded-for"],
    process.env.TRUSTED_PROXY_CIDRS,
  );
}
