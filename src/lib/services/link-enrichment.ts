/**
 * Link enrichment (IMP-064): every link saved by a clip, a clip batch, the
 * share target or an agent's `inbox_save` gets one `link.enrich` outbox job.
 * The job unfurls the page through the SSRF-safe link fetch, asks the owner's
 * AI provider (when configured and within budget) for a title, tags and a
 * two-line summary, and writes them back without ever replacing a title or
 * tags the user changed. Without AI it keeps the unfurled title and
 * description only.
 *
 * Safe to run twice: the `ItemEnrichment` row is written in the same
 * transaction as the item, and a job whose row is no longer PENDING returns
 * without doing anything.
 *
 * When the provider supports embeddings (IMP-065) the job also stores the
 * link's `ItemEmbedding` and records other links that look like the same
 * page in `similarItemIds`; those are flagged, never blocked.
 */

import { createHash } from "crypto";

import {
  ItemEnrichmentStatus,
  ItemType,
  type Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { enqueueOutboxJobs } from "@/lib/outbox/enqueue";
import type { OutboxHandler } from "@/lib/outbox/types";
import { lockCanvasForMutation } from "@/lib/canvas/mutation-lock";
import { recordCanvasItemEvent } from "@/lib/collaboration/committed-events";
import { invalidateCanvasCache } from "@/lib/cache/canvas-cache";
import { parseCanvasItemContent } from "@/lib/validation/canvas-item";
import type { ExtractedMetadata } from "@/lib/utils/metadata-extractor";
import {
  isTransientAiBudgetError,
  suggestLinkDetails,
  type LinkAiInput,
  type LinkAiResult,
  type LinkAiSkipReason,
} from "@/lib/ai/enrich-link";
import { embedText, type EmbeddingResult } from "@/lib/ai/embeddings";
import {
  extractPageText,
  fetchLinkPage,
  type LinkPageResult,
} from "./link-page";
import { findSimilarLinks, normalizeLinkUrl } from "./duplicates";
import {
  enqueuePageCopy,
  storePageCopy,
  wantsArchiveLookup,
} from "./page-copy";

const logger = createLogger("link-enrichment");

export const LINK_ENRICH_JOB = "link.enrich";
/** Worker deadline: one page fetch plus one AI request. */
export const LINK_ENRICH_TIMEOUT_MS = 90_000;
/** The locked write is small; match the repository pattern for its budget. */
const LINK_ENRICH_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };
const LINK_ENRICH_MAX_ATTEMPTS = 4;
const MAX_ITEM_TAGS = 20;

type TransactionClient = Prisma.TransactionClient | PrismaClient;

export type EnrichedField =
  | "title"
  | "description"
  | "summary"
  | "tags"
  | "favicon"
  | "previewImage"
  | "siteName"
  | "embedding";

export interface LinkEnrichmentTarget {
  itemId: string;
  /** The title the item was saved with. */
  baseTitle?: string | null;
  /** The tags the item was saved with. */
  baseTags?: string[];
  /** The saver picked the title on purpose (e.g. an agent passed one). */
  titleLocked?: boolean;
}

export function linkEnrichmentDedupeKey(itemId: string) {
  return `${LINK_ENRICH_JOB}:${itemId}`;
}

/** Whether this user wants saved links enriched (Settings, on by default). */
export async function isLinkEnrichmentEnabled(
  db: TransactionClient,
  userId: string,
): Promise<boolean> {
  return (await linkEnrichmentSettings(db, userId)).enabled;
}

/** Whether links get enriched, and the person's own tagging rules (IMP-106). */
async function linkEnrichmentSettings(
  db: TransactionClient,
  userId: string,
): Promise<{ enabled: boolean; taggingRules: string | null }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { autoEnrichLinks: true, taggingRules: true },
  });
  return {
    enabled: Boolean(user?.autoEnrichLinks),
    taggingRules: user?.taggingRules ?? null,
  };
}

/**
 * Record and enqueue enrichment for freshly saved links. Call it inside the
 * transaction that creates the items so a link is never saved without its
 * job. Returns how many jobs were enqueued (0 when the user turned it off).
 */
