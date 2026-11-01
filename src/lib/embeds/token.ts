/**
 * Signed embed tokens
 *
 * Format: `<random>.<signature>` where signature is an HMAC-SHA256 over the
 * random part, keyed from AUTH_SECRET with a purpose prefix. The signature lets
 * the server discard forged tokens without a database read; the database stores
 * only the SHA-256 digest of the full token and remains the authority for
 * expiry and revocation.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/;

function getSigningKey(): Buffer {
  return createHash("sha256")
    .update(`memoria-embed-token:${env.AUTH_SECRET}`)
    .digest();
}

function sign(random: string): string {
  return createHmac("sha256", getSigningKey())
    .update(random)
    .digest("base64url");
}

export function digestEmbedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createEmbedToken(): { token: string; digest: string } {
  const random = randomBytes(24).toString("base64url");
  const token = `${random}.${sign(random)}`;
  return { token, digest: digestEmbedToken(token) };
}

/** True only for tokens this server signed; does not check the database. */
export function verifyEmbedTokenSignature(token: string): boolean {
  if (!TOKEN_PATTERN.test(token)) return false;
  const [random, signature] = token.split(".") as [string, string];
  const expected = Buffer.from(sign(random));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
