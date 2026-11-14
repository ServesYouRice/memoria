/**
 * IMP-152 — direct browser uploads: the presign route (auth, canvas access,
 * type and size limits, quota, signed URL) and the confirm route (the stored
 * object is checked before the asset is saved). The route wrappers are the
 * real ones, so errors arrive as problem responses; storage is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { pngBytes } from "../helpers/image-fixtures";

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string } },
  requireCanvasAccess: vi.fn(),
  failUploadReservation: vi.fn(),
  activateUploadAsset: vi.fn(),
  compensateWrittenUpload: vi.fn(),
  head: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  db: {
    uploadAsset: { findUnique: vi.fn(), create: vi.fn() },
    uploadQuota: { updateMany: vi.fn() },
    outboxJob: { upsert: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/logger", () => {
  const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { logger: log, createLogger: () => log };
});
vi.mock("@/lib/api/session-cache", () => ({
  getCachedSession: vi.fn(async () => mocks.session),
  runWithSessionCache: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/api/auth", () => ({
  requireCanvasAccess: mocks.requireCanvasAccess,
}));
vi.mock("@/lib/uploads/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  failUploadReservation: mocks.failUploadReservation,
  activateUploadAsset: mocks.activateUploadAsset,
  compensateWrittenUpload: mocks.compensateWrittenUpload,
}));
vi.mock("@/lib/uploads/private-storage", () => ({
  headPrivateUploadObject: mocks.head,
  readPrivateUploadObject: mocks.read,
  writePrivateUploadObject: mocks.write,
  deletePrivateUploadObject: mocks.remove,
}));

import { POST as presignRoute } from "@/app/api/v1/upload/direct/route";
import { POST as confirmRoute } from "@/app/api/v1/upload/direct/confirm/route";
import { ForbiddenError } from "@/lib/errors";
import {
  DIRECT_UPLOAD_EXPIRE_JOB,
  createDirectUploadExpireHandler,
  resetDirectUploadClientForTests,
} from "@/lib/uploads/direct-upload";
import { directUploadOrigin } from "@/lib/uploads/direct-upload-config";
import { UploadNotPendingError } from "@/lib/uploads/lifecycle";

const CANVAS_ID = "c" + "a".repeat(24);
const ASSET_ID = "c" + "b".repeat(24);
const USER = { id: "user-1", email: "user@example.com" };
const MB = 1024 * 1024;

type Handler = (request: NextRequest, context?: unknown) => Promise<Response>;
const presign = presignRoute as unknown as Handler;
const confirm = confirmRoute as unknown as Handler;

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function presignBody(overrides: Record<string, unknown> = {}) {
  return {
    canvasId: CANVAS_ID,
    filename: "holiday photo.png",
    contentType: "image/png",
    size: 2 * MB,
    ...overrides,
  };
}

function useS3(endpoint?: string) {
  vi.stubEnv("UPLOAD_STORAGE", "s3");
  vi.stubEnv("S3_BUCKET", "memoria-uploads");
  vi.stubEnv("S3_REGION", "eu-central-1");
  vi.stubEnv("S3_ENDPOINT", endpoint ?? "");
  vi.stubEnv("S3_PUBLIC_ENDPOINT", "");
  vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-key");
  resetDirectUploadClientForTests();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { user: USER };
  mocks.requireCanvasAccess.mockResolvedValue("EDIT");
  mocks.db.$transaction.mockImplementation(
    (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.db),
  );
  mocks.db.$executeRaw.mockResolvedValue(1);
  mocks.db.uploadQuota.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.uploadAsset.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: ASSET_ID,
      ...data,
    }),
  );
  mocks.db.outboxJob.upsert.mockResolvedValue({ id: "job-1" });
  mocks.remove.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
  vi.stubEnv("UPLOAD_SCAN_URL", "");
  vi.stubEnv("UPLOAD_SCAN_REQUIRED", "false");
  vi.stubEnv("UPLOAD_DIRECT_UPLOADS", "");
  vi.stubEnv("UPLOAD_DIRECT_MAX_BYTES", "");
  useS3("http://storage.example.test:9000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDirectUploadClientForTests();
});

describe("POST /api/v1/upload/direct (presign)", () => {
  it("requires a session", async () => {
    mocks.session = null;
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(401);
    expect(mocks.db.uploadAsset.create).not.toHaveBeenCalled();
  });

  it("requires EDIT access to the canvas and reserves nothing without it", async () => {
    mocks.requireCanvasAccess.mockRejectedValue(new ForbiddenError());
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(403);
    expect(mocks.requireCanvasAccess).toHaveBeenCalledWith(
      CANVAS_ID,
      USER.id,
      USER.email,
      "EDIT",
    );
    expect(mocks.db.uploadAsset.create).not.toHaveBeenCalled();
  });

  it("answers direct-upload-unavailable with local-disk storage", async () => {
    vi.stubEnv("UPLOAD_STORAGE", "local");
    vi.stubEnv("UPLOAD_LOCAL_DIR", "/srv/uploads");
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).type).toBe(
      "https://memoria.local/errors/direct-upload-unavailable",
    );
    expect(mocks.db.uploadAsset.create).not.toHaveBeenCalled();
  });

  it("can be switched off with S3", async () => {
    vi.stubEnv("UPLOAD_DIRECT_UPLOADS", "false");
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(409);
  });

  it.each([
    ["an SVG", { contentType: "image/svg+xml" }],
    ["audio", { contentType: "audio/webm" }],
    ["an empty file", { size: 0 }],
    ["a fractional size", { size: 1.5 }],
    ["a bad canvas id", { canvasId: "../other" }],
    ["unknown fields", { storageKey: "uploads/someone-else/x.png" }],
  ])("rejects %s", async (_label, overrides) => {
    const response = await presign(
      post("/api/v1/upload/direct", presignBody(overrides)),
    );
    expect(response.status).toBe(400);
    expect(mocks.db.uploadAsset.create).not.toHaveBeenCalled();
  });

  it("caps the size with UPLOAD_DIRECT_MAX_BYTES, above the proxied 5 MB", async () => {
    vi.stubEnv("UPLOAD_DIRECT_MAX_BYTES", String(10 * MB));
    const ok = await presign(
      post("/api/v1/upload/direct", presignBody({ size: 8 * MB })),
    );
    expect(ok.status).toBe(201);
    const tooLarge = await presign(
      post("/api/v1/upload/direct", presignBody({ size: 10 * MB + 1 })),
    );
    expect(tooLarge.status).toBe(413);
  });

  it("defaults to 25 MB and keeps PDFs within their own budget", async () => {
    const image = await presign(
      post("/api/v1/upload/direct", presignBody({ size: 25 * MB + 1 })),
    );
    expect(image.status).toBe(413);
    const pdf = await presign(
      post(
        "/api/v1/upload/direct",
        presignBody({
          contentType: "application/pdf",
          filename: "a.pdf",
          size: 21 * MB,
        }),
      ),
    );
    expect(pdf.status).toBe(413);
  });

  it("charges the quota and reserves nothing past it", async () => {
    mocks.db.uploadQuota.updateMany.mockResolvedValue({ count: 0 });
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).title).toBe("Upload quota exceeded");
    expect(mocks.db.uploadAsset.create).not.toHaveBeenCalled();
  });

  it("checks storage settings before charging the quota", async () => {
    vi.stubEnv("S3_BUCKET", "");
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(500);
    expect(mocks.db.uploadQuota.updateMany).not.toHaveBeenCalled();
  });

  it("reserves the upload, queues its expiry and signs a short PUT", async () => {
    const before = Date.now();
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body).toMatchObject({
      assetId: ASSET_ID,
      method: "PUT",
      headers: { "Content-Type": "image/png" },
    });
    const created = mocks.db.uploadAsset.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({
      userId: USER.id,
      canvasId: CANVAS_ID,
      storageMode: "s3",
      mimeType: "image/png",
      size: 2 * MB,
      status: "PENDING",
    });
    expect(created.storageKey).toMatch(
      /^uploads\/user-1\/holiday_photo-\d+-[0-9a-f]{16}\.png$/,
    );

    const job = mocks.db.outboxJob.upsert.mock.calls[0]![0];
    expect(job.where).toEqual({
      dedupeKey: `${DIRECT_UPLOAD_EXPIRE_JOB}:${ASSET_ID}`,
    });
    expect(job.create.payload).toEqual({
      assetId: ASSET_ID,
      stagingKey: `incoming/${created.storageKey}`,
    });
    // After the 5-minute URL plus the 10-minute grace.
    const runAt = (job.create.nextRunAt as Date).getTime();
    expect(runAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);

    const url = new URL(body.uploadUrl);
    expect(url.origin).toBe("http://storage.example.test:9000");
    expect(url.pathname).toBe(
      `/memoria-uploads/incoming/${created.storageKey}`,
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    // Length and type are part of the signature: storage refuses others.
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
    expect(url.searchParams.get("X-Amz-Credential")).toContain(
      "test-access-key",
    );
    expect(body.uploadUrl).not.toContain("test-secret-key");
  });

  it("gives the quota back when signing fails", async () => {
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "not a url");
    resetDirectUploadClientForTests();
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(500);
    expect(mocks.failUploadReservation).toHaveBeenCalledWith(
      mocks.db,
      ASSET_ID,
      "presign_failed",
    );
  });

  it.each([
    ["R2", "https://0123abcd.r2.cloudflarestorage.com"],
    ["a path-style store", "https://s3.memoria.example.com"],
    ["AWS", undefined],
  ])("signs for the origin the CSP allows (%s)", async (_label, endpoint) => {
    useS3(endpoint);
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    expect(response.status).toBe(201);
    const { uploadUrl } = await response.json();
    expect(new URL(uploadUrl).origin).toBe(directUploadOrigin());
  });

  it("signs for S3_PUBLIC_ENDPOINT when storage is internal", async () => {
    useS3("http://seaweedfs:8333");
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://files.memoria.example.com");
    resetDirectUploadClientForTests();
    const response = await presign(
      post("/api/v1/upload/direct", presignBody()),
    );
    const { uploadUrl } = await response.json();
    expect(new URL(uploadUrl).origin).toBe("https://files.memoria.example.com");
    expect(directUploadOrigin()).toBe("https://files.memoria.example.com");
  });
});

describe("POST /api/v1/upload/direct/confirm", () => {
  const png = pngBytes(16, 16);
  const storageKey = "uploads/user-1/photo-1-abcdef0123456789.png";
  const stagingKey = `incoming/${storageKey}`;

  function pendingAsset(overrides: Record<string, unknown> = {}) {
    return {
      id: ASSET_ID,
      userId: USER.id,
      canvasId: CANVAS_ID,
      storageKey,
      storageMode: "s3",
      filename: "photo.png",
      mimeType: "image/png",
      size: png.length,
      status: "PENDING",
      ...overrides,
    };
  }

  function stored(bytes: Buffer) {
    mocks.read.mockResolvedValue({
      body: new Response(new Uint8Array(bytes)).body,
      contentLength: bytes.length,
      etag: "x",
    });
  }

  function request() {
    return confirm(
      post("/api/v1/upload/direct/confirm", { assetId: ASSET_ID }),
    );
  }

  beforeEach(() => {
    mocks.db.uploadAsset.findUnique.mockResolvedValue(pendingAsset());
    mocks.head.mockResolvedValue({
      contentLength: png.length,
      contentType: "image/png",
    });
    stored(png);
    mocks.activateUploadAsset.mockResolvedValue(pendingAsset());
  });

  it("checks the stored object, copies it to the asset key and activates it", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assetId: ASSET_ID,
      url: `/api/v1/uploads/${ASSET_ID}`,
      filename: "photo.png",
      size: png.length,
      type: "image/png",
      storage: "s3",
    });
    expect(mocks.head).toHaveBeenCalledWith(stagingKey);
    expect(mocks.write).toHaveBeenCalledWith(
      "s3",
      storageKey,
      expect.any(Buffer),
      "image/png",
    );
    expect(Buffer.compare(mocks.write.mock.calls[0]![2], png)).toBe(0);
    expect(mocks.activateUploadAsset).toHaveBeenCalledWith(mocks.db, ASSET_ID);
    expect(mocks.remove).toHaveBeenCalledWith("s3", stagingKey);
    expect(mocks.requireCanvasAccess).toHaveBeenCalledWith(
      CANVAS_ID,
      USER.id,
      USER.email,
      "EDIT",
    );
  });

  it("requires a session", async () => {
    mocks.session = null;
    expect((await request()).status).toBe(401);
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it("hides another user's upload", async () => {
    mocks.db.uploadAsset.findUnique.mockResolvedValue(
      pendingAsset({ userId: "user-2" }),
    );
    expect((await request()).status).toBe(404);
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it("refuses an upload that was not stored with S3", async () => {
    mocks.db.uploadAsset.findUnique.mockResolvedValue(
      pendingAsset({ storageMode: "local" }),
    );
    expect((await request()).status).toBe(404);
  });

  it("re-checks canvas access", async () => {
    mocks.requireCanvasAccess.mockRejectedValue(new ForbiddenError());
    expect((await request()).status).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps the reservation when the object has not arrived", async () => {
    mocks.head.mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(409);
    expect(mocks.failUploadReservation).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.activateUploadAsset).not.toHaveBeenCalled();
  });

  async function expectRejected(status: number) {
    const response = await request();
    expect(response.status).toBe(status);
    expect(mocks.failUploadReservation).toHaveBeenCalledWith(
      mocks.db,
      ASSET_ID,
      "direct_upload_rejected",
    );
    expect(mocks.remove).toHaveBeenCalledWith("s3", stagingKey);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.activateUploadAsset).not.toHaveBeenCalled();
    return response;
  }

  it("rejects an object above the cap", async () => {
    vi.stubEnv("UPLOAD_DIRECT_MAX_BYTES", "1000");
    mocks.head.mockResolvedValue({
      contentLength: 1001,
      contentType: "image/png",
    });
    await expectRejected(413);
  });

  it("rejects an object of another size than reserved", async () => {
    mocks.head.mockResolvedValue({
      contentLength: png.length + 1,
      contentType: "image/png",
    });
    await expectRejected(400);
  });

  it("rejects an object stored with another type", async () => {
    mocks.head.mockResolvedValue({
      contentLength: png.length,
      contentType: "text/html",
    });
    await expectRejected(400);
  });

  it("rejects content that is not the reserved type", async () => {
    const html = Buffer.alloc(png.length, 0x3c);
    stored(html);
    const response = await expectRejected(400);
    expect((await response.json()).detail).toBe(
      "File type does not match content",
    );
  });

  it("rejects a body longer than its HEAD said", async () => {
    stored(Buffer.concat([png, Buffer.from([0])]));
    await expectRejected(413);
  });

  it("returns the asset again for a repeated confirm", async () => {
    mocks.db.uploadAsset.findUnique.mockResolvedValue(
      pendingAsset({ status: "ACTIVE" }),
    );
    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json()).assetId).toBe(ASSET_ID);
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it("refuses an expired reservation", async () => {
    mocks.db.uploadAsset.findUnique.mockResolvedValue(
      pendingAsset({ status: "FAILED" }),
    );
    expect((await request()).status).toBe(409);
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it("removes the copied object when the reservation expired meanwhile", async () => {
    mocks.activateUploadAsset.mockRejectedValue(
      new UploadNotPendingError(ASSET_ID),
    );
    mocks.db.uploadAsset.findUnique
      .mockResolvedValueOnce(pendingAsset())
      .mockResolvedValueOnce({ status: "FAILED" });
    const response = await request();
    expect(response.status).toBe(409);
    expect(mocks.compensateWrittenUpload).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({ assetId: ASSET_ID, storageKey }),
    );
  });

  it("does not remove the object when a concurrent confirm activated it", async () => {
    mocks.activateUploadAsset.mockRejectedValue(
      new UploadNotPendingError(ASSET_ID),
    );
    mocks.db.uploadAsset.findUnique
      .mockResolvedValueOnce(pendingAsset())
      .mockResolvedValueOnce({ status: "ACTIVE" });
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.compensateWrittenUpload).not.toHaveBeenCalled();
  });
});

describe("upload.direct.expire job", () => {
  it("fails the reservation and deletes the staging object, twice safely", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const handler = createDirectUploadExpireHandler(mocks.db as never, remove);
    const job = {
      id: "job-1",
      payload: { assetId: ASSET_ID, stagingKey: "incoming/uploads/u/x.png" },
    } as never;
    await handler(job);
    await handler(job);
    expect(mocks.failUploadReservation).toHaveBeenCalledTimes(2);
    expect(mocks.failUploadReservation).toHaveBeenCalledWith(
      mocks.db,
      ASSET_ID,
      "direct_upload_expired",
    );
    expect(remove).toHaveBeenCalledWith(
      "s3",
      "incoming/uploads/u/x.png",
      undefined,
    );
  });

  it("never deletes outside the staging prefix", async () => {
    const remove = vi.fn();
    const handler = createDirectUploadExpireHandler(mocks.db as never, remove);
    await expect(
      handler({
        id: "job-1",
        payload: { assetId: ASSET_ID, stagingKey: "uploads/u/x.png" },
      } as never),
    ).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
});
