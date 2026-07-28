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

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  getCanvasAccess: vi.fn(),
  requireCanvasAccess: vi.fn(),
}));
vi.mock("@/lib/api/route-handler", () => ({
  withApiHandler: (handler: unknown) => handler,
}));
vi.mock("@/lib/uploads/private-storage", () => ({
  readPrivateUploadObject: mocks.readPrivateUploadObject,
  deletePrivateUploadObject: vi.fn(),
}));

function bodyStream(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

describe("private upload reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("streams content with private caching and a stable etag", async () => {
    mocks.readPrivateUploadObject.mockResolvedValue({
      body: bodyStream("image-bytes"),
      contentLength: 11,
      etag: '"asset-etag"',
    });
    const { GET } = await import("@/app/api/v1/uploads/[assetId]/route");

    const response = await GET(
      new Request("http://localhost/api/v1/uploads/asset-1"),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=0, must-revalidate",
    );
    expect(response.headers.get("etag")).toBe('"asset-etag"');
    expect(await response.text()).toBe("image-bytes");
  });

  it("honors a matching If-None-Match header", async () => {
    mocks.readPrivateUploadObject.mockResolvedValue({
      body: bodyStream("image-bytes"),
      contentLength: 11,
      etag: '"asset-etag"',
    });
    const { GET } = await import("@/app/api/v1/uploads/[assetId]/route");

    const response = await GET(
      new Request("http://localhost/api/v1/uploads/asset-1", {
        headers: { "if-none-match": '"asset-etag"' },
      }),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });
});
