/**
 * Optional full copy of saved pages (IMP-110): a picture and a PDF of each
 * saved link, so the page can be seen as it looked on the day it was saved.
 *
 * Off unless the deployment sets `PAGE_CAPTURE=true`. The work needs a
 * headless browser, so it runs as its own process (`pnpm worker:capture`,
 * compose profile `capture`) that handles only `link.capture` jobs; the
 * normal outbox worker only queues them. With the option off nothing is
 * queued and nothing extra runs.
 *
 * The files are `UploadAsset` rows: they count toward the owner's storage
 * quota (stopping at half of it, so captures never crowd out uploads), are
 * included in the account export, and go with the canvas or account. When a
 * link is deleted for good, `sweepOrphanPageCaptures` removes its files. Every
 * step is safe to run twice.
 *
 * The files are untrusted web content: the picture is only shown as an image
 * and the PDF is served sandboxed.
 */

import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  ItemType,
  UploadAssetStatus,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ApiError, NotFoundError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import type { OutboxHandler } from "@/lib/outbox/types";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import {
  UploadNotPendingError,
  activateUploadAsset,
  compensateWrittenUpload,
  enqueueUploadDeletion,
  failUploadReservation,
  reserveUploadAsset,
} from "@/lib/uploads/lifecycle";
import { writePrivateUploadObject } from "@/lib/uploads/private-storage";
import { validateUrlForSsrfWithDns } from "@/lib/utils/ssrf-protection";
import type { PageCaptureResult } from "@/lib/capture/browser";

const logger = createLogger("page-capture");

type Store = Prisma.TransactionClient | PrismaClient;

export const PAGE_CAPTURE_JOB = "link.capture";
/** One browser launch, one page load and the two files. */
export const PAGE_CAPTURE_TIMEOUT_MS = 120_000;
const PAGE_CAPTURE_MAX_ATTEMPTS = 3;
export const PAGE_CAPTURE_BUDGET = RESOURCE_BUDGETS.pageCapture;

const IMAGE_MIME_TYPE = "image/jpeg";
const PDF_MIME_TYPE = "application/pdf";

/** The deployment keeps a picture and a PDF of saved links (off unless set). */
export function pageCaptureEnabled(): boolean {
  return process.env.PAGE_CAPTURE === "true";
}

export type PageCaptureKind = "image" | "pdf";

function urlHash(url: string) {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

/** One job per link and address: a changed address is captured again. */
export function pageCaptureDedupeKey(itemId: string, url: string) {
  return `${PAGE_CAPTURE_JOB}:${itemId}:${urlHash(url)}`;
}

/**
 * Queue the capture of one saved link. Does nothing unless the deployment
 * turned page capture on, so callers need no check of their own.
 */
export async function enqueuePageCapture(
  tx: Store,
  input: { itemId: string; url: string },
) {
  if (!pageCaptureEnabled()) return;
  await enqueueOutboxJobs(tx, [
    {
      type: PAGE_CAPTURE_JOB,
      // The id names the stored files, so a retry of this job reuses them.
      payload: { itemId: input.itemId, captureId: nanoid(16) },
      dedupeKey: pageCaptureDedupeKey(input.itemId, input.url),
      maxAttempts: PAGE_CAPTURE_MAX_ATTEMPTS,
    },
  ]);
}

const payloadSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    captureId: z.string().min(1).max(64),
  })
  .strict();

export interface PageCaptureStorage {
  write: typeof writePrivateUploadObject;
}

export interface PageCaptureOptions {
  /** Takes the picture and the PDF; defaults to the headless browser. */
  capture?: (
    url: string,
    options: { signal?: AbortSignal },
  ) => Promise<PageCaptureResult>;
  /** The SSRF check on the saved address, before any browser starts. */
  validateUrl?: typeof validateUrlForSsrfWithDns;
  storage?: PageCaptureStorage;
  now?: () => Date;
}

/**
 * Keep one captured file as an upload of the link's canvas: reserve its
 * quota, write the object, activate it. Returns the asset id, or null when
 * the account is out of capture space or the file was already given up on.
 */
