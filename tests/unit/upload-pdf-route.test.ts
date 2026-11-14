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
import {
  declaredTypeMatches,
  detectUploadType,
} from "@/lib/uploads/file-types";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import { pngBytes } from "../helpers/image-fixtures";
import { pdfBytes } from "../helpers/pdf-fixtures";

const CANVAS_ID = "c" + "a".repeat(24);
const ASSET_ID = "c" + "b".repeat(24);
const upload = POST as unknown as (request: NextRequest) => Promise<Response>;

/** The route wrapper is mocked out, so errors arrive as thrown ApiErrors. */
async function outcome(request: Promise<NextRequest>) {
  try {
    const response = await upload(await request);
    return { status: response.status, detail: undefined };
  } catch (error) {
    const problem = error as { status?: number; detail?: string };
    return { status: problem.status ?? 500, detail: problem.detail };
  }
}

async function request(
  file: Buffer,
  type: string,
  options: { query?: string; name?: string } = {},
) {
  const form = new FormData();
  form.append("canvasId", CANVAS_ID);
  form.append("purpose", "pdf");
  form.append(
    "file",
    new Blob([new Uint8Array(file)], { type }),
    options.name ?? "report.pdf",
  );
  const encoded = new Response(form);
  return new NextRequest(
    `http://localhost/api/v1/upload${options.query ?? "?purpose=pdf"}`,
    {
      method: "POST",
      headers: {
        "content-type": encoded.headers.get("content-type") as string,
      },
      body: Buffer.from(await encoded.arrayBuffer()),
    },
  );
}

describe("PDF detection (IMP-113)", () => {
  it("recognises a PDF from its first bytes only", () => {
    expect(detectUploadType(pdfBytes(["hello"]))).toEqual({
      kind: "pdf",
      mime: "application/pdf",
      extension: ".pdf",
    });
    // A header after leading bytes, or without a version, is not accepted.
    expect(
      detectUploadType(Buffer.from(" %PDF-1.7\n%%EOF padding")),
    ).toBeNull();
    expect(detectUploadType(Buffer.from("%PDF-x.7\n%%EOF padding"))).toBeNull();
    expect(detectUploadType(Buffer.from("Just some words, report.pdf"))).toBe(
      null,
    );
  });

  it("matches the types browsers declare for PDFs", () => {
    const pdf = detectUploadType(pdfBytes(["x"]))!;
    expect(declaredTypeMatches("application/pdf", pdf)).toBe(true);
    expect(declaredTypeMatches("application/x-pdf", pdf)).toBe(true);
    expect(declaredTypeMatches("image/png", pdf)).toBe(false);
  });
});

describe("POST /api/v1/upload?purpose=pdf (IMP-113)", () => {
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
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("stores a PDF privately, charged to the upload allowance", async () => {
    const response = await upload(
      await request(pdfBytes(["hello"]), "application/pdf"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      assetId: ASSET_ID,
      url: `/api/v1/uploads/${ASSET_ID}`,
      filename: "report.pdf",
      type: "application/pdf",
    });
    expect(mocks.requireCanvasAccess).toHaveBeenCalledWith(
      CANVAS_ID,
      "user-1",
      "user@example.com",
      "EDIT",
    );
    expect(mocks.reserveUploadAsset.mock.calls[0]![1]).toMatchObject({
      mimeType: "application/pdf",
      storageKey: expect.stringMatching(/\.pdf$/),
      maxFiles: 500,
      maxBytes: 100 * 1024 * 1024,
    });
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it("refuses a file that only claims to be a PDF", async () => {
    const fake = Buffer.from("Hello, I am a text file. ".repeat(10));
    expect(await outcome(request(fake, "application/pdf"))).toEqual({
      status: 400,
      detail: "This file is not a PDF",
    });
    expect(
      await outcome(request(pngBytes(8, 8), "application/pdf")),
    ).toMatchObject({ status: 400, detail: "This file is not a PDF" });
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a PDF whose declared type says otherwise", async () => {
    expect((await outcome(request(pdfBytes(["x"]), "image/png"))).status).toBe(
      400,
    );
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
  });

  it("keeps PDFs out of the picture upload", async () => {
    const result = await outcome(
      request(pdfBytes(["x"]), "application/pdf", { query: "" }),
    );
    expect(result.status).toBe(400);
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
  });

  it("refuses a PDF over the size limit in plain words", async () => {
    const big = Buffer.concat([
      pdfBytes(["x"]),
      Buffer.alloc(RESOURCE_BUDGETS.pdf.maxFileBytes),
    ]);
    const result = await outcome(request(big, "application/pdf"));
    expect(result.status).toBe(413);
    expect(mocks.reserveUploadAsset).not.toHaveBeenCalled();
  });

  it("accepts a PDF larger than the picture limit", async () => {
    const large = Buffer.concat([
      pdfBytes(["x"]),
      Buffer.alloc(6 * 1024 * 1024),
    ]);
    const response = await upload(await request(large, "application/pdf"));
    expect(response.status).toBe(200);
  });
});
