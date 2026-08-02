import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("Password Hashing", () => {
  describe("hashPassword", () => {
    it("should hash a password using Argon2id", async () => {
      const password = "MySecurePassword123!";
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash).toMatch(/^\$argon2id\$/); // Argon2id hash starts with $argon2id$
    });

    it("should generate different hashes for the same password", async () => {
      const password = "MySecurePassword123!";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2); // Different salts
    });
  });

  describe("verifyPassword", () => {
    it("should verify a correct password", async () => {
      const password = "MySecurePassword123!";
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(hash, password);
      expect(isValid).toBe(true);
    });

    it("should reject an incorrect password", async () => {
      const password = "MySecurePassword123!";
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(hash, "WrongPassword456!");
      expect(isValid).toBe(false);
    });

    it("should handle invalid hash format", async () => {
      const isValid = await verifyPassword("invalid-hash", "password");
      expect(isValid).toBe(false);
    });

    it("should be case-sensitive", async () => {
      const password = "MySecurePassword123!";
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(hash, "mysecurepassword123!");
      expect(isValid).toBe(false);
    });
  });
});
