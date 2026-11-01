import { describe, expect, it } from "vitest";
import {
  MAX_EMBED_ORIGINS,
  normalizeEmbedOrigin,
  normalizeEmbedOrigins,
} from "@/lib/embeds/origins";
import {
  createEmbedToken,
  digestEmbedToken,
  verifyEmbedTokenSignature,
} from "@/lib/embeds/token";
import { createEmbedSchema } from "@/lib/embeds/schemas";

const prod = { allowInsecureLocalhost: false };
const dev = { allowInsecureLocalhost: true };

describe("embed origin validation", () => {
  it("accepts exact https origins and canonicalizes them", () => {
    expect(normalizeEmbedOrigin("https://Example.com", prod)).toBe(
      "https://example.com",
    );
    expect(normalizeEmbedOrigin("https://example.com:443", prod)).toBe(
      "https://example.com",
    );
    expect(normalizeEmbedOrigin("https://example.com:8443/", prod)).toBe(
      "https://example.com:8443",
    );
    expect(normalizeEmbedOrigin("  https://sub.example.co.uk ", prod)).toBe(
      "https://sub.example.co.uk",
    );
  });

  it("rejects wildcards, paths, credentials, queries, and fragments", () => {
    for (const value of [
      "*",
      "https://*.example.com",
      "https://example.com/path",
      "https://example.com/?x=1",
      "https://example.com?",
      "https://example.com#frag",
      "https://user:pw@example.com",
      "https://example.com@evil.com",
      "https:///example.com",
      "example.com",
      "null",
      "'none'",
      "",
    ]) {
      expect(normalizeEmbedOrigin(value, dev), value).toBeNull();
    }
  });

  it("rejects characters that could inject CSP directives", () => {
    for (const value of [
      "https://a.com; script-src *",
      "https://a.com;b.com",
      "https://a.com,b.com",
      "https://a.com b.com",
      "https://a.com\r\nX-Evil: 1",
    ]) {
      expect(normalizeEmbedOrigin(value, dev), value).toBeNull();
    }
  });

  it("rejects non-http(s) schemes", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://example.com",
      "chrome-extension://abc",
    ]) {
      expect(normalizeEmbedOrigin(value, dev), value).toBeNull();
    }
  });

  it("allows http only for localhost and only outside production", () => {
    expect(normalizeEmbedOrigin("http://localhost:3000", dev)).toBe(
      "http://localhost:3000",
    );
    expect(normalizeEmbedOrigin("http://127.0.0.1:3000", dev)).toBe(
      "http://127.0.0.1:3000",
    );
    expect(normalizeEmbedOrigin("http://localhost:3000", prod)).toBeNull();
    expect(normalizeEmbedOrigin("http://example.com", dev)).toBeNull();
    expect(normalizeEmbedOrigin("http://localhost.evil.com", dev)).toBeNull();
  });

  it("de-duplicates lists and bounds their size", () => {
    expect(
      normalizeEmbedOrigins(
        ["https://a.com", "https://A.com:443", "https://b.com"],
        prod,
      ),
    ).toEqual(["https://a.com", "https://b.com"]);
    expect(normalizeEmbedOrigins([], prod)).toBeNull();
    expect(
      normalizeEmbedOrigins(["https://a.com", "https://a.com/x"], prod),
    ).toBeNull();
    const tooMany = Array.from(
      { length: MAX_EMBED_ORIGINS + 1 },
      (_, i) => `https://s${i}.example.com`,
    );
    expect(normalizeEmbedOrigins(tooMany, prod)).toBeNull();
  });
});

describe("embed create schema", () => {
  it("normalizes origins and defaults the label", () => {
    const parsed = createEmbedSchema.parse({
      allowedOrigins: ["https://Example.com:443"],
    });
    expect(parsed).toMatchObject({
      label: "",
      allowedOrigins: ["https://example.com"],
    });
  });

  it("rejects invalid origins, unknown keys, and out-of-range expiry", () => {
    expect(
      createEmbedSchema.safeParse({ allowedOrigins: ["https://*.a.com"] })
        .success,
    ).toBe(false);
    expect(createEmbedSchema.safeParse({ allowedOrigins: [] }).success).toBe(
      false,
    );
    expect(
      createEmbedSchema.safeParse({
        allowedOrigins: ["https://a.com"],
        canvasId: "other",
      }).success,
    ).toBe(false);
    expect(
      createEmbedSchema.safeParse({
        allowedOrigins: ["https://a.com"],
        expiresInDays: 4000,
      }).success,
    ).toBe(false);
  });
});

describe("embed token signing", () => {
  it("issues verifiable tokens and stores only a digest", () => {
    const { token, digest } = createEmbedToken();
    expect(verifyEmbedTokenSignature(token)).toBe(true);
    expect(digest).toBe(digestEmbedToken(token));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token.split(".")[0]);
  });

  it("issues unique tokens", () => {
    expect(createEmbedToken().token).not.toBe(createEmbedToken().token);
  });

  it("rejects tampered, truncated, and malformed tokens", () => {
    const { token } = createEmbedToken();
    const [random, signature] = token.split(".") as [string, string];
    const flipped = `${random.slice(0, -1)}${random.endsWith("A") ? "B" : "A"}`;

    expect(verifyEmbedTokenSignature(`${flipped}.${signature}`)).toBe(false);
    expect(verifyEmbedTokenSignature(`${random}.${signature.slice(1)}`)).toBe(
      false,
    );
    expect(verifyEmbedTokenSignature(random)).toBe(false);
    expect(verifyEmbedTokenSignature(`${token}.x`)).toBe(false);
    expect(verifyEmbedTokenSignature("")).toBe(false);
    expect(
      verifyEmbedTokenSignature(`${"a".repeat(32)}.${"b".repeat(43)}`),
    ).toBe(false);
  });
});
