/**
 * IMP-066 — new items file themselves into the right board.
 *
 * After link enrichment (IMP-064) tags an Inbox item, a `board.propose` job
 * scores the owner's boards against the item: board names, the tags already
 * used on each board and, when an AI provider is available and embeddings
 * were stored (IMP-065), how close the item sits to each board's links.
 * Without AI only names and tags count.
 *
 * The best board is filed as an Ask `move_items` suggestion under the
 * built-in "Memoria assistant" profile, so accepting it runs the same
 * approved-move executor (one ChangeSet with a `MOVE` record) and undo is one
 * `revertChangeSet` call. A `HomeBoardSuggestion` row per item remembers the
 * proposal and the user's answer: an item is proposed at most once, so a
 * dismissed or undone suggestion never comes back.
 *
 * Safe to run twice: the row is claimed with the suggestion in one
 * transaction, and a rerun only finishes an auto-file that did not happen.
 */

import {
  HomeBoardSuggestionStatus,
  Prisma,
  SuggestionKind,
  SuggestionStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { z } from "zod";
import { prisma as defaultPrisma } from "@/lib/db";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { enqueueOutboxJob } from "@/lib/outbox/enqueue";
import type { OutboxHandler } from "@/lib/outbox/types";
import { AGENT_CAPABILITY_RUNGS } from "@/lib/agents/constants";
import { INBOX_CANVAS_NAME } from "@/lib/agents/inbox";
import {
  approveSuggestion,
  claimSuggestionForExecution,
  createSuggestionRecordTx,
  markSuggestionExecuted,
  rejectSuggestion,
  revertChangeSet,
  type ActorContext,
} from "@/lib/agents/service-core";
import {
  ASK_COMMAND_SUGGESTION_KIND,
  executeAskCommandSuggestion,
  getAskAssistantProfile,
} from "@/lib/ai/ask-commands";

/** Boards named like this were archive targets before IMP-070; never a home. */
const LEGACY_ARCHIVE_BOARD_NAME = "Archive";
import type { AskCommand } from "@/lib/ai/ask-schema";
import { isAiEnabled } from "@/lib/ai/budget";
import { getAiAvailability } from "@/lib/ai/provider-resolution";
import { cosineSimilarity } from "@/lib/services/duplicates";

const logger = createLogger("home-board");

export const HOME_BOARD_JOB = "board.propose";
const HOME_BOARD_MAX_ATTEMPTS = 4;
/** Below this the item stays in the Inbox without a suggestion. */
export const MIN_PROPOSE_CONFIDENCE = 0.4;
/** "File automatically" moves an item only at or above this confidence. */
export const AUTO_FILE_CONFIDENCE = 0.8;
/** Two boards this close are a toss-up: still suggested, never auto-filed. */
const AMBIGUOUS_MARGIN = 0.1;
const AMBIGUOUS_PENALTY = 0.85;
const SUGGESTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATE_BOARDS = 200;
/** Most recent board embeddings compared; pgvector is the scale seam. */
const MAX_COMPARED_EMBEDDINGS = 1000;
const RECENTLY_FILED_MS = 7 * 24 * 60 * 60 * 1000;

export type HomeBoardReason = "board-name" | "tags" | "similar-items";

type Db = Prisma.TransactionClient | PrismaClient;

export function homeBoardDedupeKey(itemId: string) {
  return `${HOME_BOARD_JOB}:${itemId}`;
}

function isInboxName(name: string) {
  return name.trim().toLowerCase() === INBOX_CANVAS_NAME.toLowerCase();
}

/**
 * Enqueue a proposal for an item that was just enriched. Call it from the
 * enrichment transaction (`afterEnriched`); items outside the owner's Inbox
 * are left alone.
 */
export async function enqueueHomeBoardProposal(
  tx: Prisma.TransactionClient,
  event: { itemId: string; canvasId: string; userId: string },
): Promise<boolean> {
  const canvas = await tx.canvas.findUnique({
    where: { id: event.canvasId },
    select: { userId: true, name: true, isTemplate: true },
  });
  if (
    !canvas ||
    canvas.isTemplate ||
    canvas.userId !== event.userId ||
    !isInboxName(canvas.name)
  ) {
    return false;
  }
  await enqueueOutboxJob(tx, {
    type: HOME_BOARD_JOB,
    payload: { itemId: event.itemId },
    dedupeKey: homeBoardDedupeKey(event.itemId),
    maxAttempts: HOME_BOARD_MAX_ATTEMPTS,
  });
  return true;
}

// --- Scoring --------------------------------------------------------------

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "by",
  "de",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "our",
  "the",
  "this",
  "to",
  "with",
  "your",
]);

