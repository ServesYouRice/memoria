import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  embedFindUnique: vi.fn(),
  readPrivateUploadObject: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    canvasEmbed: { findUnique: mocks.embedFindUnique },
    uploadAsset: {
      findUnique: mocks.findUnique,
      delete: vi.fn(),
    },
  },
}));

const authMocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCanvasAccess: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMocks.auth }));
vi.mock("@/lib/api/auth", () => ({
  getCanvasAccess: authMocks.getCanvasAccess,
  requireCanvasAccess: vi.fn(),
}));
vi.mock("@/lib/api/route-handler", () => ({
  withApiHandler: (handler: unknown) => handler,
}));
vi.mock("@/lib/uploads/private-storage", () => ({
  readPrivateUploadObject: mocks.readPrivateUploadObject,
  deletePrivateUploadObject: vi.fn(),
}));

import { GET as uploadsGet } from "@/app/api/v1/uploads/[assetId]/route";
import { createEmbedToken } from "@/lib/embeds/token";
import { withEmbedAssetTokens } from "@/lib/embeds/assets";
import { ItemType, type CanvasItem } from "@/types/canvas";

function bodyStream(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

describe("upload asset reads and caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams public canvas asset with public caching and stable etag", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "asset-1",
      canvasId: "canvas-1",
      canvas: { isPublic: true },
      storageMode: "s3",
      storageKey: "uploads/user/image.png",
      mimeType: "image/png",
      filename: "image.png",
      status: "ACTIVE",
    });
    mocks.readPrivateUploadObject.mockResolvedValue({
      body: bodyStream("image-bytes"),
      contentLength: 11,
      etag: '"asset-etag"',
    });

    const response = await uploadsGet(
      new Request("http://localhost/api/v1/uploads/asset-1"),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate",
    );
    expect(response.headers.get("etag")).toBe('"asset-etag"');
    expect(await response.text()).toBe("image-bytes");
  });

  it("streams private canvas asset with private non-cacheable headers for authorized user", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "asset-2",
      canvasId: "canvas-2",
      canvas: { isPublic: false },
      storageMode: "s3",
      storageKey: "uploads/user/private.png",
      mimeType: "image/png",
      filename: "private.png",
      status: "ACTIVE",
    });
    authMocks.auth.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    authMocks.getCanvasAccess.mockResolvedValue("VIEW");
    mocks.readPrivateUploadObject.mockResolvedValue({
      body: bodyStream("private-bytes"),
      contentLength: 13,
      etag: '"private-etag"',
    });

    const response = await uploadsGet(
      new Request("http://localhost/api/v1/uploads/asset-2"),
      { params: Promise.resolve({ assetId: "asset-2" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=0, must-revalidate",
    );
    expect(response.headers.get("etag")).toBe('"private-etag"');
    expect(await response.text()).toBe("private-bytes");
  });

  it("honors a matching If-None-Match header", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "asset-1",
      canvasId: "canvas-1",
      canvas: { isPublic: true },
      storageMode: "s3",
      storageKey: "uploads/user/image.png",
      mimeType: "image/png",
      filename: "image.png",
      status: "ACTIVE",
    });
    mocks.readPrivateUploadObject.mockResolvedValue({
      body: bodyStream("image-bytes"),
      contentLength: 11,
      etag: '"asset-etag"',
    });

    const response = await uploadsGet(
      new Request("http://localhost/api/v1/uploads/asset-1", {
        headers: { "if-none-match": '"asset-etag"' },
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });
});

