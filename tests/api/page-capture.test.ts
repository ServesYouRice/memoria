import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCachedSession: vi.fn(),
  requireItemAccess: vi.fn(),
  findItem: vi.fn(),
  findAsset: vi.fn(),
  findAssets: vi.fn(),
  readObject: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: mocks.getCachedSession,
  runWithSessionCache: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/api/auth", () => ({
  requireItemAccess: mocks.requireItemAccess,
}));
vi.mock("@/lib/uploads/private-storage", () => ({
  readPrivateUploadObject: mocks.readObject,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    canvasItem: { findFirst: mocks.findItem },
    uploadAsset: { findFirst: mocks.findAsset, findMany: mocks.findAssets },
    user: { findUnique: mocks.findUser },
  },
}));

import { GET as readFile } from "@/app/api/v1/canvas-items/[itemId]/page-capture/[kind]/route";
import { GET as readCopy } from "@/app/api/v1/canvas-items/[itemId]/page-copy/route";

const URL_ = "https://news.example/story";

function bookmark(overrides: Record<string, unknown> = {}) {
  return {
    type: "BOOKMARK",
    content: { url: URL_ },
    pageCopy: null,
    pageCapture: {
      url: URL_,
      imageAssetId: "asset-image",
      pdfAssetId: "asset-pdf",
      capturedAt: new Date("2026-11-14T10:00:00Z"),
    },
    ...overrides,
  };
}

function file(kind: string, itemId = "item-1") {
  return readFile(
    new NextRequest(
      `http://localhost/api/v1/canvas-items/${itemId}/page-capture/${kind}`,
    ),
    { params: Promise.resolve({ itemId, kind }) },
  );
}

function copy(itemId = "item-1") {
  return readCopy(
    new NextRequest(`http://localhost/api/v1/canvas-items/${itemId}/page-copy`),
    { params: Promise.resolve({ itemId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCachedSession.mockResolvedValue({
    user: { id: "u1", email: "u1@example.com" },
  });
  mocks.requireItemAccess.mockResolvedValue("VIEW");
  mocks.findUser.mockResolvedValue({ webArchiveLookup: false });
  mocks.findItem.mockResolvedValue(bookmark());
  mocks.findAsset.mockResolvedValue({
    storageMode: "local",
    storageKey: "captures/c1/10-page.jpg",
    mimeType: "image/jpeg",
  });
  mocks.findAssets.mockResolvedValue([
    { id: "asset-image" },
    { id: "asset-pdf" },
  ]);
  mocks.readObject.mockResolvedValue({
    body: new Response("file-bytes").body,
    contentLength: 10,
    etag: "x",
  });
});

describe("GET /api/v1/canvas-items/{itemId}/page-capture/{kind} (IMP-110)", () => {
  it("checks that the person may view the canvas", async () => {
    const { ForbiddenError } = await import("@/lib/errors");
    mocks.requireItemAccess.mockRejectedValue(new ForbiddenError("No"));
    expect((await file("image")).status).toBe(403);
    expect(mocks.readObject).not.toHaveBeenCalled();
    expect(mocks.requireItemAccess).toHaveBeenCalledWith(
      "item-1",
      "u1",
      "u1@example.com",
      "VIEW",
    );
  });

  it("serves the picture as an image that cannot run anything", async () => {
    const response = await file("image");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("file-bytes");
  });

  it("serves the PDF with its own type", async () => {
    mocks.findAsset.mockResolvedValue({
      storageMode: "local",
      storageKey: "captures/c1/10-page.pdf",
      mimeType: "application/pdf",
    });
    const response = await file("pdf");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 404 for an unknown kind, no capture, a changed address or a deleted file", async () => {
    expect((await file("html")).status).toBe(404);
    mocks.findItem.mockResolvedValue(bookmark({ pageCapture: null }));
    expect((await file("image")).status).toBe(404);
    mocks.findItem.mockResolvedValue(
      bookmark({ content: { url: "https://other.example/" } }),
    );
    expect((await file("image")).status).toBe(404);
    mocks.findItem.mockResolvedValue(bookmark());
    mocks.findAsset.mockResolvedValue(null);
    expect((await file("image")).status).toBe(404);
    expect(mocks.readObject).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/canvas-items/{itemId}/page-copy capture (IMP-110)", () => {
  it("offers the picture and PDF next to the saved copy", async () => {
    const body = await (await copy()).json();
    expect(body.capture).toEqual({
      capturedAt: "2026-11-14T10:00:00.000Z",
      imageUrl: "/api/v1/canvas-items/item-1/page-capture/image",
      pdfUrl: "/api/v1/canvas-items/item-1/page-capture/pdf",
    });
  });

  it("offers only the files that are still stored", async () => {
    mocks.findAssets.mockResolvedValue([{ id: "asset-pdf" }]);
    const body = await (await copy()).json();
    expect(body.capture.imageUrl).toBeNull();
    expect(body.capture.pdfUrl).toContain("/pdf");
    mocks.findAssets.mockResolvedValue([]);
    expect((await (await copy()).json()).capture).toBeUndefined();
  });

  it("offers nothing when none was taken or the address changed", async () => {
    mocks.findItem.mockResolvedValue(bookmark({ pageCapture: null }));
    expect((await (await copy()).json()).capture).toBeUndefined();
    mocks.findItem.mockResolvedValue(
      bookmark({ content: { url: "https://other.example/" } }),
    );
    expect((await (await copy()).json()).capture).toBeUndefined();
  });
});
