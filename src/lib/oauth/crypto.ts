import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

export const OAUTH_ACCESS_TOKEN_PREFIX = "moa_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "mor_";
const AUTHORIZATION_CODE_PREFIX = "moc_";
const CLIENT_SECRET_PREFIX = "mcs_";

function randomToken(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

/** Tokens carry 256 bits of entropy, so an unsalted digest is a safe lookup key. */
export function hashOAuthSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function generateAccessToken() {
  return randomToken(OAUTH_ACCESS_TOKEN_PREFIX);
}

export function generateRefreshToken() {
  return randomToken(OAUTH_REFRESH_TOKEN_PREFIX);
}

export function generateAuthorizationCode() {
  return randomToken(AUTHORIZATION_CODE_PREFIX);
}

export function generateClientSecret() {
  return randomToken(CLIENT_SECRET_PREFIX);
}

export function generateClientId() {
  return `mcp_${randomBytes(18).toString("base64url")}`;
}

/** RFC 7636 S256: BASE64URL(SHA256(code_verifier)) must equal the challenge. */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    return false;
  }

  const derived = createHash("sha256").update(codeVerifier).digest("base64url");
  return safeEqual(derived, codeChallenge);
}

function getSigningKey() {
  return createHash("sha256")
    .update(`memoria-oauth-consent:${env.AUTH_SECRET}`)
    .digest();
}

/** Signs a JSON payload so the consent form cannot be replayed with edits. */
export function signConsentTicket(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSigningKey())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyConsentTicket(ticket: string): unknown {
  const [body, signature, extra] = ticket.split(".");
  if (!body || !signature || extra !== undefined) {
    return null;
  }

  const expected = createHmac("sha256", getSigningKey())
    .update(body)
    .digest("base64url");
  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