export async function enqueueLinkEnrichment(
  tx: TransactionClient,
  userId: string,
  targets: LinkEnrichmentTarget[],
): Promise<number> {
  if (targets.length === 0) return 0;
  if (!(await isLinkEnrichmentEnabled(tx, userId))) return 0;
  await tx.itemEnrichment.createMany({
    data: targets.map((target) => ({
      itemId: target.itemId,
      userId,
      baseTitle: target.baseTitle ?? null,
      baseTags: target.baseTags ?? [],
      titleLocked: target.titleLocked ?? false,
    })),
    skipDuplicates: true,
  });
  await enqueueOutboxJobs(
    tx,
    targets.map((target) => ({
      type: LINK_ENRICH_JOB,
      payload: { itemId: target.itemId },
      dedupeKey: linkEnrichmentDedupeKey(target.itemId),
      maxAttempts: LINK_ENRICH_MAX_ATTEMPTS,
    })),
  );
  return targets.length;
}

interface BookmarkContentLike {
  url: string;
  title?: string;
  description?: string;
  summary?: string;
  favicon?: string;
  previewImage?: string;
  siteName?: string;
  unfurledAt?: string;
  [key: string]: unknown;
}

export interface EnrichmentBase {
  baseTitle: string | null;
  baseTags: string[];
  titleLocked: boolean;
  filledTitle: string | null;
  filledTags: string[];
}

export interface LinkEnrichmentPlan {
  content: BookmarkContentLike;
  tags: string[];
  changed: boolean;
  filledFields: EnrichedField[];
  filledTitle: string | null;
  filledTags: string[];
  aiSkipReason: LinkAiSkipReason | null;
}

function sameTagSet(a: string[], b: string[]) {
  const left = new Set(a.map((tag) => tag.toLowerCase()));
  const right = new Set(b.map((tag) => tag.toLowerCase()));
  return left.size === right.size && [...left].every((tag) => right.has(tag));
}

function fits(value: string | undefined, max: number): value is string {
  return Boolean(value && value.length <= max);
}

/**
 * Decide what the job writes. Pure, so the user-edit rules are unit-tested:
 * - the title is replaced only while it is still empty, the URL, the title the
 *   link was saved with, or the title the job wrote earlier, and never when
 *   the saver locked it;
 * - tags are added only while the tag list is still what the link was saved
 *   with (plus what the job added); existing tags are always kept;
 * - description, summary, favicon, preview image and site name are only
 *   filled when empty.
 */
export function planLinkEnrichment(input: {
  content: BookmarkContentLike;
  tags: string[];
  enrichment: EnrichmentBase;
  metadata: ExtractedMetadata | null;
  ai: LinkAiResult;
  now?: Date;
}): LinkEnrichmentPlan {
  const { content, enrichment, metadata } = input;
  const suggestion = input.ai.ok ? input.ai.suggestion : null;
  const next: BookmarkContentLike = { ...content };
  const filledFields: EnrichedField[] = [];
  let filledTitle = enrichment.filledTitle;

  const currentTitle = content.title?.trim() ?? "";
  const titleUntouched =
    !enrichment.titleLocked &&
    (currentTitle === "" ||
      currentTitle === content.url ||
      currentTitle === (enrichment.baseTitle?.trim() ?? "") ||
      currentTitle === enrichment.filledTitle);
  const newTitle = (suggestion?.title || metadata?.title)?.slice(0, 500);
  if (titleUntouched && newTitle && newTitle !== currentTitle) {
    next.title = newTitle;
    filledTitle = newTitle;
    filledFields.push("title");
  }

  if (!content.description && fits(metadata?.description, 2000)) {
    next.description = metadata!.description;
    filledFields.push("description");
  }
  if (!content.summary && fits(suggestion?.summary, 600)) {
    next.summary = suggestion!.summary;
    filledFields.push("summary");
  }
  if (!content.favicon && fits(metadata?.favicon, 2048)) {
    next.favicon = metadata!.favicon;
    filledFields.push("favicon");
  }
  if (!content.previewImage && fits(metadata?.image, 2048)) {
    next.previewImage = metadata!.image;
    filledFields.push("previewImage");
  }
  if (!content.siteName && fits(metadata?.siteName, 200)) {
    next.siteName = metadata!.siteName;
    filledFields.push("siteName");
  }
  if (metadata && filledFields.length > 0) {
    next.unfurledAt = (input.now ?? new Date()).toISOString();
  }

  let tags = input.tags;
  let filledTags = enrichment.filledTags;
  const tagsUntouched =
    sameTagSet(input.tags, enrichment.baseTags) ||
    sameTagSet(input.tags, [...enrichment.baseTags, ...enrichment.filledTags]);
  if (tagsUntouched && suggestion && suggestion.tags.length > 0) {
    const present = new Set(input.tags.map((tag) => tag.toLowerCase()));
    const added = suggestion.tags
      .filter((tag) => !present.has(tag.toLowerCase()))
      .slice(0, Math.max(0, MAX_ITEM_TAGS - input.tags.length));
    if (added.length > 0) {
      tags = [...input.tags, ...added];
      filledTags = [...enrichment.filledTags, ...added];
      filledFields.push("tags");
    }
  }

  return {
    content: next,
    tags,
    changed: filledFields.length > 0,
    filledFields,
    filledTitle,
    filledTags,
    aiSkipReason: input.ai.ok ? null : input.ai.reason,
  };
}

