import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as cryptoActual from "crypto";

const argon2Mock = vi.hoisted(() => ({
  hash: vi.fn(),
  verify: vi.fn(),
  argon2id: 2,
}));

const cryptoMocks = vi.hoisted(() => ({
  randomBytes: vi.fn(),
}));

vi.mock("argon2", () => ({
  hash: argon2Mock.hash,
  verify: argon2Mock.verify,
  argon2id: argon2Mock.argon2id,
}));

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof cryptoActual>();
  return {
    ...actual,
    randomBytes: (size: number, callback?: any) => {
      if (cryptoMocks.randomBytes.getMockImplementation()) {
        return cryptoMocks.randomBytes(size, callback);
      }
      return actual.randomBytes(size, callback);
    },
  };
});

import {
  generateApiKey,
  isValidApiKeyFormat,
  maskApiKey,
  verifyApiKey,
} from "@/lib/api/api-key";

describe("API Key Utilities (IMP-056)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cryptoMocks.randomBytes.mockReset();
  });

  describe("isValidApiKeyFormat", () => {
    it("accepts valid API keys with mk_ prefix and >= 20 alphanumeric chars", () => {
      expect(
        isValidApiKeyFormat("mk_1234567890abcdefghijklmnopqrstuvwxyz"),
      ).toBe(true);
      expect(isValidApiKeyFormat("mk_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456")).toBe(
        true,
      );
    });

    it("rejects keys without mk_ prefix", () => {
      expect(
        isValidApiKeyFormat("sk_1234567890abcdefghijklmnopqrstuvwxyz"),
      ).toBe(false);
      expect(isValidApiKeyFormat("1234567890abcdefghijklmnopqrstuvwxyz")).toBe(
        false,
      );
    });

    it("rejects keys that are too short (< 20 chars after prefix)", () => {
      expect(isValidApiKeyFormat("mk_short")).toBe(false);
      expect(isValidApiKeyFormat("mk_1234567890123456789")).toBe(false); // 19 chars
      expect(isValidApiKeyFormat("mk_12345678901234567890")).toBe(true); // 20 chars
    });

    it("rejects keys containing non-alphanumeric characters", () => {
      expect(isValidApiKeyFormat("mk_1234567890-abcdefghijklmnopqrstuv")).toBe(
        false,
      );
      expect(isValidApiKeyFormat("mk_1234567890_abcdefghijklmnopqrstuv")).toBe(
        false,
      );
      expect(isValidApiKeyFormat("mk_1234567890!abcdefghijklmnopqrstuv")).toBe(
        false,
      );
    });
  });

  describe("verifyApiKey", () => {
    it("returns true when argon2.verify resolves true", async () => {
      argon2Mock.verify.mockResolvedValue(true);

      const result = await verifyApiKey("mk_valid_key", "$argon2id$mockhash");
      expect(result).toBe(true);
      expect(argon2Mock.verify).toHaveBeenCalledWith(
        "$argon2id$mockhash",
        "mk_valid_key",
      );
    });

    it("returns false when argon2.verify resolves false", async () => {
      argon2Mock.verify.mockResolvedValue(false);

      const result = await verifyApiKey("mk_wrong_key", "$argon2id$mockhash");
      expect(result).toBe(false);
    });

    it("catches errors and returns false on malformed hashes", async () => {
      argon2Mock.verify.mockRejectedValue(
        new Error("The format of the hash is invalid"),
      );

      const result = await verifyApiKey("mk_key", "invalid-hash-string");
      expect(result).toBe(false);
    });
  });

  describe("maskApiKey", () => {
    it("masks normal API key leaving first 7 and last 4 characters", () => {
      const key = "mk_1234567890abcdefghijklmnopqrstuv";
      const masked = maskApiKey(key);

      expect(masked).toBe("mk_1234...stuv");
      // Assert the middle of the key is completely absent
      expect(masked).not.toContain("567890abcdefghijklmnopqr");
    });

    it("handles short keys (<= 11 chars) safely with documented short-key branch", () => {
      expect(maskApiKey("mk_123")).toBe("mk_***");
      expect(maskApiKey("mk_12345678")).toBe("mk_***");
    });
  });

  describe("generateApiKey with rejection sampling", () => {
    it("produces a key with mk_ prefix and exactly 32 alphanumeric characters", async () => {
      argon2Mock.hash.mockResolvedValue("$argon2id$mockgeneratedhash");

      const { key, hash } = await generateApiKey();

      expect(key.startsWith("mk_")).toBe(true);
      const randomPart = key.slice(3);
      expect(randomPart.length).toBe(32);
      expect(isValidApiKeyFormat(key)).toBe(true);
      expect(hash).toBe("$argon2id$mockgeneratedhash");
      expect(argon2Mock.hash).toHaveBeenCalledWith(key, expect.any(Object));
    });

    it("performs rejection sampling over byte values >= 248 and requests additional randomness", async () => {
      argon2Mock.hash.mockResolvedValue("$argon2id$mockgeneratedhash");

      // First batch: 32 bytes of 0xff (255 >= 248) -> all rejected!
      const rejectedBatch = Buffer.alloc(32, 0xff);
      // Second batch: 32 valid bytes with byte value 0 ('A')
      const acceptedBatch = Buffer.alloc(32, 0);

      cryptoMocks.randomBytes
        .mockReturnValueOnce(rejectedBatch)
        .mockReturnValueOnce(acceptedBatch);

      const { key } = await generateApiKey();

      // Verified that when first batch was rejected, a second batch was requested
      expect(cryptoMocks.randomBytes).toHaveBeenCalledTimes(2);

      expect(key.startsWith("mk_")).toBe(true);
      const randomPart = key.slice(3);
      expect(randomPart.length).toBe(32);
      // byte 0 maps to ALPHANUMERIC[0] = 'A'
      expect(randomPart).toBe("A".repeat(32));
      expect(isValidApiKeyFormat(key)).toBe(true);
    });
  });
});