describe("upload asset reads via embed token", () => {
  const future = new Date(Date.now() + 86_400_000);
  const privateAsset = (canvasId = "canvas-2") => ({
    id: "asset-2",
    canvasId,
    canvas: { isPublic: false },
    storageMode: "s3",
    storageKey: "uploads/user/private.png",
    mimeType: "image/png",
    filename: "private.png",
    status: "ACTIVE",
  });

  function get(token?: string) {
    const qs = token === undefined ? "" : `?embed=${encodeURIComponent(token)}`;
    return uploadsGet(
      new Request(`http://localhost/api/v1/uploads/asset-2${qs}`),
      { params: Promise.resolve({ assetId: "asset-2" }) },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(privateAsset());
    authMocks.auth.mockResolvedValue(null);
    mocks.readPrivateUploadObject.mockImplementation(async () => ({
      body: bodyStream("private-bytes"),
      contentLength: 13,
      etag: '"private-etag"',
    }));
  });

  it("serves a private asset to a live token for the same canvas, uncached", async () => {
    const { token } = createEmbedToken();
    mocks.embedFindUnique.mockResolvedValue({
      id: "embed-1",
      canvasId: "canvas-2",
      allowedOrigins: [],
      expiresAt: future,
      revokedAt: null,
    });

    const response = await get(token);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("private-bytes");
    expect(authMocks.auth).not.toHaveBeenCalled();
  });

  it("denies a token that belongs to another canvas", async () => {
    const { token } = createEmbedToken();
    mocks.embedFindUnique.mockResolvedValue({
      id: "embed-1",
      canvasId: "canvas-other",
      allowedOrigins: [],
      expiresAt: future,
      revokedAt: null,
    });

    await expect(get(token)).rejects.toMatchObject({ status: 401 });
    expect(mocks.readPrivateUploadObject).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", { revokedAt: new Date(), expiresAt: future }],
    ["expired", { revokedAt: null, expiresAt: new Date(Date.now() - 1000) }],
  ])("denies a %s token", async (_name, state) => {
    const { token } = createEmbedToken();
    mocks.embedFindUnique.mockResolvedValue({
      id: "embed-1",
      canvasId: "canvas-2",
      allowedOrigins: [],
      ...state,
    });

    await expect(get(token)).rejects.toMatchObject({ status: 401 });
    expect(mocks.readPrivateUploadObject).not.toHaveBeenCalled();
  });

  it("denies a forged token without a database lookup", async () => {
    const { token } = createEmbedToken();
    const forged = `${token.split(".")[0]}.${"A".repeat(43)}`;

    await expect(get(forged)).rejects.toMatchObject({ status: 401 });
    await expect(get("not-a-token")).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.embedFindUnique).not.toHaveBeenCalled();
  });

  it("keeps the unauthenticated response unchanged without a token", async () => {
    await expect(get()).rejects.toMatchObject({ status: 401 });
    expect(mocks.embedFindUnique).not.toHaveBeenCalled();
  });

  it("falls back to session access when the token is invalid", async () => {
    authMocks.auth.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });
    authMocks.getCanvasAccess.mockResolvedValue("VIEW");

    const response = await get("not-a-token");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=0, must-revalidate",
    );
  });

  it("ignores the token for public canvas assets", async () => {
    mocks.findUnique.mockResolvedValue({
      ...privateAsset(),
      canvas: { isPublic: true },
    });

    const response = await get("anything");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate",
    );
    expect(mocks.embedFindUnique).not.toHaveBeenCalled();
  });

  it("tags only upload image URLs with the embed token", () => {
    const item = (type: ItemType, url: string) =>
      ({ id: url, type, content: { url } }) as unknown as CanvasItem;
    const out = withEmbedAssetTokens(
      [
        item(ItemType.IMAGE, "/api/v1/uploads/abc_1"),
        item(ItemType.IMAGE, "https://example.com/x.png"),
        item(ItemType.IMAGE, "/api/v1/uploads/abc/../x"),
        item(ItemType.BOOKMARK, "/api/v1/uploads/abc"),
      ],
      "tok.sig",
    );
    expect((out[0]!.content as { url: string }).url).toBe(
      "/api/v1/uploads/abc_1?embed=tok.sig",
    );
    expect(out.slice(1)).toEqual([
      item(ItemType.IMAGE, "https://example.com/x.png"),
      item(ItemType.IMAGE, "/api/v1/uploads/abc/../x"),
      item(ItemType.BOOKMARK, "/api/v1/uploads/abc"),
    ]);
  });
});