/** What a follow-up hook (auto-filing, recaps) learns about a finished link. */
export interface LinkEnrichedEvent {
  itemId: string;
  canvasId: string;
  userId: string;
  url: string;
  title: string | null;
  tags: string[];
  summary: string | null;
  filledFields: EnrichedField[];
  aiSkipReason: LinkAiSkipReason | null;
  /** Other links of the user that look like the same page (IMP-065). */
  similarItemIds: string[];
}

export interface LinkEnrichmentOptions {
  fetchPage?: typeof fetchLinkPage;
  suggest?: (input: LinkAiInput) => Promise<LinkAiResult>;
  embed?: typeof embedText;
  /**
   * Runs inside the transaction that marks the link DONE, so a follow-up job
   * enqueued here (e.g. IMP-066 auto-filing) commits with the enrichment.
   */
  afterEnriched?: (
    tx: Prisma.TransactionClient,
    event: LinkEnrichedEvent,
  ) => Promise<void>;
}

const payloadSchema = z.object({ itemId: z.string().min(1).max(64) }).strict();

class LinkPageFetchError extends Error {
  readonly retryable = true;
  constructor(page: Extract<LinkPageResult, { ok: false }>) {
    super(`Link page fetch failed with status ${page.status}`);
    this.name = "LinkPageFetchError";
  }
}

class LinkEnrichmentConflictError extends Error {
  readonly retryable = true;
  constructor() {
    super("The link changed while it was being enriched");
    this.name = "LinkEnrichmentConflictError";
  }
}

async function markSkipped(prisma: PrismaClient, itemId: string) {
  await prisma.itemEnrichment.updateMany({
    where: { itemId, status: ItemEnrichmentStatus.PENDING },
    data: { status: ItemEnrichmentStatus.SKIPPED, completedAt: new Date() },
  });
}

