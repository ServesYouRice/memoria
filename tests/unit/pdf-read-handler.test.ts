import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxJob, PrismaClient } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  readPrivateUploadObject: vi.fn(),
  storePageCopy: vi.fn(),
  recordCanvasItemEvent: vi.fn(),
  invalidateCanvasCache: vi.fn(),
  lockCanvasForMutation: vi.fn(),
}));

vi.mock("@/lib/uploads/private-storage", () => ({
  readPrivateUploadObject: mocks.readPrivateUploadObject,
}));
vi.mock("@/lib/services/page-copy", () => ({
  storePageCopy: mocks.storePageCopy,
}));
vi.mock("@/lib/collaboration/committed-events", () => ({
  recordCanvasItemEvent: mocks.recordCanvasItemEvent,
}));
vi.mock("@/lib/cache/canvas-cache", () => ({
  invalidateCanvasCache: mocks.invalidateCanvasCache,
}));
vi.mock("@/lib/canvas/mutation-lock", () => ({
  lockCanvasForMutation: mocks.lockCanvasForMutation,
}));

import { createPdfReadHandler } from "@/lib/pdf/outbox-handler";
import { PDF_READ_LIMITS, type PdfReadResult } from "@/lib/pdf/read-pdf-text";
import { OutboxDeferError } from "@/lib/outbox/types";

const ITEM = "item-1";
const CANVAS = "canvas-1";
const ASSET = "c" + "b".repeat(24);
const FILE_URL = `/api/v1/uploads/${ASSET}`;

function job(): OutboxJob {
  return {
    id: "job-1",
    type: "pdf.read",
    payload: { itemId: ITEM },
    attempts: 1,
    maxAttempts: 4,
  } as OutboxJob;
}

