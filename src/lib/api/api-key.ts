/**
 * API Key Utilities
 *
 * Provides secure API key generation and verification using Argon2id hashing.
 *
 * SECURITY: API keys are hashed at rest using Argon2id. The plaintext key
 * is only shown once during creation and cannot be recovered.
 *
 * Design:
 * - Keys are prefixed with 'mk_' for easy identification
 * - Keys consist of 32 random alphanumeric characters after the prefix
 * - Keys are hashed using Argon2id before storage
 * - Verification uses timing-safe comparison via argon2.verify
 */

import * as argon2 from "argon2";
import { randomBytes } from "crypto";

const API_KEY_PREFIX = "mk_"; // Memoria Key
const API_KEY_LENGTH = 32; // Characters after prefix

/**
 * Generate a new API key
 * @returns Object containing the plaintext key (show to user once) and hash (store in DB)
 */
export async function generateApiKey(): Promise<{ key: string; hash: string }> {
  // Generate random alphanumeric key
  const randomPart = randomBytes(API_KEY_LENGTH)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, API_KEY_LENGTH);

  const plaintextKey = `${API_KEY_PREFIX}${randomPart}`;

  // Hash the key for storage
  const hash = await argon2.hash(plaintextKey, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB - lower than password hashing for performance
    timeCost: 2,
    parallelism: 1,
  });

  return { key: plaintextKey, hash };
}

/**
 * Verify an API key against a stored hash
 * Uses timing-safe comparison to prevent timing attacks
 *
 * @param key - The plaintext API key to verify
 * @param hash - The stored hash to verify against
 * @returns True if the key matches the hash
 */
export async function verifyApiKey(
  key: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, key);
  } catch {
    // argon2.verify throws on invalid hashes
    return false;
  }
}

/**
 * Check if a string looks like a valid API key format
 * This is a quick pre-check before doing expensive hash verification
 */
export function isValidApiKeyFormat(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) {
    return false;
  }

  const keyPart = key.slice(API_KEY_PREFIX.length);
  if (keyPart.length < 20) {
    // Minimum reasonable length
    return false;
  }

  // Should only contain alphanumeric characters
  return /^[a-zA-Z0-9]+$/.test(keyPart);
}

/**
 * Get a masked version of the key for display
 * Shows first 7 chars (mk_XXX) and last 4 chars
 */
export function maskApiKey(key: string): string {
  if (key.length <= 11) {
    return key.slice(0, 3) + "***";
  }
  return key.slice(0, 7) + "..." + key.slice(-4);
}
