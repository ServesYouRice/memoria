import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";
import type * as UploadNoteModuleNs from "@/lib/uploads/upload-note";

type UploadNoteModule = typeof UploadNoteModuleNs;

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findAsset: vi.fn(),
  findItem: vi.fn(),
  requireCanvasAccess: vi.fn(),
  getUploadNoteOffers: vi.fn(),
  assertUploadNoteOffered: vi.fn(),
  requestUploadNote: vi.fn(),
  getUploadNoteStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    uploadAsset: { findUnique: mocks.findAsset },
    canvasItem: { findFirst: mocks.findItem },
  },
}));
vi.mock("@/lib/api/auth", () => ({
  requireCanvasAccess: mocks.requireCanvasAccess,
}));
vi.mock("@/lib/uploads/upload-note", async (importOriginal) => ({
  ...(await importOriginal<UploadNoteModule>()),
  getUploadNoteOffers: mocks.getUploadNoteOffers,
  assertUploadNoteOffered: mocks.assertUploadNoteOffered,
  requestUploadNote: mocks.requestUploadNote,
  getUploadNoteStatus: mocks.getUploadNoteStatus,
}));

import { GET, POST } from "@/app/api/v1/upload/note/route";
import { forbiddenError, ServiceUnavailableError } from "@/lib/errors";

const ASSET_ID = "c" + "a".repeat(24);
const ITEM_ID = "c" + "b".repeat(24);

function createRequest(method: string, body?: unknown, query = "") {
  const url = `http://localhost/api/v1/upload/note${query}`;
  const req = new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  (req as any).nextUrl = new URL(url);
  return req as unknown as NextRequest;
}

const call = (handler: unknown, req: NextRequest) =>
  (handler as (r: NextRequest, c: unknown) => Promise<Response>)(req, {});

describe("/api/v1/upload/note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", email: "u@example.com" },
    });
    mocks.findAsset.mockResolvedValue({
      id: ASSET_ID,
      canvasId: "canvas-1",
      mimeType: "image/png",
      status: "ACTIVE",
      noteItemId: null,
    });
    mocks.findItem.mockResolvedValue({ id: ITEM_ID });
    mocks.requireCanvasAccess.mockResolvedValue("EDIT");
    mocks.assertUploadNoteOffered.mockResolvedValue(undefined);
    mocks.requestUploadNote.mockResolvedValue({
      state: "pending",
      noteItemId: null,
      error: null,
    });
  });

  it("tells the UI what the saved provider can offer", async () => {
    mocks.getUploadNoteOffers.mockResolvedValue({
      readImage: true,
      speechToText: false,
    });
    const response = await call(GET, createRequest("GET"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      readImage: true,
      speechToText: false,
    });
    expect(mocks.getUploadNoteOffers).toHaveBeenCalledWith("user-1");
  });

  it("queues a note for a photo next to its image item", async () => {
    const response = await call(
      POST,
      createRequest("POST", { assetId: ASSET_ID, sourceItemId: ITEM_ID }),
    );
    expect(response.status).toBe(202);
    expect(mocks.requireCanvasAccess).toHaveBeenCalledWith(
      "canvas-1",
      "user-1",
      "u@example.com",
      "EDIT",
    );
    expect(mocks.assertUploadNoteOffered).toHaveBeenCalledWith(
      "user-1",
      "readImage",
    );
    expect(mocks.findItem).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID, canvasId: "canvas-1", deletedAt: null },
      }),
    );
    expect(mocks.requestUploadNote.mock.calls[0]![1]).toEqual({
      userId: "user-1",
      assetId: ASSET_ID,
      sourceItemId: ITEM_ID,
      positionX: undefined,
      positionY: undefined,
    });
  });

  it("enforces canvas edit access even though the UI hides the offer", async () => {
    mocks.requireCanvasAccess.mockRejectedValue(forbiddenError());
    const response = await call(
      POST,
      createRequest("POST", { assetId: ASSET_ID }),
    );
    expect(response.status).toBe(403);
    expect(mocks.requestUploadNote).not.toHaveBeenCalled();
  });

  it("refuses when the provider lacks the capability", async () => {
    mocks.assertUploadNoteOffered.mockRejectedValue(
      new ServiceUnavailableError("cannot read images"),
    );
    const response = await call(
      POST,
      createRequest("POST", { assetId: ASSET_ID }),
    );
    expect(response.status).toBe(503);
    expect(mocks.requestUploadNote).not.toHaveBeenCalled();
  });

  it("validates input and rejects missing uploads or foreign source items", async () => {
    let response = await call(
      POST,
      createRequest("POST", { assetId: ASSET_ID, positionX: 4 }),
    );
    expect(response.status).toBe(400);
    response = await call(
      POST,
      createRequest("POST", { assetId: ASSET_ID, extra: true }),
    );
    expect(response.status).toBe(400);

    mocks.findItem.mockResolvedValue(null);
    response = await call(
      POST,
      createRequest("POST", { assetId: ASSET_ID, sourceItemId: ITEM_ID }),
    );
    expect(response.status).toBe(400);

    mocks.findAsset.mockResolvedValue(null);
    response = await call(POST, createRequest("POST", { assetId: ASSET_ID }));
    expect(response.status).toBe(404);
    expect(mocks.requestUploadNote).not.toHaveBeenCalled();
  });

  it("reports a note's state to anyone who can view the canvas", async () => {
    mocks.getUploadNoteStatus.mockResolvedValue({
      state: "done",
      noteItemId: ITEM_ID,
      error: null,
    });
    const response = await call(
      GET,
      createRequest("GET", undefined, `?assetId=${ASSET_ID}`),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ state: "done" });
    expect(mocks.requireCanvasAccess.mock.calls[0]![3]).toBe("VIEW");
  });

  it("requires a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await call(GET, createRequest("GET"));
    expect(response.status).toBe(401);
  });
});