async function storeCaptureFile(
  prisma: PrismaClient,
  storage: PageCaptureStorage,
  input: {
    userId: string;
    canvasId: string;
    itemId: string;
    captureId: string;
    kind: PageCaptureKind;
    bytes: Buffer;
    finalAttempt: boolean;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  const isImage = input.kind === "image";
  const mimeType = isImage ? IMAGE_MIME_TYPE : PDF_MIME_TYPE;
  const filename = isImage ? "page.jpg" : "page.pdf";
  // The size is part of the key: a retry that took a different picture never
  // reuses a reservation made for other bytes.
  const storageKey = `captures/${input.captureId}/${input.bytes.length}-${filename}`;
  const storageMode = process.env.UPLOAD_STORAGE || "local";

  let asset = await prisma.uploadAsset.findUnique({ where: { storageKey } });
  if (asset?.status === UploadAssetStatus.ACTIVE) return asset.id;
  if (asset && asset.status !== UploadAssetStatus.PENDING) return null;
  if (!asset) {
    try {
      asset = await reserveUploadAsset(prisma, {
        userId: input.userId,
        canvasId: input.canvasId,
        storageKey,
        storageMode,
        filename,
        mimeType,
        size: input.bytes.length,
        maxFiles: PAGE_CAPTURE_BUDGET.maxFilesPerAccount,
        maxBytes: PAGE_CAPTURE_BUDGET.maxBytesPerAccount,
        sourceItemId: input.itemId,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        logger.info(
          { itemId: input.itemId, kind: input.kind },
          "Page capture not kept: the account's capture space is full",
        );
        return null;
      }
      throw error;
    }
  }
  try {
    await storage.write(
      storageMode,
      storageKey,
      input.bytes,
      mimeType,
      input.signal,
    );
  } catch (error) {
    // A retry finds the PENDING reservation and writes again; the last try
    // gives its quota back.
    if (input.finalAttempt) {
      await failUploadReservation(prisma, asset.id, "capture_write_failed");
    }
    throw error;
  }
  try {
    await activateUploadAsset(prisma, asset.id);
  } catch (error) {
    if (!(error instanceof UploadNotPendingError)) throw error;
    // The file was deleted (canvas or account) while it was written.
    await compensateWrittenUpload(prisma, {
      assetId: asset.id,
      userId: asset.userId,
      storageMode: asset.storageMode,
      storageKey: asset.storageKey,
      size: asset.size,
      reason: "capture_target_gone",
    });
    return null;
  }
  return asset.id;
}

/** `link.capture`: take and keep a picture and a PDF of one saved link. */
export function createPageCaptureHandler(
  prisma: PrismaClient,
  options: PageCaptureOptions = {},
): OutboxHandler {
  const validateUrl = options.validateUrl ?? validateUrlForSsrfWithDns;
  const storage = options.storage ?? { write: writePrivateUploadObject };
  const now = options.now ?? (() => new Date());

  return async (job, context) => {
    // A deployment that turned capture off drops queued jobs unread.
    if (!pageCaptureEnabled()) return;
    const { itemId, captureId } = payloadSchema.parse(job.payload);
    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, type: ItemType.BOOKMARK, deletedAt: null },
      select: {
        canvasId: true,
        content: true,
        canvas: { select: { userId: true } },
      },
    });
    const url = (item?.content as { url?: unknown } | null)?.url;
    if (!item || typeof url !== "string" || !url) return;
    const userId = item.canvas.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { autoEnrichLinks: true },
    });
    // Reading saved links' pages follows the person's link setting.
    if (!user?.autoEnrichLinks) return;

    const existing = await prisma.itemPageCapture.findUnique({
      where: { itemId },
      select: { url: true },
    });
    if (existing?.url === url) return;

    // An internal address is refused before any browser starts; the browser
    // is also held to the same rule for redirects and everything the page
    // loads.
    const allowed = await validateUrl(url);
    if (!allowed.valid) {
      logger.info(
        { itemId, reason: allowed.error },
        "Page capture refused: the address is not a public web page",
      );
      return;
    }

    const capture =
      options.capture ?? (await import("@/lib/capture/browser")).capturePage;
    let result: PageCaptureResult;
    try {
      result = await capture(url, { signal: context?.signal });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "retryable" in error &&
        error.retryable === false
      ) {
        // Refused (internal address) or over its limits: not worth trying again.
        logger.info(
          { itemId, error: error instanceof Error ? error.message : "error" },
          "Page capture not kept",
        );
        return;
      }
      throw error;
    }
    context?.signal.throwIfAborted();
    if (!result.image && !result.pdf) return;

    const finalAttempt = job.attempts >= job.maxAttempts;
    const files: Array<[PageCaptureKind, Buffer | null]> = [
      ["image", result.image],
      ["pdf", result.pdf],
    ];
    const stored: Record<PageCaptureKind, string | null> = {
      image: null,
      pdf: null,
    };
    for (const [kind, bytes] of files) {
      if (!bytes) continue;
      stored[kind] = await storeCaptureFile(prisma, storage, {
        userId,
        canvasId: item.canvasId,
        itemId,
        captureId,
        kind,
        bytes,
        finalAttempt,
        signal: context?.signal,
      });
    }
    const keep = [stored.image, stored.pdf].filter(
      (id): id is string => id !== null,
    );
    if (keep.length === 0) return;

    await prisma.$transaction(async (tx) => {
      const current = await tx.canvasItem.findFirst({
        where: { id: itemId },
        select: { content: true },
      });
      const previous = await tx.itemPageCapture.findUnique({
        where: { itemId },
      });
      // The link is gone, or points somewhere else now: these files belong
      // to nothing, so they are deleted again with their quota.
      if ((current?.content as { url?: unknown } | null)?.url !== url) {
        for (const id of keep) await enqueueUploadDeletion(tx, id);
        return;
      }
      const data = {
        userId,
        url,
        imageAssetId: stored.image,
        pdfAssetId: stored.pdf,
        capturedAt: now(),
      };
      await tx.itemPageCapture.upsert({
        where: { itemId },
        create: { itemId, ...data },
        update: data,
      });
      // The files of an earlier capture of another address are replaced.
      for (const id of [previous?.imageAssetId, previous?.pdfAssetId]) {
        if (id && !keep.includes(id)) {
          try {
            await enqueueUploadDeletion(tx, id);
          } catch (error) {
            // A file a canvas removal already took is done.
            if (!(error instanceof NotFoundError)) throw error;
          }
        }
      }
    });
  };
}

