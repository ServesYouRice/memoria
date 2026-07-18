import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { env } from "@/lib/env";

// SEC-24: model credentials are encrypted with a dedicated, versioned key.
// The current key version is tagged into every payload so the key can be
// rotated later without a data migration (older payloads keep their tag and
// are decrypted with the matching key). Today only "v1" exists.
const CURRENT_KEY_VERSION = "v1";

function getEncryptionKey(version: string = CURRENT_KEY_VERSION) {
  if (version !== CURRENT_KEY_VERSION) {
    throw new Error(`Unknown model credential key version: ${version}`);
  }

  const dedicatedKey = env.MODEL_CREDENTIAL_ENCRYPTION_KEY;
  if (!dedicatedKey) {
    // Production always has a dedicated key (enforced in env.ts). Falling back
    // to AUTH_SECRET is a dev/test-only convenience and must never ship.
    if (env.NODE_ENV === "production") {
      throw new Error(
        "MODEL_CREDENTIAL_ENCRYPTION_KEY is required to encrypt model credentials",
      );
    }
    return createHash("sha256").update(env.AUTH_SECRET).digest();
  }

  return createHash("sha256").update(dedicatedKey).digest();
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getEncryptionKey(CURRENT_KEY_VERSION),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    CURRENT_KEY_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");

  // Versioned payloads are "<version>.<iv>.<tag>.<ciphertext>"; legacy payloads
  // written before SEC-24 are the unversioned "<iv>.<tag>.<ciphertext>" and use
  // the current key.
  let version = CURRENT_KEY_VERSION;
  let ivPart: string | undefined;
  let tagPart: string | undefined;
  let encryptedPart: string | undefined;

  if (parts.length === 4) {
    [version, ivPart, tagPart, encryptedPart] = parts;
  } else if (parts.length === 3) {
    [ivPart, tagPart, encryptedPart] = parts;
  }

  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Invalid encrypted secret payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(version),
    Buffer.from(ivPart, "base64"),
  );

  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function fingerprintSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
