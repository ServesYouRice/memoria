import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dbMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: dbMocks.findUnique } },
}));

import { createEmbedToken } from "@/lib/embeds/token";
import {
  embedTokenFromPath,
  resolveEmbedFramingOrigins,
} from "@/lib/embeds/framing";
import { proxy } from "@/proxy";
import { buildCSP } from "@/middleware/csp";

const FUTURE = new Date(Date.now() + 60_000);
const PAST = new Date(Date.now() - 60_000);

function liveEmbed(overrides: Record<string, unknown> = {}) {
  return {
    id: "embed-1",
    canvasId: "canvas-1",
    allowedOrigins: ["https://blog.example.com", "https://docs.example.com"],
    expiresAt: FUTURE,
    revokedAt: null,
    ...overrides,
  };
}

function frameAncestors(csp: string | null) {
  return csp
    ?.split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("frame-ancestors"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CSP frame-ancestors selection", () => {
  it("defaults to none", () => {
    expect(frameAncestors(buildCSP("n"))).toBe("frame-ancestors 'none'");
  });

  it("uses exactly the supplied origins and keeps the nonce flow", () => {
    const csp = buildCSP("abc123", ["https://a.example.com"]);
    expect(frameAncestors(csp)).toBe("frame-ancestors https://a.example.com");
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).toContain("frame-src 'none'");
  });
});

describe("embed path matching", () => {
  it("matches only a single token segment under /embed/", () => {
    expect(embedTokenFromPath("/embed/abc")).toBe("abc");
    expect(embedTokenFromPath("/embed/abc/")).toBe("abc");
    expect(embedTokenFromPath("/embed/abc/extra")).toBeNull();
    expect(embedTokenFromPath("/embed")).toBeNull();
    expect(embedTokenFromPath("/api/v1/embed/abc")).toBeNull();
    expect(embedTokenFromPath("/dashboard")).toBeNull();
  });
});

describe("resolveEmbedFramingOrigins", () => {
  it("returns the allow-list for a live embed", async () => {
    dbMocks.findUnique.mockResolvedValue(liveEmbed());
    const { token } = createEmbedToken();
    await expect(
      resolveEmbedFramingOrigins(`/embed/${token}`),
    ).resolves.toEqual([
      "https://blog.example.com",
      "https://docs.example.com",
    ]);
  });

  it("does not touch the database for forged tokens", async () => {
    await expect(
      resolveEmbedFramingOrigins(`/embed/${"a".repeat(32)}.${"b".repeat(43)}`),
    ).resolves.toBeNull();
    expect(dbMocks.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", liveEmbed({ revokedAt: PAST })],
    ["expired", liveEmbed({ expiresAt: PAST })],
    ["unknown", null],
  ])("denies framing for a %s embed", async (_name, row) => {
    dbMocks.findUnique.mockResolvedValue(row);
    const { token } = createEmbedToken();
    await expect(
      resolveEmbedFramingOrigins(`/embed/${token}`),
    ).resolves.toBeNull();
  });

  it("fails closed when the lookup throws", async () => {
    dbMocks.findUnique.mockRejectedValue(new Error("db down"));
    const { token } = createEmbedToken();
    await expect(
      resolveEmbedFramingOrigins(`/embed/${token}`),
    ).resolves.toBeNull();
  });

  it("never widens the policy from a corrupt stored origin", async () => {
    dbMocks.findUnique.mockResolvedValue(
      liveEmbed({ allowedOrigins: ["https://a.com", "*"] }),
    );
    const { token } = createEmbedToken();
    await expect(
      resolveEmbedFramingOrigins(`/embed/${token}`),
    ).resolves.toBeNull();
  });
});

describe("proxy framing headers", () => {
  const request = (path: string) =>
    new NextRequest(new URL(path, "http://localhost:3000"));

  it("frames a live embed only from its allowed origins", async () => {
    dbMocks.findUnique.mockResolvedValue(liveEmbed());
    const { token } = createEmbedToken();
    const response = await proxy(request(`/embed/${token}`));

    expect(response.headers.get("X-Frame-Options")).toBeNull();
    const csp = response.headers.get("Content-Security-Policy");
    expect(frameAncestors(csp)).toBe(
      "frame-ancestors https://blog.example.com https://docs.example.com",
    );
    expect(csp).not.toContain("*");
    // Nonce flow is intact and the other hardening headers still apply.
    const nonce = response.headers.get("x-nonce");
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it.each([
    ["revoked", liveEmbed({ revokedAt: PAST })],
    ["expired", liveEmbed({ expiresAt: PAST })],
    ["unknown", null],
  ])("keeps DENY for a %s embed token", async (_name, row) => {
    dbMocks.findUnique.mockResolvedValue(row);
    const { token } = createEmbedToken();
    const response = await proxy(request(`/embed/${token}`));

    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(
      frameAncestors(response.headers.get("Content-Security-Policy")),
    ).toBe("frame-ancestors 'none'");
  });

  it.each([
    "/",
    "/dashboard",
    "/share/abc123",
    "/canvas/c1",
    "/api/health",
    "/embed/not-a-token",
    "/embed/a/b",
    "/api/v1/embed/xyz",
  ])("sends DENY on non-embed route %s", async (path) => {
    const response = await proxy(request(path));

    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(
      frameAncestors(response.headers.get("Content-Security-Policy")),
    ).toBe("frame-ancestors 'none'");
  });
});
