import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCanvasAccess: vi.fn(),
  runIdempotent: vi.fn(),
  reserveUploadAsset: vi.fn(),
  activateUploadAsset: vi.fn(),
  failUploadReservation: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  assertUploadNoteOffered: vi.fn(),
  requestUploadNote: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/api/auth", () => ({
  requireAuth: mocks.requireAuth,
  requireCanvasAccess: mocks.requireCanvasAccess,
}));
vi.mock("@/lib/api/route-handler", () => ({
  withApiHandler: (handler: unknown) => handler,
  runIdempotent: mocks.runIdempotent,
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/uploads/lifecycle", () => ({
  reserveUploadAsset: mocks.reserveUploadAsset,
  activateUploadAsset: mocks.activateUploadAsset,
  failUploadReservation: mocks.failUploadReservation,
}));
vi.mock("@/lib/uploads/upload-note", () => ({
  assertUploadNoteOffered: mocks.assertUploadNoteOffered,
  requestUploadNote: mocks.requestUploadNote,
}));
vi.mock("fs/promises", () => ({
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
}));

import { POST } from "@/app/api/v1/upload/route";
import { ServiceUnavailableError } from "@/lib/errors";
import { pngBytes } from "../helpers/image-fixtures";

const CANVAS_ID = "c" + "a".repeat(24);
const ASSET_ID = "c" + "b".repeat(24);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(60).fill(0x42)]);
const upload = POST as unknown as (request: NextRequest) => Promise<Response>;

/** The route wrapper is mocked out, so errors arrive as thrown ApiErrors. */
async function statusOf(request: Promise<NextRequest>) {
  try {
    return (await upload(await request)).status;
  } catch (error) {
    return (error as { status?: number }).status ?? 500;
  }
}

async function request(
  file: Buffer,
  type: string,
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  form.append("canvasId", CANVAS_ID);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([new Uint8Array(file)], { type }), "rec.webm");
  const encoded = new Response(form);
  return new NextRequest("http://localhost/api/v1/upload", {
    method: "POST",
    headers: {
      "content-type": encoded.headers.get("content-type") as string,
    },
    body: Buffer.from(await encoded.arrayBuffer()),
  });
}

describe("POST /api/v1/upload voice notes (IMP-071)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    mocks.requireCanvasAccess.mockResolvedValue(undefined);
    mocks.runIdempotent.mockImplementation(
      async (_req: unknown, _user: string, handler: () => Promise<Response>) =>
        handler(),
    );
    mocks.reserveUploadAsset.mockResolvedValue({ id: ASSET_ID });
    mocks.activateUploadAsset.mockResolvedValue(undefined);
    mocks.assertUploadNoteOffered.mockResolvedValue(undefined);
    mocks.requestUploadNote.mockResolvedValue({
      state: "pending",
      noteItemId: null,
      error: null,
    });
  });

  it("stores a recording and queues its note at the recorded position", async () => {
    const response = await upload(
      await request(WEBM, "audio/webm;codecs=opus", {
        purpose: "voice-note",
        positionX: "120.5",
        positionY: "-40",
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      assetId: ASSET_ID,
      url: `/api/v1/uploads/${ASSET_ID}`,
      type: "audio/webm",
      note: { state: "pending" },
    });
    expect(mocks.assertUploadNoteOffered).toHaveBeenCalledWith(
      "user-1",
      "speechToText",
    );
    expect(mocks.reserveUploadAsset.mock.calls[0]![1]).toMatchObject({
      mimeType: "audio/webm",
      storageKey: expect.stringMatching(/\.webm$/),
    });
    expect(mocks.requestUploadNote).toHaveBeenCalledWith(
      {},
      {
        userId: "user-1",
        assetId: ASSET_ID,
        positionX: 120.5,
        positionY: -40,
      },
    );
  });

  it("rejects audio that is not a voice note", async () => {
    expect(await statusOf(request(WEBM, "audio/webm"))).toBe(400);
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
  });

  it("rejects a voice note that is not audio, or whose declared type lies", async () => {
    expect(
      await statusOf(
        request(pngBytes(8, 8), "image/png", { purpose: "voice-note" }),
      ),
    ).toBe(400);
    expect(
      await statusOf(request(WEBM, "image/png", { purpose: "voice-note" })),
    ).toBe(400);
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
  });

  it("stores nothing when the saved provider cannot transcribe", async () => {
    mocks.assertUploadNoteOffered.mockRejectedValue(
      new ServiceUnavailableError("cannot transcribe"),
    );
    await expect(
      upload(await request(WEBM, "audio/webm", { purpose: "voice-note" })),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
  });

  it("rejects an unknown purpose and keeps plain image uploads unchanged", async () => {
    expect(
      await statusOf(
        request(pngBytes(8, 8), "image/png", { purpose: "other" }),
      ),
    ).toBe(400);
    const response = await upload(await request(pngBytes(8, 8), "image/png"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.note).toBeUndefined();
    expect(mocks.assertUploadNoteOffered).not.toHaveBeenCalled();
    expect(mocks.requestUploadNote).not.toHaveBeenCalled();
  });
});
