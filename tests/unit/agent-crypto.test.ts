import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
} from "@/lib/agents/crypto";

describe("Agent credential crypto (SEC-24)", () => {
  it("round-trips an encrypted secret", () => {
    const secret = "sk-test-0123456789abcdef";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("tags ciphertext with the current key version", () => {
    const payload = encryptSecret("another-secret");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload.split(".")).toHaveLength(4);
  });

  it("still decrypts legacy unversioned payloads", () => {
    // Legacy payloads (pre-SEC-24) were "<iv>.<tag>.<ciphertext>" with no
    // version tag and used the current key. Dropping the version tag from a
    // fresh payload reproduces that exact shape.
    const secret = "legacy-secret-value";
    const legacy = encryptSecret(secret).split(".").slice(1).join(".");
    expect(legacy.split(".")).toHaveLength(3);
    expect(decryptSecret(legacy)).toBe(secret);
  });

  it("rejects malformed payloads", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow();
    expect(() => decryptSecret("v1.only.two")).toThrow();
  });

  it("produces a stable fingerprint independent of encryption", () => {
    const secret = "fingerprint-me";
    expect(fingerprintSecret(secret)).toBe(fingerprintSecret(secret));
    expect(fingerprintSecret(secret)).not.toBe(fingerprintSecret("other"));
  });
});
