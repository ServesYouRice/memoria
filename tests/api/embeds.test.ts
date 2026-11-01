import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import { UnauthorizedError } from "@/lib/errors";

const authMocks = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const db = vi.hoisted(() => ({
  canvasFindFirst: vi.fn(),
  embedFindMany: vi.fn(),
  embedFindFirst: vi.fn(),
  embedFindUnique: vi.fn(),
  embedCount: vi.fn(),
  embedCreate: vi.fn(),
  embedUpdateMany: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: authMocks.requireAuth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvas: { findFirst: db.canvasFindFirst },
    canvasEmbed: {
      findMany: db.embedFindMany,
      findFirst: db.embedFindFirst,
      findUnique: db.embedFindUnique,
      count: db.embedCount,
      create: db.embedCreate,
      updateMany: db.embedUpdateMany,
    },
  },
}));

import {
  GET as listEmbeds,
  POST as createEmbed,
} from "@/app/api/v1/canvases/[canvasId]/embeds/route";
import { DELETE as revokeEmbed } from "@/app/api/v1/canvases/[canvasId]/embeds/[embedId]/route";
import { digestEmbedToken } from "@/lib/embeds/token";
import { resolveEmbedToken } from "@/lib/embeds/service";
import { createEmbedToken } from "@/lib/embeds/token";
import { prisma } from "@/lib/db";

function request(url: string, method = "GET", body?: unknown): NextRequest {
  const req = new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

const OWNER = "user-owner";
const OUTSIDER = "user-outsider";
const CANVAS = "canvas-1";
const base = `http://localhost/api/v1/canvases/${CANVAS}/embeds`;
const ctx = { params: Promise.resolve({ canvasId: CANVAS }) };
const revokeCtx = {
  params: Promise.resolve({ canvasId: CANVAS, embedId: "embed-1" }),
};

// Mimic Prisma: the owner filter lives in the query, so a non-owner finds nothing.
function ownCanvasAs(ownerId: string) {
  db.canvasFindFirst.mockImplementation(
    async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === CANVAS && where.userId === ownerId ? { id: CANVAS } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ownCanvasAs(OWNER);
  db.embedCount.mockResolvedValue(0);
});

describe("embed routes: authentication", () => {
  it("rejects unauthenticated list/create/revoke without touching the database", async () => {
    authMocks.requireAuth.mockRejectedValue(new UnauthorizedError());

    expect((await listEmbeds(request(base), ctx)).status).toBe(401);
    expect(
      (
        await createEmbed(
          request(base, "POST", { allowedOrigins: ["https://a.com"] }),
          ctx,
        )
      ).status,
    ).toBe(401);
    expect(
      (await revokeEmbed(request(`${base}/embed-1`, "DELETE"), revokeCtx))
        .status,
    ).toBe(401);
    expect(db.canvasFindFirst).not.toHaveBeenCalled();
    expect(db.embedCreate).not.toHaveBeenCalled();
    expect(db.embedUpdateMany).not.toHaveBeenCalled();
  });
});

describe("embed routes: owner-only authorization", () => {
  beforeEach(() => {
    authMocks.requireAuth.mockResolvedValue({ userId: OUTSIDER });
  });

  it("forbids listing another user's embeds", async () => {
    const res = await listEmbeds(request(base), ctx);
    expect(res.status).toBe(403);
    expect(db.embedFindMany).not.toHaveBeenCalled();
  });

  it("forbids creating an embed on another user's canvas", async () => {
    const res = await createEmbed(
      request(base, "POST", { allowedOrigins: ["https://a.com"] }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(db.embedCreate).not.toHaveBeenCalled();
  });

  it("forbids revoking another user's embed", async () => {
    const res = await revokeEmbed(
      request(`${base}/embed-1`, "DELETE"),
      revokeCtx,
    );
    expect(res.status).toBe(403);
    expect(db.embedUpdateMany).not.toHaveBeenCalled();
  });

  it("checks ownership by userId in the canvas query", async () => {
    await listEmbeds(request(base), ctx);
    expect(db.canvasFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CANVAS, userId: OUTSIDER } }),
    );
  });
});