export function createLinkEnrichmentHandler(
  prisma: PrismaClient,
  options: LinkEnrichmentOptions = {},
): OutboxHandler {
  const fetchPage = options.fetchPage ?? fetchLinkPage;
  const suggest = options.suggest ?? suggestLinkDetails;
  const embed = options.embed ?? embedText;

  return async (job, context) => {
    const { itemId } = payloadSchema.parse(job.payload);
    const enrichment = await prisma.itemEnrichment.findUnique({
      where: { itemId },
    });
    if (!enrichment || enrichment.status !== ItemEnrichmentStatus.PENDING) {
      return;
    }
    const item = await prisma.canvasItem.findFirst({
      where: { id: itemId, type: ItemType.BOOKMARK, deletedAt: null },
      select: { content: true },
    });
    const url = (item?.content as BookmarkContentLike | null)?.url;
    if (!item || !url) {
      await markSkipped(prisma, itemId);
      return;
    }
    // The user may have turned enrichment off after saving.
    const settings = await linkEnrichmentSettings(prisma, enrichment.userId);
    if (!settings.enabled) {
      await markSkipped(prisma, itemId);
      return;
    }

    const saved = item.content as BookmarkContentLike;
    let metadata: ExtractedMetadata | null = null;
    let pageText = "";
    let pageReadAt: Date | null = null;
    if (process.env.FEATURE_BOOKMARK_UNFURLING !== "false") {
      const page = await fetchPage(url, { signal: context?.signal });
      if (page.ok) {
        metadata = page.metadata;
        pageText = extractPageText(page.html);
        pageReadAt = new Date();
      } else if (job.attempts < job.maxAttempts) {
        throw new LinkPageFetchError(page);
      } else {
        logger.info(
          { itemId, status: page.status },
          "Link page unavailable; enriching from the saved title only",
        );
      }
    }

    let ai: LinkAiResult;
    try {
      ai = await suggest({
        userId: enrichment.userId,
        url,
        title: metadata?.title || saved.title,
        description: metadata?.description || saved.description,
        siteName: metadata?.siteName || saved.siteName,
        pageText,
        taggingRules: settings.taggingRules,
        signal: context?.signal,
      });
    } catch (error) {
      // A busy AI slot or a down budget store leaves the link PENDING and
      // fails the job as retryable; on the last attempt the link finishes
      // as a spent budget rather than staying PENDING.
      if (!isTransientAiBudgetError(error)) throw error;
      if (job.attempts < job.maxAttempts) throw error;
      logger.info(
        { itemId },
        "AI stayed busy through every attempt; enriching without AI",
      );
      ai = { ok: false, reason: "budget" };
    }
    context?.signal.throwIfAborted();

    // Near-duplicate detection needs an embedding; skip it whenever the AI
    // step was skipped for budget or policy reasons.
    let embedding: (EmbeddingResult & { ok: true }) | null = null;
    let embeddingHash = "";
    if (ai.ok || ai.reason === "provider-error") {
      const suggestion = ai.ok ? ai.suggestion : null;
      const embeddingText = [
        suggestion?.title || metadata?.title || saved.title,
        suggestion?.summary || metadata?.description || saved.description,
        url,
      ]
        .filter(Boolean)
        .join("\n");
      const result = await embed({
        userId: enrichment.userId,
        text: embeddingText,
        signal: context?.signal,
      });
      if (result.ok) {
        embedding = result;
        embeddingHash = createHash("sha256")
          .update(embeddingText)
          .digest("hex");
      }
      context?.signal.throwIfAborted();
    }

    // Score near-duplicates before taking the canvas lock: the scan reads and
    // compares up to a thousand JSON vectors, and every canvas mutation waits
    // on that lock. Inside the transaction only a cheap liveness check runs.
    let similarCandidateIds: string[] = [];
    if (embedding) {
      similarCandidateIds = (
        await findSimilarLinks(prisma, {
          userId: enrichment.userId,
          itemId,
          provider: embedding.provider,
          model: embedding.model,
          vector: embedding.vector,
        })
      ).map((match) => match.itemId);
      context?.signal.throwIfAborted();
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const located = await tx.canvasItem.findFirst({
        where: { id: itemId, deletedAt: null },
        select: { canvasId: true },
      });
      if (!located) return null;
      await lockCanvasForMutation(tx, located.canvasId);
      const fresh = await tx.itemEnrichment.findUnique({ where: { itemId } });
      const current = await tx.canvasItem.findFirst({
        where: { id: itemId, deletedAt: null },
        select: {
          canvasId: true,
          version: true,
          content: true,
          tags: true,
          normalizedUrl: true,
          createdById: true,
          updatedById: true,
        },
      });
      if (!fresh || fresh.status !== ItemEnrichmentStatus.PENDING || !current) {
        return null;
      }
      // The page, AI suggestion and embedding describe the URL this job read.
      // If the user replaced the link meanwhile, write none of it; leave the
      // row PENDING and enqueue a fresh job keyed to this version so the new
      // URL is enriched.
      if ((current.content as BookmarkContentLike | null)?.url !== url) {
        await enqueueOutboxJobs(tx, [
          {
            type: LINK_ENRICH_JOB,
            payload: { itemId },
            dedupeKey: `${linkEnrichmentDedupeKey(itemId)}:v${current.version}`,
            maxAttempts: LINK_ENRICH_MAX_ATTEMPTS,
          },
        ]);
        logger.info(
          { itemId },
          "Bookmark URL changed during enrichment; re-enqueued for the new URL",
        );
        return null;
      }

      const plan = planLinkEnrichment({
        content: current.content as BookmarkContentLike,
        tags: current.tags,
        enrichment: fresh,
        metadata,
        ai,
      });
      if (plan.changed) {
        const content = parseCanvasItemContent(ItemType.BOOKMARK, plan.content);
        const update = await tx.canvasItem.updateMany({
          where: { id: itemId, version: current.version, deletedAt: null },
          data: {
            content: content as Prisma.InputJsonValue,
            tags: plan.tags,
            version: { increment: 1 },
          },
        });
        if (update.count !== 1) throw new LinkEnrichmentConflictError();
        await recordCanvasItemEvent(tx, {
          canvasId: current.canvasId,
          actorId: current.updatedById || current.createdById,
          itemId,
          version: current.version + 1,
          operation: "updated",
        });
      }
      // Keep the duplicate-lookup key in step with the saved URL. It is not
      // user-visible content, so it does not bump the item version.
      const normalizedUrl = normalizeLinkUrl(
        (current.content as BookmarkContentLike).url,
      );
      if (normalizedUrl && normalizedUrl !== current.normalizedUrl) {
        await tx.canvasItem.update({
          where: { id: itemId },
          data: { normalizedUrl },
        });
      }

      // Keep the page's readable text (IMP-094); the archive lookup, when the
      // person turned it on, runs as its own job.
      if (pageText && pageReadAt) {
        await storePageCopy(tx, {
          itemId,
          userId: fresh.userId,
          url,
          text: pageText,
          readAt: pageReadAt,
        });
      }
      if (await wantsArchiveLookup(tx, fresh.userId)) {
        await enqueuePageCopy(tx, [itemId]);
      }

      let similarItemIds: string[] = [];
      if (embedding) {
        await tx.itemEmbedding.upsert({
          where: {
            itemId_provider_model: {
              itemId,
              provider: embedding.provider,
              model: embedding.model,
            },
          },
          create: {
            itemId,
            provider: embedding.provider,
            model: embedding.model,
            contentHash: embeddingHash,
            vector: embedding.vector,
          },
          update: { contentHash: embeddingHash, vector: embedding.vector },
        });
        if (similarCandidateIds.length > 0) {
          const live = new Set(
            (
              await tx.canvasItem.findMany({
                where: { id: { in: similarCandidateIds }, deletedAt: null },
                select: { id: true },
              })
            ).map((row) => row.id),
          );
          similarItemIds = similarCandidateIds.filter((id) => live.has(id));
        }
        plan.filledFields.push("embedding");
      }
      await tx.itemEnrichment.update({
        where: { itemId },
        data: {
          status: ItemEnrichmentStatus.DONE,
          filledFields: [
            ...new Set([...fresh.filledFields, ...plan.filledFields]),
          ],
          filledTitle: plan.filledTitle,
          filledTags: plan.filledTags,
          aiSkipReason: plan.aiSkipReason,
          similarItemIds,
          completedAt: new Date(),
        },
      });
      await options.afterEnriched?.(tx, {
        itemId,
        canvasId: current.canvasId,
        userId: fresh.userId,
        url,
        title: plan.content.title ?? null,
        tags: plan.tags,
        summary: plan.content.summary ?? null,
        filledFields: plan.filledFields,
        aiSkipReason: plan.aiSkipReason,
        similarItemIds,
      });
      return { canvasId: current.canvasId, changed: plan.changed };
    }, LINK_ENRICH_TRANSACTION_OPTIONS);

    if (outcome?.changed) await invalidateCanvasCache(outcome.canvasId);
  };
}