/** Lowercased, accent-free word stems, so "Rome trip" meets "#rome" and "Trips". */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word))
    .map((word) =>
      word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word,
    );
}

function normalizeTag(tag: string) {
  return tokenize(tag).join(" ");
}

export interface HomeBoardSubject {
  title: string | null;
  tags: string[];
  summary?: string | null;
  siteName?: string | null;
  /** The item's stored embedding; only passed when AI is available. */
  vector?: number[] | null;
}

export interface HomeBoardCandidate {
  id: string;
  name: string;
  itemCount: number;
  /** Normalized tag -> number of live items on the board carrying it. */
  tagCounts: Record<string, number>;
  /** Embeddings of the board's items (same provider and model as the subject). */
  vectors?: number[][];
}

export interface RankedHomeBoard {
  boardId: string;
  boardName: string;
  confidence: number;
  reasons: HomeBoardReason[];
}

function nameScore(board: HomeBoardCandidate, subject: HomeBoardSubject) {
  const boardTokens = [...new Set(tokenize(board.name))];
  if (boardTokens.length === 0) return 0;
  const boardPhrase = boardTokens.join(" ");
  const tagTokens = new Set(subject.tags.flatMap((tag) => tokenize(tag)));
  if (subject.tags.some((tag) => normalizeTag(tag) === boardPhrase)) return 0.9;
  const textTokens = new Set([
    ...tagTokens,
    ...tokenize(subject.title),
    ...tokenize(subject.siteName),
  ]);
  const inTags =
    boardTokens.filter((token) => tagTokens.has(token)).length /
    boardTokens.length;
  const inText =
    boardTokens.filter((token) => textTokens.has(token)).length /
    boardTokens.length;
  return Math.max(0.8 * inTags, 0.65 * inText);
}

function tagScore(board: HomeBoardCandidate, subject: HomeBoardSubject) {
  const itemTags = [...new Set(subject.tags.map(normalizeTag).filter(Boolean))];
  if (itemTags.length === 0 || board.itemCount === 0) return 0;
  const matched = itemTags.filter((tag) => (board.tagCounts[tag] ?? 0) > 0);
  if (matched.length === 0) return 0;
  const coverage = matched.length / itemTags.length;
  const share =
    matched.reduce(
      (sum, tag) => sum + Math.min(1, board.tagCounts[tag]! / board.itemCount),
      0,
    ) / matched.length;
  return Math.min(
    0.9,
    0.4 + 0.3 * coverage + 0.2 * share + 0.1 * Math.min(1, matched.length / 2),
  );
}

function similarityScore(board: HomeBoardCandidate, subject: HomeBoardSubject) {
  if (!subject.vector?.length || !board.vectors?.length) return 0;
  const vector = subject.vector;
  const top = board.vectors
    .map((other) => cosineSimilarity(vector, other))
    .sort((a, b) => b - a)
    .slice(0, 3);
  const mean = top.reduce((sum, value) => sum + value, 0) / top.length;
  return 0.9 * Math.min(1, Math.max(0, (mean - 0.55) / 0.35));
}

/**
 * Ranks boards for an item, best first. Each signal is a 0..1 score and they
 * combine as independent evidence (1 - Π(1 - s)); a near tie lowers the best
 * board's confidence so it is suggested but not auto-filed.
 */
