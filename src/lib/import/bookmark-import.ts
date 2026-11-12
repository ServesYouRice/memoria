/**
 * Background bookmark imports (IMP-091).
 *
 * The route stores the validated rows and enqueues one outbox job. The job
 * imports the rows in chunks; each chunk's items, counters and the `cursor`
 * are written in one transaction, so a rerun resumes after the last chunk
 * that committed and never saves a row twice. Links already saved anywhere in
 * the person's canvases are skipped and counted, so importing the same file
 * again adds nothing. Rows that do not fit a canvas or the canvas limit are
 * counted as over the limit. AI naming and tagging only runs when the person
 * turned it on for this import.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  BookmarkImportDestination,
  BookmarkImportStatus,
  ItemType,
  type BookmarkImport,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { recordCanvasItemEventsBatch } from "@/lib/collaboration/committed-events";
import { findOpenSlot } from "@/lib/agents/inbox";
import { assertCanvasCapacity, canvasItemRoom } from "@/lib/policy/capacity";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import { OutboxDeferError, type OutboxHandler } from "@/lib/outbox/types";
import {
  existingFor,
  findExistingLinks,
  normalizeLinkUrl,
} from "@/lib/services/duplicates";
import { enqueueLinkEnrichment } from "@/lib/services/link-enrichment";
import { findOrCreateInbox } from "@/lib/services/clip-batch";
import {
  importedLinkSchema,
  type ImportedLink,
  type ParsedBookmarkFile,
} from "./bookmark-file";

export const BOOKMARK_IMPORT_JOB = "bookmark.import";
/** Rows imported per transaction. */
export const BOOKMARK_IMPORT_CHUNK = 100;
/** How long one run may take before it hands over to the next run. */
export const BOOKMARK_IMPORT_TIMEOUT_MS = 120_000;
const SAFETY_MARGIN_MS = 10_000;
const LINK_SIZE = { width: 360, height: 120 };

type Db = Prisma.TransactionClient | PrismaClient;

export interface BookmarkImportSummary {
  links: number;
  folders: string[];
  duplicates: number;
  invalid: number;
}

/** What the preview shows before anything is saved. */
export async function summarizeBookmarkFile(
  db: Db,
  userId: string,
  parsed: ParsedBookmarkFile,
): Promise<BookmarkImportSummary> {
  const urls = parsed.links.map((link) => link.url);
  const found = await findExistingLinks(db, userId, urls);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const url of urls) {
    const key = normalizeLinkUrl(url);
    if (existingFor(found, url).length > 0 || (key && seen.has(key))) {
      duplicates += 1;
    }
    if (key) seen.add(key);
  }
  return {
    links: parsed.links.length,
    folders: parsed.folders,
    duplicates,
    invalid: parsed.invalid,
  };
}

export function bookmarkImportResponse(record: BookmarkImport) {
  return {
    id: record.id,
    status: record.status,
    destination: record.destination,
    enrich: record.enrich,
    fileName: record.fileName,
    total: record.total,
    processed: record.cursor,
    imported: record.imported,
    duplicates: record.duplicates,
    overLimit: record.overLimit,
    invalid: record.invalid,
    failed: record.failed,
    error:
      record.status === BookmarkImportStatus.FAILED ? record.lastError : null,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  };
}

export async function createBookmarkImport(
  db: PrismaClient,
  input: {
    userId: string;
    fileName: string;
    parsed: ParsedBookmarkFile;
    destination: BookmarkImportDestination;
    enrich: boolean;
  },
) {
  const fileHash = createHash("sha256")
    .update(JSON.stringify(input.parsed.links))
    .digest("hex");
  return db.$transaction(async (tx) => {
    const record = await tx.bookmarkImport.create({
      data: {
        userId: input.userId,
        destination: input.destination,
        enrich: input.enrich,
        fileName: input.fileName.slice(0, 200),
        format: input.parsed.format,
        fileHash,
        links: input.parsed.links as unknown as Prisma.InputJsonValue,
        total: input.parsed.links.length,
        invalid: input.parsed.invalid,
      },
    });
    await enqueueOutboxJob(tx, {
      type: BOOKMARK_IMPORT_JOB,
      dedupeKey: `${BOOKMARK_IMPORT_JOB}:${record.id}`,
      payload: { importId: record.id },
      maxAttempts: 5,
    });
    return record;
  });
}

