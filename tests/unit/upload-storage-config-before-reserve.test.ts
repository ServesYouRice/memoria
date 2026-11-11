import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  reserveUploadAsset: vi.fn(),
  activateUploadAsset: vi.fn(),
  failUploadReservation: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/api/auth", () => ({
  requireAuth: vi.fn(async () => ({
    userId: "user-1",
    email: "user@example.com",
  })),
  requireCanvasAccess: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api/route-handler", () => ({
  withApiHandler: (handler: unknown) => handler,
  runIdempotent: (
    _request: unknown,
    _userId: string,
    handler: () => Promise<Response>,
  ) => handler(),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/uploads/lifecycle", () => ({
  reserveUploadAsset: mocks.reserveUploadAsset,
  activateUploadAsset: mocks.activateUploadAsset,
  failUploadReservation: mocks.failUploadReservation,
  compensateWrittenUpload: vi.fn(),
}));

import { POST } from "@/app/api/v1/upload/route";
import { pngBytes } from "../helpers/image-fixtures";

const CANVAS_ID = "c" + "a".repeat(24);
const upload = POST as unknown as (request: NextRequest) => Promise<Response>;

async function uploadError() {
  const form = new FormData();
  form.append("canvasId", CANVAS_ID);
  form.append(
    "file",
    new Blob([new Uint8Array(pngBytes(8, 8))], { type: "image/png" }),
    "a.png",
  );
  const encoded = new Response(form);
  const request = new NextRequest("http://localhost/api/v1/upload", {
    method: "POST",
    headers: { "content-type": encoded.headers.get("content-type") as string },
    body: Buffer.from(await encoded.arrayBuffer()),
  });
  try {
    await upload(request);
    return null;
  } catch (error) {
    return error as { status?: number; detail?: string };
  }
}

describe("POST /api/v1/upload checks S3 configuration before reserving quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reserveUploadAsset.mockResolvedValue({ id: "asset-1" });
    vi.stubEnv("UPLOAD_STORAGE", "s3");
    vi.stubEnv("S3_REGION", "");
    vi.stubEnv("S3_ACCESS_KEY_ID", "");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reserves nothing when S3_BUCKET is missing", async () => {
    vi.stubEnv("S3_BUCKET", "");
    const error = await uploadError();
    expect(error).toMatchObject({
      status: 500,
      detail: "S3_BUCKET is not configured",
    });
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
  });

  it("reserves nothing when the S3 credentials are missing", async () => {
    vi.stubEnv("S3_BUCKET", "uploads");
    const error = await uploadError();
    expect(error).toMatchObject({
      status: 500,
      detail: "S3 credentials are missing",
    });
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
  });
});