/**
 * Delete the capture files of links that no longer exist, and reservations
 * a crashed capture left PENDING for a day. A link removed for good takes its
 * `ItemPageCapture` row with it, but the files are separate uploads: this
 * queues their deletion (and releases their quota) in batches. Returns how
 * many it handled, so it can run as a retention step.
 */
export async function sweepOrphanPageCaptures(
  prisma: PrismaClient,
  limit: number,
): Promise<number> {
  const orphans = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT a."id" FROM "UploadAsset" a
    WHERE a."sourceItemId" IS NOT NULL
      AND a."status" IN ('PENDING', 'ACTIVE', 'RECONCILING')
      AND (
        NOT EXISTS (SELECT 1 FROM "CanvasItem" i WHERE i."id" = a."sourceItemId")
        OR (a."status" = 'PENDING' AND a."createdAt" < NOW() - INTERVAL '1 day')
      )
    ORDER BY a."id"
    LIMIT ${limit}
  `;
  let handled = 0;
  for (const { id } of orphans) {
    try {
      await prisma.$transaction((tx) => enqueueUploadDeletion(tx, id));
      handled += 1;
    } catch (error) {
      // A file a cascade already removed is done; others are tried tomorrow.
      logger.warn({ assetId: id, error }, "Capture file sweep skipped a file");
    }
  }
  return handled;
}
