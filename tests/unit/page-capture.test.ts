import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OutboxJob } from "@/lib/outbox/types";
import { ApiError } from "@/lib/errors";

const lifecycle = vi.hoisted(() => ({
  reserveUploadAsset: vi.fn(),
  activateUploadAsset: vi.fn(),
  failUploadReservation: vi.fn(),
  compensateWrittenUpload: vi.fn(),
  enqueueUploadDeletion: vi.fn(),
}));
vi.mock("@/lib/uploads/lifecycle", () => ({
  ...lifecycle,
  UploadNotPendingError: class UploadNotPendingError extends Error {},
}));

import {
  PAGE_CAPTURE_BUDGET,
  PAGE_CAPTURE_JOB,
  createPageCaptureHandler,
  enqueuePageCapture,
  pageCaptureDedupeKey,
  pageCaptureEnabled,
} from "@/lib/services/page-capture";

const URL_ = "https://news.example/story";

function job(overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    id: "job-1",
    type: PAGE_CAPTURE_JOB,
    payload: { itemId: "item-1", captureId: "cap-1" },
    attempts: 1,
    maxAttempts: 3,
    ...overrides,
  } as OutboxJob;
}

const allowed = async (url: string) => ({
  valid: true,
  pinnedIp: "93.184.216.34",
  targetUrl: new URL(url),
});

function fakePrisma(
  options: {
    url?: string;
    autoEnrichLinks?: boolean;
    existing?: { url: string } | null;
    previous?: {
      imageAssetId: string | null;
      pdfAssetId: string | null;
    } | null;
    currentUrl?: string | null;
    asset?: { id: string; status: string } | null;
  } = {},
) {
  const tx = {
    canvasItem: {
      findFirst: vi.fn(async () =>
        options.currentUrl === null
          ? null
          : { content: { url: options.currentUrl ?? options.url ?? URL_ } },
      ),
    },
    itemPageCapture: {
      findUnique: vi.fn(async () => options.previous ?? null),
      upsert: vi.fn(async () => ({})),
    },
  };
  const prisma = {
    canvasItem: {
      findFirst: vi.fn(async () => ({
        canvasId: "canvas-1",
        content: { url: options.url ?? URL_ },
        canvas: { userId: "user-1" },
      })),
    },
    user: {
      findUnique: vi.fn(async () => ({
        autoEnrichLinks: options.autoEnrichLinks ?? true,
      })),
    },
    itemPageCapture: {
      findUnique: vi.fn(async () => options.existing ?? null),
    },
    uploadAsset: {
      findUnique: vi.fn(async () => options.asset ?? null),
    },
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  };
  return { prisma: prisma as unknown as PrismaClient, mocks: prisma, tx };
}