export function rankHomeBoards(
  subject: HomeBoardSubject,
  boards: HomeBoardCandidate[],
): RankedHomeBoard[] {
  const ranked = boards
    .map((board) => {
      const signals: Array<[HomeBoardReason, number]> = [
        ["board-name", nameScore(board, subject)],
        ["tags", tagScore(board, subject)],
        ["similar-items", similarityScore(board, subject)],
      ];
      const confidence =
        1 - signals.reduce((rest, [, score]) => rest * (1 - score), 1);
      return {
        boardId: board.id,
        boardName: board.name,
        confidence,
        reasons: signals
          .filter(([, score]) => score >= 0.2)
          .sort((a, b) => b[1] - a[1])
          .map(([reason]) => reason),
      };
    })
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  const [best, second] = ranked;
  if (
    best &&
    second &&
    second.confidence >= best.confidence - AMBIGUOUS_MARGIN
  ) {
    best.confidence = Math.min(
      best.confidence * AMBIGUOUS_PENALTY,
      AUTO_FILE_CONFIDENCE - 0.01,
    );
  }
  return ranked.map((entry) => ({
    ...entry,
    confidence: Math.round(entry.confidence * 100) / 100,
  }));
}

// --- Proposal job ---------------------------------------------------------

interface ItemContentLike {
  title?: unknown;
  text?: unknown;
  summary?: unknown;
  description?: unknown;
  siteName?: unknown;
  url?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A short label for an item: its title, or the first line of its text. */
export function itemLabel(content: unknown): string {
  const value = (content ?? {}) as ItemContentLike;
  const label =
    asString(value.title) ??
    asString(value.text)?.split("\n")[0] ??
    asString(value.url) ??
    "Untitled item";
  return label.length > 120 ? `${label.slice(0, 119)}…` : label;
}

async function loadCandidateBoards(
  db: Db,
  input: {
    userId: string;
    sourceCanvasId: string;
    embedding: { provider: string; model: string } | null;
  },
): Promise<HomeBoardCandidate[]> {
  const boards = (
    await db.canvas.findMany({
      where: {
        userId: input.userId,
        isTemplate: false,
        id: { not: input.sourceCanvasId },
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_CANDIDATE_BOARDS,
      select: { id: true, name: true },
    })
  ).filter(
    (board) =>
      !isInboxName(board.name) &&
      board.name.trim().toLowerCase() !==
        LEGACY_ARCHIVE_BOARD_NAME.toLowerCase(),
  );
  if (boards.length === 0) return [];
  const ids = boards.map((board) => board.id);

  const [counts, tagRows, embeddings] = await Promise.all([
    db.canvasItem.groupBy({
      by: ["canvasId"],
      where: { canvasId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    db.$queryRaw<Array<{ canvasId: string; tag: string; count: number }>>(
      Prisma.sql`
        SELECT i."canvasId", t.tag, count(*)::int AS count
        FROM "CanvasItem" i, unnest(i."tags") AS t(tag)
        WHERE i."canvasId" = ANY(${ids}) AND i."deletedAt" IS NULL
        GROUP BY i."canvasId", t.tag
      `,
    ),
    input.embedding
      ? db.itemEmbedding.findMany({
          where: {
            provider: input.embedding.provider,
            model: input.embedding.model,
            item: { canvasId: { in: ids }, deletedAt: null },
          },
          orderBy: { updatedAt: "desc" },
          take: MAX_COMPARED_EMBEDDINGS,
          select: { vector: true, item: { select: { canvasId: true } } },
        })
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, HomeBoardCandidate>(
    boards.map((board) => [
      board.id,
      { id: board.id, name: board.name, itemCount: 0, tagCounts: {} },
    ]),
  );
  for (const row of counts) {
    byId.get(row.canvasId)!.itemCount = row._count._all;
  }
  for (const row of tagRows) {
    const tag = normalizeTag(row.tag);
    const board = byId.get(row.canvasId);
    if (!tag || !board) continue;
    board.tagCounts[tag] = (board.tagCounts[tag] ?? 0) + Number(row.count);
  }
  for (const row of embeddings) {
    const board = byId.get(row.item.canvasId);
    if (!board || !Array.isArray(row.vector)) continue;
    (board.vectors ??= []).push(row.vector as number[]);
  }
  return [...byId.values()];
}

async function defaultAiAvailable(userId: string) {
  if (!isAiEnabled()) return false;
  return (await getAiAvailability(userId)).configured;
}

export interface HomeBoardJobOptions {
  /** Whether embeddings may be used for this user (AI on and configured). */
  aiAvailable?: (userId: string) => Promise<boolean>;
}

export type HomeBoardProposalOutcome =
  | { status: "skipped"; reason: string }
  | { status: "proposed" | "auto-filed"; boardId: string; confidence: number };

/** The job body; exported for tests and for a manual rerun. */
export async function proposeHomeBoard(
  db: PrismaClient,
  itemId: string,
  options: HomeBoardJobOptions = {},
): Promise<HomeBoardProposalOutcome> {
  const item = await db.canvasItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      canvasId: true,
      deletedAt: true,
      content: true,
      tags: true,
      canvas: { select: { userId: true, name: true, isTemplate: true } },
      homeBoardSuggestion: true,
    },
  });
  if (!item || item.deletedAt) return { status: "skipped", reason: "gone" };
  const userId = item.canvas.userId;

  const existing = item.homeBoardSuggestion;
  if (existing) {
    // Proposed once already. A rerun only completes an auto-file that a
    // crash interrupted; it never proposes again.
    if (
      existing.status === HomeBoardSuggestionStatus.OPEN &&
      existing.confidence >= AUTO_FILE_CONFIDENCE &&
      (await isAutoFileEnabled(db, userId))
    ) {
      await acceptHomeBoardSuggestion({ userId, itemId, automatic: true });
      return {
        status: "auto-filed",
        boardId: existing.targetCanvasId,
        confidence: existing.confidence,
      };
    }
    return { status: "skipped", reason: "already-proposed" };
  }
  if (item.canvas.isTemplate || !isInboxName(item.canvas.name)) {
    return { status: "skipped", reason: "not-in-inbox" };
  }

  const aiAvailable = await (options.aiAvailable ?? defaultAiAvailable)(userId);
  const stored = aiAvailable
    ? await db.itemEmbedding.findFirst({
        where: { itemId },
        orderBy: { updatedAt: "desc" },
        select: { provider: true, model: true, vector: true },
      })
    : null;
  const vector =
    stored && Array.isArray(stored.vector) ? (stored.vector as number[]) : null;

  const boards = await loadCandidateBoards(db, {
    userId,
    sourceCanvasId: item.canvasId,
    embedding: stored && vector ? stored : null,
  });
  const content = (item.content ?? {}) as ItemContentLike;
  const [best] = rankHomeBoards(
    {
      title: asString(content.title) ?? asString(content.text),
      tags: item.tags,
      summary: asString(content.summary),
      siteName: asString(content.siteName),
      vector,
    },
    boards,
  );
  if (!best || best.confidence < MIN_PROPOSE_CONFIDENCE) {
    return { status: "skipped", reason: "no-match" };
  }

  const profile = await getAskAssistantProfile(userId);
  const command: AskCommand = {
    type: "move_items",
    itemIds: [itemId],
    boardId: best.boardId,
  };
  const label = itemLabel(item.content);
  const claimed = await db.$transaction(async (tx) => {
    const claim = await tx.homeBoardSuggestion.createMany({
      data: [
        {
          itemId,
          userId,
          sourceCanvasId: item.canvasId,
          targetCanvasId: best.boardId,
          confidence: best.confidence,
          reasons: best.reasons,
        },
      ],
      skipDuplicates: true,
    });
    if (claim.count !== 1) return false;
    const { suggestion } = await createSuggestionRecordTx(tx, {
      actor: {
        userId,
        agentProfileId: profile.id,
        modelCredentialId: profile.defaultModelCredentialId,
      },
      kind: SuggestionKind.INTERNAL_ORGANIZATION,
      summary: `Move "${label}" to "${best.boardName}"`.slice(0, 500),
      payload: {
        kind: ASK_COMMAND_SUGGESTION_KIND,
        command,
        question: "Suggested home board for a new Inbox item",
        source: "home-board",
      },
      rung: AGENT_CAPABILITY_RUNGS.PROPOSE,
      expiresAt: new Date(Date.now() + SUGGESTION_TTL_MS),
    });
    await tx.homeBoardSuggestion.update({
      where: { itemId },
      data: { suggestionId: suggestion.id },
    });
    return true;
  });
  if (!claimed) return { status: "skipped", reason: "already-proposed" };

  if (
    best.confidence >= AUTO_FILE_CONFIDENCE &&
    (await isAutoFileEnabled(db, userId))
  ) {
    await acceptHomeBoardSuggestion({ userId, itemId, automatic: true });
    return {
      status: "auto-filed",
      boardId: best.boardId,
      confidence: best.confidence,
    };
  }
  return {
    status: "proposed",
    boardId: best.boardId,
    confidence: best.confidence,
  };
}

const payloadSchema = z.object({ itemId: z.string().min(1).max(64) }).strict();

export function createHomeBoardProposalHandler(
  prisma: PrismaClient,
  options: HomeBoardJobOptions = {},
): OutboxHandler {
  return async (job) => {
    const { itemId } = payloadSchema.parse(job.payload);
    const outcome = await proposeHomeBoard(prisma, itemId, options);
    logger.info({ itemId, outcome: outcome.status }, "Home board proposal");
  };
}

// --- Settings -------------------------------------------------------------

/** Whether this user lets confident suggestions file themselves (off by default). */
export async function isAutoFileEnabled(db: Db, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { autoFileItems: true },
  });
  return Boolean(user?.autoFileItems);
}

// --- Accept, dismiss, undo ------------------------------------------------

async function findOwnRow(userId: string, itemId: string) {
  const row = await defaultPrisma.homeBoardSuggestion.findFirst({
    where: { itemId, userId },
  });
  if (!row) throw new NotFoundError("Suggestion not found.");
  return row;
}

async function assistantActor(userId: string, agentProfileId: string | null) {
  const profile = agentProfileId
    ? await defaultPrisma.agentProfile.findFirst({
        where: { id: agentProfileId, userId },
      })
    : null;
  const resolved = profile ?? (await getAskAssistantProfile(userId));
  const actor: ActorContext = {
    userId,
    agentProfileId: resolved.id,
    modelCredentialId: resolved.defaultModelCredentialId,
  };
  return { profile: resolved, actor };
}

/** Closes a suggestion that can no longer run (item moved, board gone). */
async function closeStale(itemId: string, suggestionId: string | null) {
  await defaultPrisma.homeBoardSuggestion.updateMany({
    where: { itemId, status: HomeBoardSuggestionStatus.OPEN },
    data: { status: HomeBoardSuggestionStatus.DISMISSED, actedAt: new Date() },
  });
  if (suggestionId) {
    await defaultPrisma.suggestion.updateMany({
      where: {
        id: suggestionId,
        status: {
          in: [
            SuggestionStatus.OPEN,
            SuggestionStatus.APPROVED,
            SuggestionStatus.EXECUTING,
          ],
        },
      },
      data: { status: SuggestionStatus.REJECTED, actedAt: new Date() },
    });
  }
}

/**
 * Moves the item to its suggested board as one ChangeSet: approve, claim and
 * run the suggestion through the Ask move executor.
 */
export async function acceptHomeBoardSuggestion(input: {
  userId: string;
  itemId: string;
  automatic?: boolean;
}) {
  const row = await findOwnRow(input.userId, input.itemId);
  if (row.status !== HomeBoardSuggestionStatus.OPEN || !row.suggestionId) {
    throw new BadRequestError("This suggestion is no longer open.");
  }
  const suggestion = await defaultPrisma.suggestion.findFirst({
    where: { id: row.suggestionId, userId: input.userId },
  });
  const item = await defaultPrisma.canvasItem.findFirst({
    where: { id: input.itemId, deletedAt: null },
    select: { canvasId: true },
  });
  if (!suggestion || !item || item.canvasId !== row.sourceCanvasId) {
    await closeStale(row.itemId, row.suggestionId);
    throw new BadRequestError(
      "This item has already moved, so the suggestion was dropped.",
    );
  }

  await approveSuggestion({
    userId: input.userId,
    suggestionId: suggestion.id,
  });
  await claimSuggestionForExecution({
    userId: input.userId,
    suggestionId: suggestion.id,
  });
  const { profile, actor } = await assistantActor(
    input.userId,
    suggestion.agentProfileId,
  );

  let result: Awaited<ReturnType<typeof executeAskCommandSuggestion>>;
  try {
    result = await executeAskCommandSuggestion({
      actor,
      agentProfile: profile,
      payload: suggestion.payload,
      summary: suggestion.summary,
    });
  } catch (error) {
    await closeStale(row.itemId, suggestion.id);
    throw error;
  }
  if (!("boardId" in result)) {
    await closeStale(row.itemId, suggestion.id);
    throw new BadRequestError("This suggestion is not a board move.");
  }
  await markSuggestionExecuted({
    userId: input.userId,
    suggestionId: suggestion.id,
  });
  await defaultPrisma.homeBoardSuggestion.updateMany({
    where: { itemId: row.itemId, status: HomeBoardSuggestionStatus.OPEN },
    data: {
      status: input.automatic
        ? HomeBoardSuggestionStatus.AUTO_FILED
        : HomeBoardSuggestionStatus.ACCEPTED,
      changeSetId: result.changeSetId,
      actedAt: new Date(),
    },
  });
  return {
    itemId: row.itemId,
    boardId: result.boardId,
    boardName: result.boardName,
    changeSetId: result.changeSetId,
  };
}

/**
 * Finalizes the home-board row of an Ask suggestion executed through the
 * generic execute path, as an accept does, so the Inbox lists it as filed and
 * its Undo works. Matches no row for other Ask suggestions.
 */
export async function recordHomeBoardExecution(input: {
  userId: string;
  suggestionId: string;
  changeSetId: string;
}) {
  await defaultPrisma.homeBoardSuggestion.updateMany({
    where: {
      userId: input.userId,
      suggestionId: input.suggestionId,
      status: HomeBoardSuggestionStatus.OPEN,
    },
    data: {
      status: HomeBoardSuggestionStatus.ACCEPTED,
      changeSetId: input.changeSetId,
      actedAt: new Date(),
    },
  });
}

/** Keeps the item where it is; the same item is never proposed again. */
export async function dismissHomeBoardSuggestion(input: {
  userId: string;
  itemId: string;
}) {
  const row = await findOwnRow(input.userId, input.itemId);
  if (row.status !== HomeBoardSuggestionStatus.OPEN) {
    throw new BadRequestError("This suggestion is no longer open.");
  }
  await defaultPrisma.homeBoardSuggestion.updateMany({
    where: { itemId: row.itemId, status: HomeBoardSuggestionStatus.OPEN },
    data: { status: HomeBoardSuggestionStatus.DISMISSED, actedAt: new Date() },
  });
  if (row.suggestionId) {
    const suggestion = await defaultPrisma.suggestion.findFirst({
      where: { id: row.suggestionId, userId: input.userId },
      select: { status: true },
    });
    if (
      suggestion?.status === SuggestionStatus.OPEN ||
      suggestion?.status === SuggestionStatus.APPROVED
    ) {
      await rejectSuggestion({
        userId: input.userId,
        suggestionId: row.suggestionId,
      });
    }
  }
  return { itemId: row.itemId, status: HomeBoardSuggestionStatus.DISMISSED };
}

/** One-step undo: reverts the move's ChangeSet, putting the item back. */
export async function undoHomeBoardMove(input: {
  userId: string;
  itemId: string;
}) {
  const row = await findOwnRow(input.userId, input.itemId);
  if (
    (row.status !== HomeBoardSuggestionStatus.ACCEPTED &&
      row.status !== HomeBoardSuggestionStatus.AUTO_FILED) ||
    !row.changeSetId
  ) {
    throw new BadRequestError("There is no move to undo for this item.");
  }
  const changeSet = await defaultPrisma.changeSet.findFirst({
    where: { id: row.changeSetId, userId: input.userId },
    select: { id: true, agentProfileId: true, revertedAt: true },
  });
  if (!changeSet) throw new NotFoundError("Change set not found.");
  let rollbackChangeSetId: string | null = null;
  if (!changeSet.revertedAt) {
    const { actor } = await assistantActor(
      input.userId,
      changeSet.agentProfileId,
    );
    const result = await revertChangeSet({
      actor,
      changeSetId: changeSet.id,
    });
    rollbackChangeSetId = result.rollbackChangeSetId;
  }
  await defaultPrisma.homeBoardSuggestion.updateMany({
    where: { itemId: row.itemId, status: row.status },
    data: { status: HomeBoardSuggestionStatus.REVERTED, actedAt: new Date() },
  });
  return {
    itemId: row.itemId,
    canvasId: row.sourceCanvasId,
    revertedChangeSetId: changeSet.id,
    rollbackChangeSetId,
  };
}

// --- Inbox listing --------------------------------------------------------

export interface InboxHomeBoardSuggestion {
  itemId: string;
  boardId: string;
  boardName: string;
  confidence: number;
  reasons: HomeBoardReason[];
}

export interface InboxFiledItem {
  itemId: string;
  label: string;
  boardId: string;
  boardName: string;
  automatic: boolean;
  actedAt: string;
}

/**
 * Open suggestions for items on one of the owner's boards, and what was filed
 * from it in the last week (so an automatic move can be undone from the
 * Inbox). Only the board's owner sees either.
 */
export async function listHomeBoardSuggestions(input: {
  userId: string;
  canvasId: string;
}): Promise<{
  suggestions: InboxHomeBoardSuggestion[];
  recentlyFiled: InboxFiledItem[];
}> {
  const canvas = await defaultPrisma.canvas.findFirst({
    where: { id: input.canvasId, userId: input.userId },
    select: { id: true },
  });
  if (!canvas) throw new NotFoundError("Canvas not found.");

  const now = new Date();
  const [open, filed] = await Promise.all([
    defaultPrisma.homeBoardSuggestion.findMany({
      where: {
        userId: input.userId,
        sourceCanvasId: input.canvasId,
        status: HomeBoardSuggestionStatus.OPEN,
        item: { canvasId: input.canvasId, deletedAt: null },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    defaultPrisma.homeBoardSuggestion.findMany({
      where: {
        userId: input.userId,
        sourceCanvasId: input.canvasId,
        status: {
          in: [
            HomeBoardSuggestionStatus.ACCEPTED,
            HomeBoardSuggestionStatus.AUTO_FILED,
          ],
        },
        actedAt: { gte: new Date(now.getTime() - RECENTLY_FILED_MS) },
        item: { deletedAt: null },
      },
      orderBy: { actedAt: "desc" },
      take: 20,
      include: { item: { select: { content: true, canvasId: true } } },
    }),
  ]);

  const suggestionIds = open
    .map((row) => row.suggestionId)
    .filter((id): id is string => Boolean(id));
  const live = new Set(
    (
      await defaultPrisma.suggestion.findMany({
        where: {
          id: { in: suggestionIds },
          status: SuggestionStatus.OPEN,
          expiresAt: { gt: now },
        },
        select: { id: true },
      })
    ).map((row) => row.id),
  );
  const boardIds = [
    ...new Set([...open, ...filed].map((row) => row.targetCanvasId)),
  ];
  const boards = new Map(
    (
      await defaultPrisma.canvas.findMany({
        where: { id: { in: boardIds }, userId: input.userId },
        select: { id: true, name: true },
      })
    ).map((board) => [board.id, board.name]),
  );

  return {
    suggestions: open
      .filter(
        (row) =>
          row.suggestionId &&
          live.has(row.suggestionId) &&
          boards.has(row.targetCanvasId),
      )
      .map((row) => ({
        itemId: row.itemId,
        boardId: row.targetCanvasId,
        boardName: boards.get(row.targetCanvasId)!,
        confidence: row.confidence,
        reasons: row.reasons as HomeBoardReason[],
      })),
    recentlyFiled: filed
      .filter(
        (row) =>
          boards.has(row.targetCanvasId) &&
          row.item.canvasId === row.targetCanvasId,
      )
      .map((row) => ({
        itemId: row.itemId,
        label: itemLabel(row.item.content),
        boardId: row.targetCanvasId,
        boardName: boards.get(row.targetCanvasId)!,
        automatic: row.status === HomeBoardSuggestionStatus.AUTO_FILED,
        actedAt: (row.actedAt ?? row.updatedAt).toISOString(),
      })),
  };
}
