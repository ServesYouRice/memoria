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
vi.mock("fs/promises", () => ({
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
}));

import { POST } from "@/app/api/v1/upload/route";
import { pngBytes, gifBytes } from "../helpers/image-fixtures";

const CANVAS_ID = "c" + "a".repeat(24);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const upload = POST as unknown as (request: NextRequest) => Promise<Response>;

async function multipart(file: Buffer, type = "image/png") {
  const form = new FormData();
  form.append("canvasId", CANVAS_ID);
  form.append("file", new Blob([new Uint8Array(file)], { type }), "pic.png");
  const response = new Response(form);
  return {
    contentType: response.headers.get("content-type") as string,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

function bufferedRequest(
  contentType: string,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
) {
  return new NextRequest("http://localhost/api/v1/upload", {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body: Buffer.from(bytes),
  });
}

/** A chunked body: no Content-Length, and we can see how much was pulled. */
function chunkedRequest(
  contentType: string,
  prefix: Uint8Array,
  chunkSize: number,
  chunkCount: number,
) {
  const state = { pulled: 0 };
  let sentPrefix = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sentPrefix) {
        sentPrefix = true;
        controller.enqueue(prefix);
        state.pulled += prefix.byteLength;
        return;
      }
      if (state.pulled >= prefix.byteLength + chunkSize * chunkCount) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSize));
      state.pulled += chunkSize;
    },
  });
  const request = new NextRequest("http://localhost/api/v1/upload", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
  return { request, state };
}

async function expectRejection(promise: Promise<Response>, status: number) {
  await expect(promise).rejects.toMatchObject({ status });
}

describe("POST /api/v1/upload body bounds", () => {
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
    mocks.reserveUploadAsset.mockResolvedValue({ id: "asset-1" });
    mocks.activateUploadAsset.mockResolvedValue(undefined);
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("accepts a small, in-bounds image", async () => {
    const { contentType, bytes } = await multipart(pngBytes(64, 64));
    const response = await upload(bufferedRequest(contentType, bytes));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: "/api/v1/uploads/asset-1",
      type: "image/png",
    });
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized Content-Length with 413 before reading the body", async () => {
    const { contentType } = await multipart(pngBytes(8, 8));
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const request = new NextRequest("http://localhost/api/v1/upload", {
      method: "POST",
      headers: {
        "content-type": contentType,
        "content-length": String(MAX_FILE_SIZE * 4),
      },
      body,
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1]);

    await expectRejection(upload(request), 413);
    expect(pulled).toBeLessThanOrEqual(1); // at most the stream's priming pull
    expect(mocks.runIdempotent).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rejects a file just over 5 MB (within multipart overhead) with 413", async () => {
    const big = Buffer.concat([
      pngBytes(8, 8),
      Buffer.alloc(MAX_FILE_SIZE + 1024),
    ]);
    const { contentType, bytes } = await multipart(big);
    await expectRejection(upload(bufferedRequest(contentType, bytes)), 413);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rejects an oversized buffered body with 413 before the handler runs", async () => {
    const big = Buffer.concat([
      pngBytes(8, 8),
      Buffer.alloc(MAX_FILE_SIZE + 256 * 1024),
    ]);
    const { contentType, bytes } = await multipart(big);
    await expectRejection(upload(bufferedRequest(contentType, bytes)), 413);
    expect(mocks.runIdempotent).not.toHaveBeenCalled();
  });

  it("cuts off a chunked body with no Content-Length once it passes the cap", async () => {
    const { request, state } = chunkedRequest(
      "multipart/form-data; boundary=x",
      new Uint8Array([1, 2, 3]),
      1024 * 1024,
      200, // 200 MB offered; only a few MB may be pulled
    );

    await expectRejection(upload(request), 413);
    expect(state.pulled).toBeLessThan(MAX_FILE_SIZE + 4 * 1024 * 1024);
    expect(mocks.runIdempotent).not.toHaveBeenCalled();
  });

  it("rejects a lying Content-Length that understates a chunk-sized body", async () => {
    // Declared small, actually large: the streaming counter still catches it.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 8; i += 1) {
          controller.enqueue(new Uint8Array(1024 * 1024));
        }
        controller.close();
      },
    });
    const request = new NextRequest("http://localhost/api/v1/upload", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": "100",
      },
      body,
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1]);
    await expectRejection(upload(request), 413);
  });

  it("rejects a malformed Content-Length with 400", async () => {
    const { contentType, bytes } = await multipart(pngBytes(8, 8));
    const request = bufferedRequest(contentType, bytes);
    // Headers are immutable on NextRequest only for forbidden names; build a
    // stand-in whose header lookup returns a non-numeric length.
    const spy = vi
      .spyOn(request.headers, "get")
      .mockImplementation((name: string) =>
        name.toLowerCase() === "content-length"
          ? "abc"
          : name.toLowerCase() === "content-type"
            ? contentType
            : null,
      );
    await expectRejection(upload(request), 400);
    spy.mockRestore();
  });

  it("rejects a PNG that declares a decode-bomb canvas with 422", async () => {
    const { contentType, bytes } = await multipart(pngBytes(60_000, 60_000));
    expect(bytes.byteLength).toBeLessThan(2048); // tiny on the wire
    await expectRejection(upload(bufferedRequest(contentType, bytes)), 422);
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rejects a GIF with a frame bomb with 422", async () => {
    const { contentType, bytes } = await multipart(
      gifBytes(100, 100, 5_000),
      "image/gif",
    );
    await expectRejection(upload(bufferedRequest(contentType, bytes)), 422);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("applies the cap before idempotency hashing runs", async () => {
    const big = Buffer.concat([
      pngBytes(8, 8),
      Buffer.alloc(MAX_FILE_SIZE + 256 * 1024),
    ]);
    const { contentType, bytes } = await multipart(big);
    const request = bufferedRequest(contentType, bytes, {
      "x-idempotency-key": "key-1",
    });
    await expectRejection(upload(request), 413);
    expect(mocks.runIdempotent).not.toHaveBeenCalled();
  });
});