function fakeDb(
  options: {
    content?: Record<string, unknown>;
    asset?: Record<string, unknown> | null;
    existingCopy?: { url: string } | null;
  } = {},
) {
  const state = {
    content: {
      assetId: ASSET,
      filename: "report.pdf",
      size: 1234,
      ...options.content,
    } as Record<string, unknown>,
    version: 3,
    deletedCopies: 0,
  };
  const asset =
    options.asset === null
      ? null
      : {
          canvasId: CANVAS,
          mimeType: "application/pdf",
          status: "ACTIVE",
          size: 1234,
          storageMode: "local",
          storageKey: "uploads/u1/report.pdf",
          ...options.asset,
        };
  const client = {
    canvasItem: {
      findFirst: vi.fn(
        async ({ select }: { select: Record<string, unknown> }) =>
          select.canvas
            ? {
                canvasId: CANVAS,
                content: state.content,
                canvas: { userId: "owner-1" },
              }
            : {
                version: state.version,
                content: state.content,
                createdById: "u1",
                updatedById: "u2",
              },
      ),
      updateMany: vi.fn(
        async ({ data }: { data: { content: Record<string, unknown> } }) => {
          state.content = data.content;
          state.version += 1;
          return { count: 1 };
        },
      ),
    },
    uploadAsset: { findUnique: vi.fn(async () => asset) },
    itemPageCopy: {
      findUnique: vi.fn(async () => options.existingCopy ?? null),
      deleteMany: vi.fn(async () => {
        state.deletedCopies += 1;
        return { count: 0 };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };
  return { client: client as unknown as PrismaClient, raw: client, state };
}

function objectOf(bytes: Uint8Array) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    etag: "x",
  };
}

describe("pdf.read (IMP-113)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readPrivateUploadObject.mockResolvedValue(
      objectOf(new Uint8Array([37, 80, 68, 70])),
    );
    mocks.storePageCopy.mockResolvedValue("stored");
  });

  it("keeps the text in the saved-text store and writes pages and status onto the card", async () => {
    const db = fakeDb();
    const read = vi.fn(async (): Promise<PdfReadResult> => ({
      status: "text",
      pageCount: 12,
      text: "Only inside the file: wombat",
      truncated: false,
    }));
    await createPdfReadHandler(db.client, { read })(job());

    expect(read).toHaveBeenCalledTimes(1);
    expect(mocks.storePageCopy).toHaveBeenCalledWith(
      db.raw,
      expect.objectContaining({
        itemId: ITEM,
        userId: "owner-1",
        url: FILE_URL,
        text: "Only inside the file: wombat",
        maxBytes: PDF_READ_LIMITS.maxTextBytes,
      }),
    );
    expect(db.state.content).toMatchObject({
      assetId: ASSET,
      pageCount: 12,
      textStatus: "ready",
    });
    expect(mocks.recordCanvasItemEvent).toHaveBeenCalledWith(
      db.raw,
      expect.objectContaining({
        itemId: ITEM,
        version: 4,
        operation: "updated",
      }),
    );
    expect(mocks.invalidateCanvasCache).toHaveBeenCalledWith(CANVAS);
  });

  it("does nothing when the card's file was already read", async () => {
    const db = fakeDb({
      content: { textStatus: "ready", pageCount: 2 },
      existingCopy: { url: FILE_URL },
    });
    const read = vi.fn();
    await createPdfReadHandler(db.client, { read })(job());
    expect(read).not.toHaveBeenCalled();
    expect(db.raw.canvasItem.updateMany).not.toHaveBeenCalled();
  });

  it("reads a pasted card again: its text belongs to the original", async () => {
    const db = fakeDb({
      content: { textStatus: "ready", pageCount: 2 },
      existingCopy: null,
    });
    const read = vi.fn(async (): Promise<PdfReadResult> => ({
      status: "text",
      pageCount: 2,
      text: "words",
      truncated: false,
    }));
    await createPdfReadHandler(db.client, { read })(job());
    expect(read).toHaveBeenCalledTimes(1);
    expect(mocks.storePageCopy).toHaveBeenCalledTimes(1);
    // Same pages and status: the card is not rewritten.
    expect(db.raw.canvasItem.updateMany).not.toHaveBeenCalled();
  });

  it("never reads a file of another canvas into this card", async () => {
    const db = fakeDb({ asset: { canvasId: "someone-elses-canvas" } });
    const read = vi.fn();
    await createPdfReadHandler(db.client, { read })(job());
    expect(read).not.toHaveBeenCalled();
    expect(mocks.readPrivateUploadObject).not.toHaveBeenCalled();
    expect(mocks.storePageCopy).not.toHaveBeenCalled();
    expect(db.state.content).toMatchObject({ textStatus: "unreadable" });
  });

  it("never reads an upload that is not a PDF", async () => {
    const db = fakeDb({ asset: { mimeType: "image/png" } });
    const read = vi.fn();
    await createPdfReadHandler(db.client, { read })(job());
    expect(read).not.toHaveBeenCalled();
    expect(db.state.content).toMatchObject({ textStatus: "unreadable" });
  });

  it("says a file over the reading limit is too large, without reading it", async () => {
    const db = fakeDb({
      asset: { size: PDF_READ_LIMITS.maxReadBytes + 1 },
    });
    const read = vi.fn();
    await createPdfReadHandler(db.client, { read })(job());
    expect(read).not.toHaveBeenCalled();
    expect(mocks.readPrivateUploadObject).not.toHaveBeenCalled();
    expect(db.state.content).toMatchObject({ textStatus: "too-large" });
  });

  it("records too many pages and no text without keeping any", async () => {
    for (const [result, status] of [
      [{ status: "too-many-pages", pageCount: 900 }, "too-many-pages"],
      [{ status: "no-text", pageCount: 4 }, "no-text"],
    ] as const) {
      const db = fakeDb();
      await createPdfReadHandler(db.client, {
        read: async () => result,
      })(job());
      expect(mocks.storePageCopy).not.toHaveBeenCalled();
      expect(db.state.deletedCopies).toBe(1);
      expect(db.state.content).toMatchObject({
        textStatus: status,
        pageCount: result.pageCount,
      });
    }
  });

  it("says when the account's saved-text space is full", async () => {
    mocks.storePageCopy.mockResolvedValue("over-budget");
    const db = fakeDb();
    await createPdfReadHandler(db.client, {
      read: async () => ({
        status: "text",
        pageCount: 1,
        text: "words",
        truncated: true,
      }),
    })(job());
    expect(db.state.content).toMatchObject({ textStatus: "over-budget" });
  });

  it("waits, without using an attempt, while the file is still being stored", async () => {
    const db = fakeDb({ asset: { status: "PENDING" } });
    await expect(
      createPdfReadHandler(db.client, { read: vi.fn() })(job()),
    ).rejects.toBeInstanceOf(OutboxDeferError);
  });

  it("skips a card deleted or changed while its file was read", async () => {
    const db = fakeDb();
    const read = vi.fn(async (): Promise<PdfReadResult> => {
      db.state.content = { ...db.state.content, assetId: "c" + "z".repeat(24) };
      return { status: "text", pageCount: 1, text: "x", truncated: false };
    });
    await createPdfReadHandler(db.client, { read })(job());
    expect(mocks.storePageCopy).not.toHaveBeenCalled();
    expect(db.raw.canvasItem.updateMany).not.toHaveBeenCalled();
  });
});
