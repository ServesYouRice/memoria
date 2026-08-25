import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  readPrivateUploadObject: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
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
