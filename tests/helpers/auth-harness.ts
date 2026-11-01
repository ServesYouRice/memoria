/**
 * Test-only helpers for driving Better Auth over HTTP (IMP-041): a cookie
 * jar, an RFC 6238 TOTP generator, and a software WebAuthn authenticator that
 * produces real ES256 attestations and assertions.
 */

import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign as signData,
  type KeyObject,
} from "node:crypto";

export const TEST_ORIGIN = "http://localhost:3000";

type AuthHandler = (request: Request) => Promise<Response>;

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  header(): string {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join(
      "; ",
    );
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  names(): string[] {
    return Array.from(this.cookies.keys());
  }

  store(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => {
        const [key, attributeValue] = attribute.trim().split("=");
        return key.toLowerCase() === "max-age" && Number(attributeValue) <= 0;
      });
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

export interface CallOptions {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Call `/api/auth${path}` through the real handler and keep its cookies. */
export async function callAuth(
  handler: AuthHandler,
  jar: CookieJar,
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; body: any; response: Response }> {
  const url = new URL(`/api/auth${path}`, TEST_ORIGIN);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const method = options.method ?? (options.body ? "POST" : "GET");
  const headers = new Headers({
    origin: TEST_ORIGIN,
    "x-memoria-client-ip": "203.0.113.10",
    ...options.headers,
  });
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  if (options.body !== undefined)
    headers.set("content-type", "application/json");
  const response = await handler(
    new Request(url, {
      method,
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
  );
  jar.store(response);
  const text = await response.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON bodies (404 "Not Found") stay as text.
  }
  return { status: response.status, body, response };
}

// --- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ---------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpFromUri(totpURI: string, at = Date.now()): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) throw new Error("TOTP URI has no secret");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

// --- Minimal CBOR encoder (enough for WebAuthn) -----------------------------

type CborValue =
  number | string | Uint8Array | CborValue[] | Map<number | string, CborValue>;

function cborHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    const buffer = Buffer.alloc(3);
    buffer[0] = (major << 5) | 25;
    buffer.writeUInt16BE(length, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = (major << 5) | 26;
  buffer.writeUInt32BE(length, 1);
  return buffer;
}

export function cborEncode(value: CborValue): Buffer {
  if (typeof value === "number") {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([cborHead(2, value.length), Buffer.from(value)]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([
      cborHead(4, value.length),
      ...value.map((item) => cborEncode(item)),
    ]);
  }
  const parts: Buffer[] = [cborHead(5, value.size)];
  for (const [key, item] of value) {
    parts.push(cborEncode(key), cborEncode(item));
  }
  return Buffer.concat(parts);
}

// --- Software authenticator ----------------------------------------------------

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

export class SoftwarePasskey {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private signCount = 0;

  constructor(
    private readonly rpId = "localhost",
    private readonly origin = TEST_ORIGIN,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.publicJwk = { x: jwk.x!, y: jwk.y! };
  }

  private rpIdHash(): Buffer {
    return createHash("sha256").update(this.rpId).digest();
  }

  private flags(userVerified: boolean, attested = false): number {
    return (
      FLAG_USER_PRESENT |
      (userVerified ? FLAG_USER_VERIFIED : 0) |
      (attested ? FLAG_ATTESTED_CREDENTIAL : 0)
    );
  }

  private counter(): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(this.signCount);
    return buffer;
  }

  /** A `none`-attestation registration response for the given options. */
  register(
    options: { challenge: string },
    { userVerified = true }: { userVerified?: boolean } = {},
  ) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const cosePublicKey = cborEncode(
      new Map<number, CborValue>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(this.publicJwk.x, "base64url")],
        [-3, Buffer.from(this.publicJwk.y, "base64url")],
      ]),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      this.rpIdHash(),
      Buffer.from([this.flags(userVerified, true)]),
      this.counter(),
      Buffer.alloc(16), // AAGUID
      idLength,
      this.credentialId,
      cosePublicKey,
    ]);
    const attestationObject = cborEncode(
      new Map<string, CborValue>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  /** An ES256 assertion for the given authentication options. */
  authenticate(
    options: { challenge: string },
    { userVerified = true }: { userVerified?: boolean } = {},
  ) {
    this.signCount += 1;
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const authenticatorData = Buffer.concat([
      this.rpIdHash(),
      Buffer.from([this.flags(userVerified)]),
      this.counter(),
    ]);
    const signature = signData(
      "sha256",
      Buffer.concat([
        authenticatorData,
        createHash("sha256").update(clientDataJSON).digest(),
      ]),
      this.privateKey,
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
    };
  }
}
