import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import {
  getItemPlainText,
  getItemTitle,
  getItemUrl,
} from "@/lib/agents/item-text";
import { runBudgetedAi, type AiUsageSnapshot } from "@/lib/ai/budget";
import { generateText } from "@/lib/ai/service";
import {
  ASK_BOARD_LIMIT,
  ASK_MAX_OUTPUT_TOKENS,
  ASK_RETRIEVAL_LIMIT,
  ASK_SYSTEM_PROMPT,
  buildAskContext,
  buildAskPrompt,
  extractSearchTerms,
  resolveAskOutput,
  type AskBoard,
  type AskCommandRejection,
  type AskRetrievedItem,
} from "@/lib/ai/ask-schema";
import { proposeAskCommand } from "@/lib/ai/ask-commands";

const logger = createLogger("ai-ask");
const EMBEDDING_SCAN_LIMIT = 2_000;

/**
 * IMP-068 — "Ask Memoria". Retrieval is scoped to boards the user owns:
 * shared boards, templates and deleted items are never read, even though the
 * global search route also covers boards shared with the user.
 */

let searchVectorAvailable: boolean | null = null;

async function hasSearchVectorColumn(): Promise<boolean> {
  if (searchVectorAvailable !== null) return searchVectorAvailable;
  try {
    const result = await prisma.$queryRaw<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'CanvasItem'
          AND column_name = 'searchVector'
      ) AS "exists"
    `;
    searchVectorAvailable = Boolean(result[0]?.exists);
  } catch {
    return false;
  }
  return searchVectorAvailable;
}

/** A query embedding from the user's provider, when one can embed. */
export interface AskQueryEmbedding {
  provider: string;
  model: string;
  vector: number[];
}

export type AskQueryEmbedder = (
  question: string,
) => Promise<AskQueryEmbedding | null>;

interface ItemRow {
  id: string;
  canvasId: string;
  canvasName: string;
  type: string;
  content: unknown;
  tags: string[] | null;
}

function toRetrieved(row: ItemRow): AskRetrievedItem {
  const source = { type: row.type, content: row.content };
  return {
    id: row.id,
    canvasId: row.canvasId,
    canvasName: row.canvasName,
    type: row.type,
    title: getItemTitle(source),
    text: getItemPlainText(source),
    url: getItemUrl(source),
    tags: row.tags ?? [],
  };
}

/** Owned, live, non-template items whose text or tags match any search term. */
export async function searchOwnedItems(
  userId: string,
  terms: string[],
  limit = ASK_RETRIEVAL_LIMIT,
): Promise<ItemRow[]> {
  if (terms.length === 0) return [];
  const useFts = await hasSearchVectorColumn();
  const haystack = Prisma.sql`concat_ws(' ',
    i."content"->>'plainText', i."content"->>'text', i."content"->>'title',
    i."content"->>'description', i."content"->>'url', i."content"->>'question',
    i."content"->>'alt', array_to_string(i."tags", ' '))`;
  const patterns = terms.map((term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`);
  const hits = Prisma.join(
    patterns.map(
      (pattern) =>
        Prisma.sql`(CASE WHEN ${haystack} ILIKE ${pattern} ESCAPE '\\' THEN 1 ELSE 0 END)`,
    ),
    " + ",
  );
  // Terms are letters and digits only (extractSearchTerms), so OR-joining
  // them is a valid tsquery.
  const tsQuery = Prisma.sql`to_tsquery('english', ${terms.join(" | ")})`;
  const ftsMatch = useFts
    ? Prisma.sql`OR i."searchVector" @@ ${tsQuery}`
    : Prisma.empty;
  const ftsRank = useFts
    ? Prisma.sql`+ ts_rank(COALESCE(i."searchVector", ''::tsvector), ${tsQuery})`
    : Prisma.empty;

  return prisma.$queryRaw<ItemRow[]>`
    SELECT i."id", i."canvasId", c."name" AS "canvasName", i."type"::text AS "type",
      i."content", i."tags"
    FROM "CanvasItem" i
    JOIN "Canvas" c ON i."canvasId" = c."id"
    WHERE c."userId" = ${userId}
      AND c."isTemplate" = false
      AND i."deletedAt" IS NULL
      AND (
        ${haystack} ILIKE ANY (${patterns}::text[])
        ${ftsMatch}
      )
    ORDER BY ((${hits}) ${ftsRank}) DESC, i."updatedAt" DESC
    LIMIT ${limit}
  `;
}

function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
    na += a[index]! * a[index]!;
    nb += b[index]! * b[index]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Nearest owned items by stored embedding, for the same provider and model. */