function isQuotaError(error: unknown) {
  return error instanceof ApiError && error.status === 422;
}

/** The canvas for one top-level folder: reused by name, else created. */
async function folderCanvas(
  tx: Prisma.TransactionClient,
  userId: string,
  name: string,
  known: Record<string, string>,
): Promise<string | null> {
  const remembered = known[name];
  if (remembered) {
    const still = await tx.canvas.findFirst({
      where: { id: remembered, userId },
      select: { id: true },
    });
    if (still) return still.id;
  }
  const find = () =>
    tx.canvas.findFirst({
      where: { userId, name },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  let canvas = await find();
  if (!canvas) {
    try {
      await assertCanvasCapacity(tx, userId);
    } catch (error) {
      if (isQuotaError(error)) return null;
      throw error;
    }
    canvas =
      (await find()) ??
      (await tx.canvas.create({
        data: { userId, name },
        select: { id: true },
      }));
  }
  known[name] = canvas.id;
  return canvas.id;
}

async function inboxCanvas(tx: Prisma.TransactionClient, userId: string) {
  try {
    return await findOrCreateInbox(tx, userId);
  } catch (error) {
    if (isQuotaError(error)) return null;
    throw error;
  }
}

/** Import the next chunk. Returns true when the import has finished. */
export async function importNextChunk(
  db: PrismaClient,
  importId: string,
): Promise<boolean> {
  const touched = new Set<string>();
  const finished = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM "BookmarkImport" WHERE "id" = ${importId} FOR UPDATE`;
      const record = await tx.bookmarkImport.findUnique({
        where: { id: importId },
      });
      if (
        !record ||
        record.status === BookmarkImportStatus.COMPLETED ||
        record.status === BookmarkImportStatus.FAILED
      ) {
        return true;
      }
      const rows = z
        .array(importedLinkSchema)
        .parse(record.links)
        .slice(record.cursor, record.cursor + BOOKMARK_IMPORT_CHUNK);
      if (rows.length === 0) {
        await tx.bookmarkImport.update({
          where: { id: importId },
          data: {
            status: BookmarkImportStatus.COMPLETED,
            startedAt: record.startedAt ?? new Date(),
            completedAt: new Date(),
          },
        });
        return true;
      }

      const { userId } = record;
      const known = { ...(record.folderCanvases as Record<string, string>) };
      let overLimit = 0;
      let failed = 0;
      let inbox: string | null | undefined;
      const groups = new Map<string, ImportedLink[]>();
      for (const link of rows) {
        let target: string | null;
        if (
          record.destination === BookmarkImportDestination.FOLDERS &&
          link.folder
        ) {
          target = await folderCanvas(tx, userId, link.folder, known);
        } else {
          if (inbox === undefined) inbox = await inboxCanvas(tx, userId);
          target = inbox;
        }
        if (!target) {
          overLimit += 1;
          continue;
        }
        groups.set(target, [...(groups.get(target) ?? []), link]);
      }

      let imported = 0;
      let duplicates = 0;
      const seen = new Set<string>();
      // Lock canvases in id order so concurrent imports cannot deadlock.
      for (const canvasId of [...groups.keys()].sort()) {
        const links = groups.get(canvasId)!;
        await lockCanvasForMutation(tx, canvasId);
        const found = await findExistingLinks(
          tx,
          userId,
          links.map((link) => link.url),
        );
        const fresh = links.filter((link) => {
          const key = normalizeLinkUrl(link.url);
          if (
            existingFor(found, link.url).length > 0 ||
            (key && seen.has(key))
          ) {
            duplicates += 1;
            return false;
          }
          if (key) seen.add(key);
          return true;
        });
        const room = await canvasItemRoom(tx, canvasId);
        const accepted = fresh.slice(0, room);
        overLimit += fresh.length - accepted.length;
        if (accepted.length === 0) continue;

        const occupied = await tx.canvasItem.findMany({
          where: { canvasId, deletedAt: null },
          select: {
            positionX: true,
            positionY: true,
            width: true,
            height: true,
          },
        });
        let slotIndex = 0;
        const saved: {
          link: ImportedLink;
          row: Prisma.CanvasItemCreateManyInput;
        }[] = [];
        for (const link of accepted) {
          let content: unknown;
          try {
            content = parseCanvasItemContent(ItemType.BOOKMARK, {
              url: link.url,
              title: link.title || link.url,
            });
          } catch {
            failed += 1;
            continue;
          }
          const slot = findOpenSlot(occupied, LINK_SIZE, slotIndex);
          slotIndex = slot.index;
          const rect = { positionX: slot.x, positionY: slot.y, ...LINK_SIZE };
          occupied.push(rect);
          saved.push({
            link,
            row: {
              canvasId,
              type: ItemType.BOOKMARK,
              ...rect,
              zIndex: 1,
              content: content as Prisma.InputJsonValue,
              tags: link.tags,
              normalizedUrl: normalizeLinkUrl(link.url),
              createdById: userId,
              updatedById: userId,
            },
          });
        }
        if (saved.length === 0) continue;
        const items = await tx.canvasItem.createManyAndReturn({
          data: saved.map((entry) => entry.row),
          select: { id: true, version: true },
        });
        await recordCanvasItemEventsBatch(
          tx,
          items.map((item) => ({
            canvasId,
            actorId: userId,
            itemId: item.id,
            version: item.version,
            operation: "created" as const,
          })),
        );
        if (record.enrich) {
          await enqueueLinkEnrichment(
            tx,
            userId,
            items.map((item, index) => ({
              itemId: item.id,
              baseTitle: saved[index]!.link.title || null,
              baseTags: saved[index]!.link.tags,
            })),
          );
        }
        imported += items.length;
        touched.add(canvasId);
      }

      await tx.bookmarkImport.update({
        where: { id: importId },
        data: {
          status: BookmarkImportStatus.RUNNING,
          startedAt: record.startedAt ?? new Date(),
          cursor: { increment: rows.length },
          imported: { increment: imported },
          duplicates: { increment: duplicates },
          overLimit: { increment: overLimit },
          failed: { increment: failed },
          folderCanvases: known,
        },
      });
      return false;
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
  await Promise.all([...touched].map((id) => invalidateCanvasCache(id)));
  return finished;
}

const payloadSchema = z.object({ importId: z.string().cuid() }).strict();

export function createBookmarkImportHandler(db: PrismaClient): OutboxHandler {
  return async (job, context) => {
    const { importId } = payloadSchema.parse(job.payload);
    const deadline =
      (context?.deadlineAt.getTime() ??
        Date.now() + BOOKMARK_IMPORT_TIMEOUT_MS) - SAFETY_MARGIN_MS;
    try {
      while (!(await importNextChunk(db, importId))) {
        if (context?.signal.aborted || Date.now() >= deadline) {
          // Committed chunks stay; the next run carries on from the cursor.
          throw new OutboxDeferError(new Date(), "Import continues");
        }
      }
    } catch (error) {
      if (error instanceof OutboxDeferError) throw error;
      if (job.attempts >= job.maxAttempts) {
        await db.bookmarkImport.updateMany({
          where: {
            id: importId,
            status: {
              in: [BookmarkImportStatus.QUEUED, BookmarkImportStatus.RUNNING],
            },
          },
          data: {
            status: BookmarkImportStatus.FAILED,
            lastError: "The import stopped after repeated errors.",
            completedAt: new Date(),
          },
        });
      }
      throw error;
    }
  };
}