describe("embed routes: owner behaviour", () => {
  beforeEach(() => {
    authMocks.requireAuth.mockResolvedValue({ userId: OWNER });
  });

  it("lists embeds without any token material", async () => {
    db.embedFindMany.mockResolvedValue([
      {
        id: "embed-1",
        label: "Blog",
        allowedOrigins: ["https://blog.example.com"],
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        revokedAt: null,
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
      },
    ]);
    const res = await listEmbeds(request(base), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.embeds).toHaveLength(1);
    expect(JSON.stringify(json)).not.toMatch(/token/i);
    expect(db.embedFindMany.mock.calls[0]![0].select).not.toHaveProperty(
      "tokenDigest",
    );
  });

  it("creates an embed, stores only the digest, and returns the token once", async () => {
    db.embedCreate.mockImplementation(async ({ data }: any) => ({
      id: "embed-1",
      label: data.label,
      allowedOrigins: data.allowedOrigins,
      expiresAt: data.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    }));

    const res = await createEmbed(
      request(base, "POST", {
        label: "Blog",
        allowedOrigins: ["https://Blog.example.com:443"],
        expiresInDays: 30,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.embed.allowedOrigins).toEqual(["https://blog.example.com"]);
    expect(json.embedUrl).toMatch(new RegExp(`/embed/${json.token}$`));

    const data = db.embedCreate.mock.calls[0]![0].data;
    expect(data.tokenDigest).toBe(digestEmbedToken(json.token));
    expect(JSON.stringify(data)).not.toContain(json.token);
    expect(data.canvasId).toBe(CANVAS);
    const ttlMs = data.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 86_400_000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 86_400_000);
    expect(JSON.stringify(json.embed)).not.toContain(json.token);
  });

  it.each([
    ["wildcard", { allowedOrigins: ["https://*.example.com"] }],
    ["path", { allowedOrigins: ["https://example.com/app"] }],
    ["http", { allowedOrigins: ["http://example.com"] }],
    ["empty", { allowedOrigins: [] }],
    ["missing", {}],
    ["extra key", { allowedOrigins: ["https://a.com"], canvasId: "x" }],
    ["bad ttl", { allowedOrigins: ["https://a.com"], expiresInDays: 0 }],
  ])("rejects invalid input (%s) with 400", async (_name, body) => {
    const res = await createEmbed(request(base, "POST", body), ctx);
    expect(res.status).toBe(400);
    expect(db.embedCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const bad = new Request(base, { method: "POST", body: "{nope" });
    (bad as any).nextUrl = new URL(base);
    expect((await createEmbed(bad as unknown as NextRequest, ctx)).status).toBe(
      400,
    );
  });

  it("caps active embeds per canvas", async () => {
    db.embedCount.mockResolvedValue(20);
    const res = await createEmbed(
      request(base, "POST", { allowedOrigins: ["https://a.com"] }),
      ctx,
    );
    expect(res.status).toBe(409);
    expect(db.embedCreate).not.toHaveBeenCalled();
  });

  it("revokes an embed scoped to the owned canvas", async () => {
    db.embedFindFirst.mockResolvedValue({ id: "embed-1", revokedAt: null });
    const res = await revokeEmbed(
      request(`${base}/embed-1`, "DELETE"),
      revokeCtx,
    );
    expect(res.status).toBe(200);
    expect(db.embedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "embed-1", canvasId: CANVAS } }),
    );
    expect(db.embedUpdateMany).toHaveBeenCalledWith({
      where: { id: "embed-1", canvasId: CANVAS, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("returns 404 for an embed that is not on this canvas", async () => {
    db.embedFindFirst.mockResolvedValue(null);
    const res = await revokeEmbed(
      request(`${base}/embed-1`, "DELETE"),
      revokeCtx,
    );
    expect(res.status).toBe(404);
    expect(db.embedUpdateMany).not.toHaveBeenCalled();
  });
});

describe("resolveEmbedToken", () => {
  const live = {
    id: "embed-1",
    canvasId: CANVAS,
    allowedOrigins: ["https://a.com"],
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  };

  it("looks up by digest and accepts a live embed", async () => {
    const { token, digest } = createEmbedToken();
    db.embedFindUnique.mockResolvedValue(live);
    await expect(resolveEmbedToken(prisma, token)).resolves.toMatchObject({
      id: "embed-1",
    });
    expect(db.embedFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenDigest: digest } }),
    );
  });

  it("stops working at once once revoked or expired", async () => {
    const { token } = createEmbedToken();
    db.embedFindUnique.mockResolvedValue({ ...live, revokedAt: new Date() });
    await expect(resolveEmbedToken(prisma, token)).resolves.toBeNull();

    db.embedFindUnique.mockResolvedValue({
      ...live,
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(resolveEmbedToken(prisma, token)).resolves.toBeNull();
  });

  it("rejects an expiry boundary exactly at now", async () => {
    const { token } = createEmbedToken();
    const now = new Date();
    db.embedFindUnique.mockResolvedValue({ ...live, expiresAt: now });
    await expect(resolveEmbedToken(prisma, token, now)).resolves.toBeNull();
  });
});
