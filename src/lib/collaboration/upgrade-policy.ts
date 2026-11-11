/**
 * WebSocket upgrade admission shared by the presence socket and the sync
 * server (IMP-042): browser origin and client identity. Server-only.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { IncomingMessage } from "http";
import { deriveClientIp } from "@/lib/network/client-ip";

/**
 * Set by the app server (server.ts) on the collaboration upgrades it proxies
 * to the realtime process: the client address it derived with its own
 * trusted-proxy rules, signed with COLLABORATION_PROXY_SECRET. The proxied
 * TCP peer is the app server itself, so without this every proxied browser
 * would share one identity.
 */
export const UPGRADE_CLIENT_IP_HEADER = "x-memoria-upgrade-client-ip";
/** A signed identity is accepted for this long, bounding replay. */
const UPGRADE_CLIENT_IP_MAX_AGE_MS = 60_000;

function upgradeSignature(secret: string, issuedAt: string, ip: string) {
  return createHmac("sha256", secret)
    .update(`${issuedAt}.${ip}`)
    .digest("base64url");
}

/** `<issuedAt>.<signature>.<ip>` for UPGRADE_CLIENT_IP_HEADER. */
export function signUpgradeClientIp(
  ip: string,
  secret: string,
  now = Date.now(),
): string {
  const issuedAt = String(now);
  return `${issuedAt}.${upgradeSignature(secret, issuedAt, ip)}.${ip}`;
}

function verifiedUpgradeClientIp(
  value: string | string[] | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (typeof value !== "string") return null;
  const first = value.indexOf(".");
  const second = value.indexOf(".", first + 1);
  if (first <= 0 || second <= first + 1) return null;
  const issuedAt = value.slice(0, first);
  const signature = value.slice(first + 1, second);
  const ip = value.slice(second + 1);
  const issued = Number(issuedAt);
  if (
    !ip ||
    !/^\d+$/.test(issuedAt) ||
    Math.abs(now - issued) > UPGRADE_CLIENT_IP_MAX_AGE_MS
  )
    return null;
  const expected = Buffer.from(upgradeSignature(secret, issuedAt, ip));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? ip
    : null;
}

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
// x-memoria-client-ip, so derive identity here with the same trusted-proxy
// rules, or take it from the app server's signed header when it proxied the
// upgrade. Without COLLABORATION_PROXY_SECRET the header is ignored, so a
// direct connection can never claim an identity through it.
export function deriveUpgradeClientId(
  request: Pick<IncomingMessage, "socket" | "headers">,
): string {
  const secret = process.env.COLLABORATION_PROXY_SECRET;
  if (secret) {
    const signed = verifiedUpgradeClientIp(
      request.headers[UPGRADE_CLIENT_IP_HEADER],
      secret,
    );
    if (signed) return signed;
  }
  return deriveClientIp(
    request.socket?.remoteAddress,
    request.headers["x-forwarded-for"],
    process.env.TRUSTED_PROXY_CIDRS,
  );
}

/**
 * On the app server, before proxying a collaboration upgrade: drop any
 * caller-supplied copy of the identity header and, when a secret is set, add
 * the signed address derived with this process's trusted-proxy rules. The
 * proxy replays `rawHeaders`, so both views are updated.
 */
export function stampUpgradeClientIp(
  request: Pick<IncomingMessage, "socket" | "headers" | "rawHeaders">,
  secret: string | undefined,
  now = Date.now(),
): void {
  delete request.headers[UPGRADE_CLIENT_IP_HEADER];
  const raw = request.rawHeaders;
  for (let index = raw.length - 2; index >= 0; index -= 2) {
    if (raw[index]!.toLowerCase() === UPGRADE_CLIENT_IP_HEADER)
      raw.splice(index, 2);
  }
  if (!secret) return;
  const ip = deriveClientIp(
    request.socket?.remoteAddress,
    request.headers["x-forwarded-for"],
    process.env.TRUSTED_PROXY_CIDRS,
  );
  const value = signUpgradeClientIp(ip, secret, now);
  request.headers[UPGRADE_CLIENT_IP_HEADER] = value;
  raw.push(UPGRADE_CLIENT_IP_HEADER, value);
}