const pictures = () => ({
  image: Buffer.from("jpeg-bytes"),
  pdf: Buffer.from("pdf-bytes"),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAGE_CAPTURE", "true");
  vi.stubEnv("UPLOAD_STORAGE", "local");
  let next = 0;
  lifecycle.reserveUploadAsset.mockImplementation(async (_prisma, input) => ({
    id: `asset-${(next += 1)}`,
    userId: input.userId,
    storageMode: input.storageMode,
    storageKey: input.storageKey,
    size: input.size,
  }));
  lifecycle.activateUploadAsset.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("page capture is optional (IMP-110)", () => {
  it("is off unless the deployment sets PAGE_CAPTURE=true", () => {
    vi.unstubAllEnvs();
    expect(pageCaptureEnabled()).toBe(false);
    vi.stubEnv("PAGE_CAPTURE", "false");
    expect(pageCaptureEnabled()).toBe(false);
    vi.stubEnv("PAGE_CAPTURE", "true");
    expect(pageCaptureEnabled()).toBe(true);
  });

  it("queues nothing while it is off", async () => {
    vi.stubEnv("PAGE_CAPTURE", "false");
    const createMany = vi.fn();
    await enqueuePageCapture(
      { outboxJob: { createMany } } as unknown as PrismaClient,
      { itemId: "item-1", url: URL_ },
    );
    expect(createMany).not.toHaveBeenCalled();
  });

  it("queues one job per link and address when it is on", async () => {
    const createMany = vi.fn();
    const store = { outboxJob: { createMany } } as unknown as PrismaClient;
    await enqueuePageCapture(store, { itemId: "item-1", url: URL_ });
    const [{ data }] = createMany.mock.calls[0]!;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      type: PAGE_CAPTURE_JOB,
      dedupeKey: pageCaptureDedupeKey("item-1", URL_),
      maxAttempts: 3,
    });
    expect(data[0].payload).toMatchObject({ itemId: "item-1" });
    expect(pageCaptureDedupeKey("item-1", URL_)).not.toBe(
      pageCaptureDedupeKey("item-1", `${URL_}-other`),
    );
  });

  it("does nothing when a queued job runs after it was turned off", async () => {
    vi.stubEnv("PAGE_CAPTURE", "false");
    const { prisma, mocks } = fakePrisma();
    const capture = vi.fn();
    await createPageCaptureHandler(prisma, { capture })(job());
    expect(mocks.canvasItem.findFirst).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("the capture job", () => {
  it("keeps a picture and a PDF as the owner's uploads and links them to the item", async () => {
    const { prisma, tx } = fakePrisma();
    const capture = vi.fn(async () => pictures());
    const write = vi.fn(async () => undefined);
    const now = new Date("2026-11-14T10:00:00Z");
    await createPageCaptureHandler(prisma, {
      capture,
      validateUrl: allowed,
      storage: { write },
      now: () => now,
    })(job());

    expect(capture).toHaveBeenCalledWith(URL_, expect.anything());
    // Charged to the owner, within the capture share of the quota.
    expect(lifecycle.reserveUploadAsset).toHaveBeenCalledTimes(2);
    expect(lifecycle.reserveUploadAsset).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: "user-1",
        canvasId: "canvas-1",
        sourceItemId: "item-1",
        mimeType: "image/jpeg",
        maxBytes: PAGE_CAPTURE_BUDGET.maxBytesPerAccount,
        maxFiles: PAGE_CAPTURE_BUDGET.maxFilesPerAccount,
      }),
    );
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map((call) => call[3])).toEqual([
      "image/jpeg",
      "application/pdf",
    ]);
    expect(lifecycle.activateUploadAsset).toHaveBeenCalledTimes(2);
    expect(tx.itemPageCapture.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "item-1" },
        create: expect.objectContaining({
          userId: "user-1",
          url: URL_,
          imageAssetId: "asset-1",
          pdfAssetId: "asset-2",
          capturedAt: now,
        }),
      }),
    );
  });

  it("refuses a page on an internal address before any browser starts", async () => {
    for (const url of [
      "http://127.0.0.1/admin",
      "http://localhost:3000/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://[::1]/",
    ]) {
      const { prisma, tx } = fakePrisma({ url });
      const capture = vi.fn();
      const write = vi.fn();
      await createPageCaptureHandler(prisma, {
        capture,
        storage: { write },
      })(job());
      expect(capture).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(tx.itemPageCapture.upsert).not.toHaveBeenCalled();
    }
    expect(lifecycle.reserveUploadAsset).not.toHaveBeenCalled();
  });

  it("keeps nothing when the browser refuses the page or a redirect target", async () => {
    const { prisma, tx } = fakePrisma();
    const refused = Object.assign(new Error("private address"), {
      retryable: false,
    });
    const capture = vi.fn(async () => {
      throw refused;
    });
    await createPageCaptureHandler(prisma, {
      capture,
      validateUrl: allowed,
    })(job());
    expect(lifecycle.reserveUploadAsset).not.toHaveBeenCalled();
    expect(tx.itemPageCapture.upsert).not.toHaveBeenCalled();
  });

  it("lets a failed load retry", async () => {
    const { prisma } = fakePrisma();
    const capture = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { retryable: true });
    });
    await expect(
      createPageCaptureHandler(prisma, { capture, validateUrl: allowed })(
        job(),
      ),
    ).rejects.toThrow("timed out");
  });

  it("does nothing the second time: a capture of this address exists", async () => {
    const { prisma } = fakePrisma({ existing: { url: URL_ } });
    const capture = vi.fn();
    await createPageCaptureHandler(prisma, { capture, validateUrl: allowed })(
      job(),
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it("follows the person's link-reading setting", async () => {
    const { prisma } = fakePrisma({ autoEnrichLinks: false });
    const capture = vi.fn();
    await createPageCaptureHandler(prisma, { capture, validateUrl: allowed })(
      job(),
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it("keeps no file the account has no capture space for", async () => {
    const { prisma, tx } = fakePrisma();
    lifecycle.reserveUploadAsset.mockRejectedValue(
      new ApiError(400, "x", "Upload quota exceeded", "full"),
    );
    const write = vi.fn();
    await createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write },
    })(job());
    expect(write).not.toHaveBeenCalled();
    expect(tx.itemPageCapture.upsert).not.toHaveBeenCalled();
  });

  it("deletes its files again when the link changed or went while it worked", async () => {
    const { prisma, tx } = fakePrisma({ currentUrl: "https://other.example/" });
    await createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write: vi.fn(async () => undefined) },
    })(job());
    expect(tx.itemPageCapture.upsert).not.toHaveBeenCalled();
    expect(lifecycle.enqueueUploadDeletion.mock.calls.map((c) => c[1])).toEqual(
      ["asset-1", "asset-2"],
    );
  });

  it("replaces the files of an earlier capture", async () => {
    const { prisma } = fakePrisma({
      previous: { imageAssetId: "old-image", pdfAssetId: "old-pdf" },
    });
    await createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write: vi.fn(async () => undefined) },
    })(job());
    expect(lifecycle.enqueueUploadDeletion.mock.calls.map((c) => c[1])).toEqual(
      ["old-image", "old-pdf"],
    );
  });

  it("gives the quota back when the last write attempt fails", async () => {
    const { prisma } = fakePrisma();
    const write = vi.fn(async () => {
      throw new Error("storage down");
    });
    const run = createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write },
    });
    await expect(run(job({ attempts: 1 }))).rejects.toThrow("storage down");
    expect(lifecycle.failUploadReservation).not.toHaveBeenCalled();
    await expect(run(job({ attempts: 3 }))).rejects.toThrow("storage down");
    expect(lifecycle.failUploadReservation).toHaveBeenCalledTimes(1);
  });

  it("reuses files an earlier try of the same job already activated", async () => {
    const { prisma } = fakePrisma({
      asset: { id: "asset-done", status: "ACTIVE" },
    });
    const write = vi.fn();
    await createPageCaptureHandler(prisma, {
      capture: async () => pictures(),
      validateUrl: allowed,
      storage: { write },
    })(job());
    expect(write).not.toHaveBeenCalled();
    expect(lifecycle.reserveUploadAsset).not.toHaveBeenCalled();
  });
});
