/**
 * Video cards (IMP-114): notes tied to moments of a saved video, and the
 * video's transcript.
 *
 * A video card is a saved link (BOOKMARK) or a link preview (EMBED) whose
 * address is a known video (`parseVideoLink`). Nothing from the video's site
 * runs in the canvas (DEC-011): a note's moment is an ordinary link that
 * opens the video in a new tab.
 *
 * A transcript is pasted by a person, or, only when the deployment switches
 * on VIDEO_TRANSCRIPT_FETCH (DEC-018) and the canvas owner keeps link reading
 * on, read from a YouTube video's public captions by the `video.transcript`
 * job. That job is safe to run twice and fails quietly. A transcript is
 * untrusted text: shown as plain text only and marked as data wherever AI
 * reads it. Notes and transcripts are deleted with their item.
 */

import { z } from "zod";
import { ItemType, Prisma, type PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import type { OutboxHandler } from "@/lib/outbox/types";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import { describeEmbedTarget } from "@/lib/product-surfaces";
import { trimToBytes } from "@/lib/services/page-copy";
import {
  MAX_VIDEO_SECONDS,
  parseVideoLink,
  type VideoLink,
} from "./video-link";
import { fetchYoutubeCaptions } from "./youtube-captions";

const logger = createLogger("video-items");

type Store = Prisma.TransactionClient | PrismaClient;

export const VIDEO_BUDGET = RESOURCE_BUDGETS.videoTranscript;
export const VIDEO_TRANSCRIPT_JOB = "video.transcript";
/** One watch page and one caption file. */
export const VIDEO_TRANSCRIPT_TIMEOUT_MS = 45_000;
const VIDEO_TRANSCRIPT_MAX_ATTEMPTS = 3;

const VIDEO_ITEM_TYPES: ReadonlySet<string> = new Set([
  ItemType.BOOKMARK,
  ItemType.EMBED,
]);

/** The deployment reads public captions automatically (off unless set). */
export function transcriptFetchEnabled(): boolean {
  return process.env.VIDEO_TRANSCRIPT_FETCH === "true";
}

export interface VideoTarget {
  url: string;
  video: VideoLink;
  title: string | null;
  host: string;
}

/** The video an item is, or null when it is not a video card. */
export function videoOfItem(item: {
  type: string;
  content: unknown;
}): VideoTarget | null {
  if (!VIDEO_ITEM_TYPES.has(item.type)) return null;
  const content =
    item.content && typeof item.content === "object"
      ? (item.content as Record<string, unknown>)
      : {};
  const video = parseVideoLink(content.url);
  if (!video) return null;
  const url = content.url as string;
  const title =
    typeof content.title === "string" && content.title.trim()
      ? content.title.trim()
      : null;
  return { url, video, title, host: describeEmbedTarget(url) };
}

export const videoNoteSchema = z
  .object({
    seconds: z.number().int().min(0).max(MAX_VIDEO_SECONDS),
    text: z.string().trim().min(1).max(VIDEO_BUDGET.maxNoteChars),
  })
  .strict();

export const transcriptSchema = z
  .object({
    // Characters; the byte budget is checked on the trimmed text.
    text: z.string().max(VIDEO_BUDGET.maxBytesPerVideo),
  })
  .strict();

async function lockAccount(tx: Store, userId: string) {
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM (SELECT pg_advisory_xact_lock(hashtext('video-transcript'), hashtext(${userId}))) AS acquired
  `;
}

export type StoreTranscriptResult =
  "stored" | "empty" | "too-large" | "over-budget";

/**
 * Keep a video's transcript, within the per-video and per-account budgets.
 * Call inside a transaction: the account lock keeps two writers from both
 * passing the budget check. Pasted text over the per-video budget is
 * refused (`too-large`); fetched text is cut to it.
 */
export async function storeTranscript(
  tx: Store,
  input: {
    itemId: string;
    userId: string;
    url: string;
    text: string;
    source: "PASTED" | "FETCHED";
    language?: string | null;
    fetchedAt?: Date | null;
  },
): Promise<StoreTranscriptResult> {
  let text = input.text.trim();
  if (!text) return "empty";
  if (Buffer.byteLength(text, "utf8") > VIDEO_BUDGET.maxBytesPerVideo) {
    if (input.source === "PASTED") return "too-large";
    text = trimToBytes(text, VIDEO_BUDGET.maxBytesPerVideo);
  }
  const textBytes = Buffer.byteLength(text, "utf8");
  await lockAccount(tx, input.userId);
  const used = await tx.itemTranscript.aggregate({
    where: { userId: input.userId, itemId: { not: input.itemId } },
    _sum: { textBytes: true },
  });
  if (
    (used._sum.textBytes ?? 0) + textBytes >
    VIDEO_BUDGET.maxBytesPerAccount
  ) {
    logger.info(
      { itemId: input.itemId },
      "Transcript not kept: the account's transcript budget is full",
    );
    return "over-budget";
  }
  const data = {
    userId: input.userId,
    url: input.url,
    text,
    textBytes,
    source: input.source,
    language: input.language ?? null,
    fetchedAt: input.fetchedAt ?? null,
  };
  await tx.itemTranscript.upsert({
    where: { itemId: input.itemId },
    create: { itemId: input.itemId, ...data },
    update: data,
  });
  return "stored";
}

/**
 * Remember that a video has no transcript on purpose: a person cleared it
 * (`PASTED`), or automatic fetching found none (`FETCHED`, with the time).
 * Either way the job does not read the captions again for this address.
 */
export async function recordNoTranscript(
  tx: Store,
  input: {
    itemId: string;
    userId: string;
    url: string;
    source: "PASTED" | "FETCHED";
    fetchedAt?: Date | null;
  },
) {
  const data = {
    userId: input.userId,
    url: input.url,
    text: "",
    textBytes: 0,
    source: input.source,
    language: null,
    fetchedAt: input.fetchedAt ?? null,
  };
  await tx.itemTranscript.upsert({
    where: { itemId: input.itemId },
    create: { itemId: input.itemId, ...data },
    update: data,
  });
}

/**
 * A short excerpt of each video's transcript around the first of `needles`
 * it contains, for search snippets and Ask context. With `fallbackToStart`,
 * a transcript without any needle gives its opening instead. Only the
 * excerpt leaves the database.
 */
export async function transcriptExcerpts(
  db: Store,
  itemIds: string[],
  needles: string[],
  options: { length?: number; before?: number; fallbackToStart?: boolean } = {},
): Promise<Map<string, string>> {
  const terms = needles.map((needle) => needle.trim()).filter(Boolean);
  if (
    itemIds.length === 0 ||
    (terms.length === 0 && !options.fallbackToStart)
  ) {
    return new Map();
  }
  const length = options.length ?? 180;
  const before = options.before ?? 60;
  const rows = await db.$queryRaw<Array<{ itemId: string; excerpt: string }>>`
    SELECT t."itemId",
      substring(t."text" FROM GREATEST(1, COALESCE(hit.at, 1) - ${before}) FOR ${length}) AS "excerpt"
    FROM "ItemTranscript" t
    LEFT JOIN LATERAL (
      SELECT MIN(x.pos) AS at
      FROM (
        SELECT strpos(lower(t."text"), lower(n)) AS pos
        FROM unnest(${terms}::text[]) AS n
      ) x
      WHERE x.pos > 0
    ) hit ON true
    WHERE t."itemId" IN (${Prisma.join(itemIds)})
      AND t."text" <> ''
      AND (hit.at IS NOT NULL OR ${Boolean(options.fallbackToStart)})
  `;
  return new Map(
    rows.map((row) => [row.itemId, row.excerpt.replace(/\s+/g, " ").trim()]),
  );
}

export function transcriptJobKey(itemId: string, video: VideoLink) {
  return `${VIDEO_TRANSCRIPT_JOB}:${itemId}:${video.id}`;
}

/**
 * Queue the caption read for a video item, when the deployment has it on,
 * the video is on YouTube and the canvas owner keeps link reading on.
 * Returns whether a job was queued (an existing one for the same video is
 * left as it is).
 */
export async function enqueueTranscriptFetch(
  tx: Store,
  input: { itemId: string; type: string; content: unknown; canvasId: string },
): Promise<boolean> {
  if (!transcriptFetchEnabled()) return false;
  const target = videoOfItem(input);
  if (!target || target.video.provider !== "youtube") return false;
  const canvas = await tx.canvas.findUnique({
    where: { id: input.canvasId },
    select: { user: { select: { autoEnrichLinks: true } } },
  });
  if (!canvas?.user.autoEnrichLinks) return false;
  await enqueueOutboxJobs(tx, [
    {
      type: VIDEO_TRANSCRIPT_JOB,
      payload: { itemId: input.itemId },
      dedupeKey: transcriptJobKey(input.itemId, target.video),
      maxAttempts: VIDEO_TRANSCRIPT_MAX_ATTEMPTS,
    },
  ]);
  return true;
}

/** Add a note at a moment of a video, within the per-video note limit. */
export async function addVideoNote(
  tx: Store,
  input: { itemId: string; authorId: string; seconds: number; text: string },
) {
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM (SELECT pg_advisory_xact_lock(hashtext('video-notes'), hashtext(${input.itemId}))) AS acquired
  `;
  const count = await tx.itemVideoNote.count({
    where: { itemId: input.itemId },
  });
  if (count >= VIDEO_BUDGET.maxNotesPerVideo) return null;
  return tx.itemVideoNote.create({
    data: {
      itemId: input.itemId,
      authorId: input.authorId,
      seconds: input.seconds,
      text: input.text,
    },
    select: { id: true, seconds: true, text: true, createdAt: true },
  });
}

class TranscriptFetchError extends Error {
  readonly retryable = true;
  constructor(status: number) {
    super(`Video captions could not be read (status ${status})`);
    this.name = "TranscriptFetchError";
  }
}

const itemPayloadSchema = z
  .object({ itemId: z.string().min(1).max(64) })
  .strict();

export interface VideoTranscriptOptions {
  fetchCaptions?: typeof fetchYoutubeCaptions;
  now?: () => Date;
}

/**
 * `video.transcript`: read one YouTube video's public captions and keep them
 * as its transcript. Does nothing when the switch is off, the owner turned
 * link reading off, a person pasted or cleared a transcript, or this address
 * was already read. When the video has no captions, or YouTube keeps not
 * answering, it records that there is none and stops.
 */
export function createVideoTranscriptHandler(
  prisma: PrismaClient,
  options: VideoTranscriptOptions = {},
): OutboxHandler {
  const fetchCaptions = options.fetchCaptions ?? fetchYoutubeCaptions;
  const now = options.now ?? (() => new Date());

  return async (job, context) => {
    if (!transcriptFetchEnabled()) return;
    const { itemId } = itemPayloadSchema.parse(job.payload);
    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, deletedAt: null },
      select: {
        type: true,
        content: true,
        canvas: { select: { userId: true } },
      },
    });
    const target = item ? videoOfItem(item) : null;
    if (!item || !target || target.video.provider !== "youtube") return;
    const userId = item.canvas.userId;
    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { autoEnrichLinks: true },
    });
    if (!owner?.autoEnrichLinks) return;

    const settled = (
      row: { url: string; source: string; fetchedAt: Date | null } | null,
    ) =>
      Boolean(
        row &&
        row.url === target.url &&
        (row.source === "PASTED" || row.fetchedAt),
      );
    const existing = await prisma.itemTranscript.findUnique({
      where: { itemId },
      select: { url: true, source: true, fetchedAt: true },
    });
    if (settled(existing)) return;

    const result = await fetchCaptions(target.video.id, {
      signal: context?.signal,
    });
    if (!result.ok) {
      if (result.reason === "unavailable" && job.attempts < job.maxAttempts) {
        throw new TranscriptFetchError(result.status);
      }
      logger.info(
        { itemId, reason: result.reason },
        "No transcript read for this video",
      );
    }
    context?.signal.throwIfAborted();

    await prisma.$transaction(async (tx) => {
      const current = await tx.canvasItem.findFirst({
        where: { id: itemId, deletedAt: null },
        select: { content: true },
      });
      // The item was deleted or now points elsewhere.
      if ((current?.content as { url?: unknown } | null)?.url !== target.url) {
        return;
      }
      // A person pasted or cleared a transcript while this was reading.
      const row = await tx.itemTranscript.findUnique({
        where: { itemId },
        select: { url: true, source: true, fetchedAt: true },
      });
      if (settled(row)) return;
      const fetchedAt = now();
      const stored = result.ok
        ? await storeTranscript(tx, {
            itemId,
            userId,
            url: target.url,
            text: result.text,
            source: "FETCHED",
            language: result.language,
            fetchedAt,
          })
        : "empty";
      if (stored !== "stored") {
        await recordNoTranscript(tx, {
          itemId,
          userId,
          url: target.url,
          source: "FETCHED",
          fetchedAt,
        });
      }
    });
  };
}