export async function nearestOwnedItemIds(
  userId: string,
  query: AskQueryEmbedding,
  limit = ASK_RETRIEVAL_LIMIT,
): Promise<string[]> {
  const rows = await prisma.itemEmbedding.findMany({
    where: {
      provider: query.provider,
      model: query.model,
      item: {
        deletedAt: null,
        canvas: { userId, isTemplate: false },
      },
    },
    select: { itemId: true, vector: true },
    take: EMBEDDING_SCAN_LIMIT,
  });
  return rows
    .map((row) => ({
      itemId: row.itemId,
      score: Array.isArray(row.vector)
        ? cosine(query.vector, row.vector as number[])
        : 0,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.itemId);
}

async function loadOwnedItemRows(userId: string, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const rows = await prisma.canvasItem.findMany({
    where: {
      id: { in: itemIds },
      deletedAt: null,
      canvas: { userId, isTemplate: false },
    },
    select: {
      id: true,
      canvasId: true,
      type: true,
      content: true,
      tags: true,
      canvas: { select: { name: true } },
    },
  });
  return rows.map((row): ItemRow => ({
    id: row.id,
    canvasId: row.canvasId,
    canvasName: row.canvas.name,
    type: row.type,
    content: row.content,
    tags: row.tags,
  }));
}

/**
 * Text search over the user's own items, merged with embedding neighbours
 * when an embedder is given and the user has stored embeddings for it.
 */
export async function retrieveOwnedItems(
  userId: string,
  question: string,
  options: { embedQuery?: AskQueryEmbedder; limit?: number } = {},
): Promise<AskRetrievedItem[]> {
  const limit = options.limit ?? ASK_RETRIEVAL_LIMIT;
  const textRows = await searchOwnedItems(
    userId,
    extractSearchTerms(question),
    limit,
  );

  let vectorRows: ItemRow[] = [];
  if (options.embedQuery) {
    try {
      const embedding = await options.embedQuery(question);
      if (embedding) {
        const ids = await nearestOwnedItemIds(userId, embedding, limit);
        const loaded = await loadOwnedItemRows(userId, ids);
        const byId = new Map(loaded.map((row) => [row.id, row]));
        vectorRows = ids.flatMap((id) => byId.get(id) ?? []);
      }
    } catch (error) {
      logger.warn(
        { errorName: (error as Error)?.name },
        "Ask embedding lookup failed; using text search only",
      );
    }
  }

  // Interleave so both signals reach the prompt, text hits first.
  const merged: ItemRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; merged.length < limit; index += 1) {
    const text = textRows[index];
    const vector = vectorRows[index];
    if (!text && !vector) break;
    for (const row of [text, vector]) {
      if (row && !seen.has(row.id) && merged.length < limit) {
        seen.add(row.id);
        merged.push(row);
      }
    }
  }
  return merged.map(toRetrieved);
}

export async function listOwnedBoards(userId: string): Promise<AskBoard[]> {
  return prisma.canvas.findMany({
    where: { userId, isTemplate: false },
    orderBy: { updatedAt: "desc" },
    take: ASK_BOARD_LIMIT,
    select: { id: true, name: true },
  });
}

export interface AskSource {
  itemId: string;
  canvasId: string;
  canvasName: string;
  type: string;
  title: string;
  url: string | null;
  href: string;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
  suggestion: { id: string; summary: string; kind: string } | null;
  commandRejected: AskCommandRejection | "failed" | null;
  commandError?: string;
  retrievedCount: number;
  /** Null when the usage store could not be read after the call. */
  usage: AiUsageSnapshot | null;
}

export function itemHref(item: { canvasId: string; id: string }) {
  return `/canvas/${encodeURIComponent(item.canvasId)}?item=${encodeURIComponent(item.id)}`;
}

/**
 * Answers a question from the user's own items, or files a command as a
 * suggestion. The model's reply is validated and its references resolved to
 * the items and boards loaded here; it never writes anything itself.
 */
export async function askMemoria(input: {
  userId: string;
  question: string;
  signal?: AbortSignal;
  embedQuery?: AskQueryEmbedder;
}): Promise<AskResult> {
  const [items, boards] = await Promise.all([
    retrieveOwnedItems(input.userId, input.question, {
      embedQuery: input.embedQuery,
    }),
    listOwnedBoards(input.userId),
  ]);
  const { context, refs } = buildAskContext(items, boards);
  const prompt = buildAskPrompt(input.question, context);

  const budgeted = await runBudgetedAi(
    input.userId,
    {
      prompt: `${ASK_SYSTEM_PROMPT}\n${prompt}`,
      maxOutputTokens: ASK_MAX_OUTPUT_TOKENS,
    },
    () =>
      generateText({
        prompt,
        system: ASK_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: ASK_MAX_OUTPUT_TOKENS,
        userId: input.userId,
        signal: input.signal,
      }),
  );

  const output = resolveAskOutput(budgeted.value, refs);
  const result: AskResult = {
    answer: output.answer,
    sources: output.sources.map((item) => ({
      itemId: item.id,
      canvasId: item.canvasId,
      canvasName: item.canvasName,
      type: item.type,
      title: item.title,
      url: item.url,
      href: itemHref(item),
    })),
    suggestion: null,
    commandRejected: output.commandRejected,
    retrievedCount: refs.items.size,
    usage: budgeted.usage,
  };

  if (output.command) {
    try {
      const suggestion = await proposeAskCommand({
        userId: input.userId,
        command: output.command,
        question: input.question,
      });
      result.suggestion = {
        id: suggestion.id,
        summary: suggestion.summary,
        kind: output.command.type,
      };
    } catch (error) {
      // The answer still stands; only expected refusals are shown, the rest
      // propagate as server errors. ZodError means the command was malformed.
      if (
        !(error instanceof ApiError) &&
        (error as Error)?.name !== "ZodError"
      ) {
        throw error;
      }
      result.commandRejected = "failed";
      result.commandError =
        error instanceof ApiError
          ? error.message
          : "The command could not be filed.";
    }
  }
  return result;
}
