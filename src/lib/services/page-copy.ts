/**
 * Saved page copies (IMP-094): the readable text of a saved link's page, kept
 * so the link stays useful after the site changes or disappears, and, when
 * the deployment and the person allow it, a link to an existing public
 * web-archive copy.
 *
 * New links get their text from the `link.enrich` job, which reads the page
 * anyway. The `link.page-copy` job reads one link on its own (links saved
 * earlier, and the archive lookup); `link.page-copy.backfill` walks links
 * saved before this feature in keyed pages. Every step is safe to run twice.
 *
 * The text is untrusted web content: it is only ever shown as plain text and
 * is marked as data wherever AI reads it.
 */

import { z } from "zod";
import { ItemType, Prisma, type PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import type { OutboxHandler } from "@/lib/outbox/types";
import { RESOURCE_BUDGETS } from "@/lib/policy/resource-budgets";
import {
  safeFetch,
  validateUrlForSsrfWithDns,
} from "@/lib/utils/ssrf-protection";
import { extractPageText, fetchLinkPage } from "./link-page";

const logger = createLogger("page-copy");

type Store = Prisma.TransactionClient | PrismaClient;

export const PAGE_COPY_JOB = "link.page-copy";
export const PAGE_COPY_BACKFILL_JOB = "link.page-copy.backfill";
/** One page fetch plus one archive lookup. */
export const PAGE_COPY_TIMEOUT_MS = 60_000;
export const PAGE_COPY_BACKFILL_TIMEOUT_MS = 30_000;
const PAGE_COPY_MAX_ATTEMPTS = 4;
/** Links one backfill step hands to `link.page-copy`. */
export const PAGE_COPY_BACKFILL_PAGE = 100;
/** Spread the backfill's page reads so one step does not hit many sites at once. */
const BACKFILL_SPACING_MS = 2_000;

export const PAGE_COPY_BUDGET = RESOURCE_BUDGETS.pageCopy;

export function pageCopyDedupeKey(itemId: string) {
  return `${PAGE_COPY_JOB}:${itemId}`;
}

/** The deployment allows public web-archive lookups (off unless set). */
export function webArchiveAvailable(): boolean {
  return process.env.WEB_ARCHIVE_LOOKUP === "true";
}

/** Cut text to at most `maxBytes` of UTF-8 without splitting a character. */
export function trimToBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  // Step back over continuation bytes (10xxxxxx) to a character boundary.
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

async function lockAccount(tx: Store, userId: string) {
  await tx.$queryRaw`
    SELECT 1 AS "locked"
    FROM (SELECT pg_advisory_xact_lock(hashtext('page-copy'), hashtext(${userId}))) AS acquired
  `;
}

export type StorePageCopyResult = "stored" | "empty" | "over-budget";

/**
 * Keep a link's page text, within the per-link and per-account budgets.
 * Call inside a transaction: the account lock keeps two jobs from both
 * passing the budget check. A link over the account budget keeps no text.
 */
export async function storePageCopy(
  tx: Store,
  input: {
    itemId: string;
    userId: string;
    url: string;
    text: string;
    readAt: Date;
  },
): Promise<StorePageCopyResult> {
  const text = trimToBytes(input.text.trim(), PAGE_COPY_BUDGET.maxBytesPerLink);
  if (!text) return "empty";
  const textBytes = Buffer.byteLength(text, "utf8");
  await lockAccount(tx, input.userId);
  const used = await tx.itemPageCopy.aggregate({
    where: { userId: input.userId, itemId: { not: input.itemId } },
    _sum: { textBytes: true },
  });
  if (
    (used._sum.textBytes ?? 0) + textBytes >
    PAGE_COPY_BUDGET.maxBytesPerAccount
  ) {
    logger.info(
      { itemId: input.itemId },
      "Page copy not kept: the account's page-copy budget is full",
    );
    return "over-budget";
  }
  const data = {
    userId: input.userId,
    url: input.url,
    text,
    textBytes,
    readAt: input.readAt,
  };
  await tx.itemPageCopy.upsert({
    where: { itemId: input.itemId },
    create: { itemId: input.itemId, ...data },
    update: data,
  });
  return "stored";
}

/** Record the result of a web-archive lookup, keeping any saved text. */
async function recordArchiveLookup(
  tx: Store,
  input: {
    itemId: string;
    userId: string;
    url: string;
    archiveUrl: string | null;
  },
) {
  const archive = {
    archiveUrl: input.archiveUrl,
    archiveCheckedAt: new Date(),
  };
  await tx.itemPageCopy.upsert({
    where: { itemId: input.itemId },
    create: {
      itemId: input.itemId,
      userId: input.userId,
      url: input.url,
      text: "",
      textBytes: 0,
      ...archive,
    },
    update: archive,
  });
}

const archiveAnswerSchema = z.object({
  archived_snapshots: z
    .object({
      closest: z
        .object({
          available: z.boolean().optional(),
          status: z.string().optional(),
          url: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const WAYBACK_LOOKUP = "https://archive.org/wayback/available?url=";

/**
 * The newest Internet Archive copy of `url`, or null. Sends the address to
 * archive.org, so callers check the deployment and the person's setting
 * first. An address the SSRF check refuses (private hosts, credentials in
 * the URL) is never sent.
 */
export async function findArchiveCopy(
  url: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof safeFetch } = {},
): Promise<string | null> {
  const allowed = await validateUrlForSsrfWithDns(url);
  if (!allowed.valid) return null;
  const fetchImpl = options.fetchImpl ?? safeFetch;
  const response = await fetchImpl(
    `${WAYBACK_LOOKUP}${encodeURIComponent(url)}`,
    {
      timeout: 10_000,
      maxSize: 64 * 1024,
      maxRedirects: 2,
      signal: options.signal,
    },
  );
  if (!response.ok || !response.data) return null;
  let parsed: z.infer<typeof archiveAnswerSchema>;
  try {
    parsed = archiveAnswerSchema.parse(JSON.parse(response.data));
  } catch {
    return null;
  }
  const closest = parsed.archived_snapshots?.closest;
  if (!closest?.available || !closest.url) return null;
  if (closest.status && closest.status !== "200") return null;
  let archive: URL;
  try {
    archive = new URL(closest.url);
  } catch {
    return null;
  }
  if (archive.hostname !== "web.archive.org") return null;
  archive.protocol = "https:";
  return archive.toString();
}

/**
 * A short excerpt of each link's saved page text around the first of
 * `needles` it contains, for search snippets and Ask context. With
 * `fallbackToStart`, a copy without any needle gives its opening instead.
 * Only the excerpt leaves the database.
 */
export async function pageCopyExcerpts(
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
    SELECT p."itemId",
      substring(p."text" FROM GREATEST(1, COALESCE(hit.at, 1) - ${before}) FOR ${length}) AS "excerpt"
    FROM "ItemPageCopy" p
    LEFT JOIN LATERAL (
      SELECT MIN(x.pos) AS at
      FROM (
        SELECT strpos(lower(p."text"), lower(n)) AS pos
        FROM unnest(${terms}::text[]) AS n
      ) x
      WHERE x.pos > 0
    ) hit ON true
    WHERE p."itemId" IN (${Prisma.join(itemIds)})
      AND p."text" <> ''
      AND (hit.at IS NOT NULL OR ${Boolean(options.fallbackToStart)})
  `;
  return new Map(
    rows.map((row) => [row.itemId, row.excerpt.replace(/\s+/g, " ").trim()]),
  );
}

/** Whether `link.enrich` should hand a link on for the archive lookup. */
export async function wantsArchiveLookup(db: Store, userId: string) {
  if (!webArchiveAvailable()) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { webArchiveLookup: true },
  });
  return Boolean(user?.webArchiveLookup);
}

export async function enqueuePageCopy(
  tx: Store,
  itemIds: string[],
  options: { spacingMs?: number } = {},
) {
  const now = Date.now();
  await enqueueOutboxJobs(
    tx,
    itemIds.map((itemId, index) => ({
      type: PAGE_COPY_JOB,
      payload: { itemId },
      dedupeKey: pageCopyDedupeKey(itemId),
      maxAttempts: PAGE_COPY_MAX_ATTEMPTS,
      ...(options.spacingMs
        ? { nextRunAt: new Date(now + index * options.spacingMs) }
        : {}),
    })),
  );
}

class PageCopyFetchError extends Error {
  readonly retryable = true;
  constructor(status: number) {
    super(`Page copy fetch failed with status ${status}`);
    this.name = "PageCopyFetchError";
  }
}

const itemPayloadSchema = z
  .object({ itemId: z.string().min(1).max(64) })
  .strict();

export interface PageCopyOptions {
  fetchPage?: typeof fetchLinkPage;
  findArchive?: typeof findArchiveCopy;
  now?: () => Date;
}

/** `link.page-copy`: read one saved link's page and keep its text. */
export function createPageCopyHandler(
  prisma: PrismaClient,
  options: PageCopyOptions = {},
): OutboxHandler {
  const fetchPage = options.fetchPage ?? fetchLinkPage;
  const findArchive = options.findArchive ?? findArchiveCopy;
  const now = options.now ?? (() => new Date());

  return async (job, context) => {
    const { itemId } = itemPayloadSchema.parse(job.payload);
    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, type: ItemType.BOOKMARK, deletedAt: null },
      select: { content: true, canvas: { select: { userId: true } } },
    });
    const url = (item?.content as { url?: unknown } | null)?.url;
    if (!item || typeof url !== "string" || !url) return;
    const userId = item.canvas.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { autoEnrichLinks: true, webArchiveLookup: true },
    });
    // Reading saved links' pages follows the person's link setting.
    if (!user?.autoEnrichLinks) return;

    const existing = await prisma.itemPageCopy.findUnique({
      where: { itemId },
      select: { url: true, readAt: true, archiveCheckedAt: true },
    });
    const sameUrl = existing?.url === url;
    const needText =
      process.env.FEATURE_BOOKMARK_UNFURLING !== "false" &&
      !(sameUrl && existing?.readAt);
    const needArchive =
      webArchiveAvailable() &&
      user.webArchiveLookup &&
      !(sameUrl && existing?.archiveCheckedAt);
    if (!needText && !needArchive) return;

    let text = "";
    if (needText) {
      const page = await fetchPage(url, { signal: context?.signal });
      if (page.ok) {
        text = extractPageText(page.html);
      } else if (job.attempts < job.maxAttempts) {
        throw new PageCopyFetchError(page.status);
      } else {
        logger.info(
          { itemId, status: page.status },
          "Page unavailable; no copy kept",
        );
      }
    }
    const archiveUrl = needArchive
      ? await findArchive(url, { signal: context?.signal })
      : undefined;
    context?.signal.throwIfAborted();

    await prisma.$transaction(async (tx) => {
      const current = await tx.canvasItem.findFirst({
        where: { id: itemId, deletedAt: null },
        select: { content: true },
      });
      // The link was deleted or replaced while it was being read.
      if ((current?.content as { url?: unknown } | null)?.url !== url) return;
      if (text) {
        await storePageCopy(tx, { itemId, userId, url, text, readAt: now() });
      }
      if (archiveUrl !== undefined) {
        await recordArchiveLookup(tx, { itemId, userId, url, archiveUrl });
      }
    });
  };
}

const backfillPayloadSchema = z
  .object({ after: z.string().min(1).max(64).optional() })
  .strict();

/**
 * `link.page-copy.backfill`: hand links saved before IMP-094 to
 * `link.page-copy`, one keyed page at a time. Only links whose owner keeps
 * link reading on are included.
 */
export function createPageCopyBackfillHandler(
  prisma: PrismaClient,
): OutboxHandler {
  return async (job) => {
    const { after } = backfillPayloadSchema.parse(job.payload);
    const rows = await prisma.canvasItem.findMany({
      where: {
        type: ItemType.BOOKMARK,
        deletedAt: null,
        pageCopy: { is: null },
        canvas: { isTemplate: false, user: { autoEnrichLinks: true } },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: PAGE_COPY_BACKFILL_PAGE,
      select: { id: true },
    });
    if (rows.length === 0) return;
    await prisma.$transaction(async (tx) => {
      await enqueuePageCopy(
        tx,
        rows.map((row) => row.id),
        { spacingMs: BACKFILL_SPACING_MS },
      );
      if (rows.length === PAGE_COPY_BACKFILL_PAGE) {
        const last = rows.at(-1)!.id;
        await enqueueOutboxJobs(tx, [
          {
            type: PAGE_COPY_BACKFILL_JOB,
            payload: { after: last },
            dedupeKey: `${PAGE_COPY_BACKFILL_JOB}:${last}`,
            // Start the next page once this one has mostly been read.
            nextRunAt: new Date(
              Date.now() + PAGE_COPY_BACKFILL_PAGE * BACKFILL_SPACING_MS,
            ),
          },
        ]);
      }
    });
  };
}
