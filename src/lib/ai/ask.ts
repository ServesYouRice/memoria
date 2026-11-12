import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, notFoundError } from "@/lib/errors";
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
  ASK_LINKS_PER_ITEM,
  ASK_MAX_OUTPUT_TOKENS,
  ASK_PAGE_EXCERPT_CHARS,
  ASK_RETRIEVAL_LIMIT,
  ASK_SCOPE_TAG_LIMIT,
  ASK_SYSTEM_PROMPT,
  askScopeLabel,
  buildAskContext,
  buildAskPrompt,
  extractSearchTerms,
  resolveAskOutput,
  type AskBoard,
  type AskCommandRejection,
  type AskRetrievedItem,
  type AskScope,
  type AskScopeUsed,
} from "@/lib/ai/ask-schema";
import { proposeAskCommand } from "@/lib/ai/ask-commands";
import { pageCopyExcerpts } from "@/lib/services/page-copy";
import { loadItemLinks } from "@/lib/canvas/arrow-links";

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

/**
 * A resolved scope (IMP-101): the canvas has already been checked to be the
 * user's own. Every retrieval query adds this on top of the owner filter.
 */
export type AskScopeFilter =
  | { kind: "all" }
  | { kind: "canvas"; canvasId: string }
  | { kind: "tag"; tag: string };

const ALL: AskScopeFilter = { kind: "all" };

function scopeSql(scope: AskScopeFilter) {
  switch (scope.kind) {
    case "all":
      return Prisma.empty;
    case "canvas":
      return Prisma.sql`AND i."canvasId" = ${scope.canvasId}`;
    case "tag":
      return Prisma.sql`AND ${scope.tag} = ANY(i."tags")`;
  }
}

function scopeWhere(scope: AskScopeFilter) {
  switch (scope.kind) {
    case "all":
      return {};
    case "canvas":
      return { canvasId: scope.canvasId };
    case "tag":
      return { tags: { has: scope.tag } };
  }
}

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
  scope: AskScopeFilter = ALL,
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
  // Words found only in a link's saved page text count too (IMP-094).
  const ftsMatch = Prisma.sql`
    ${useFts ? Prisma.sql`OR i."searchVector" @@ ${tsQuery}` : Prisma.empty}
    OR EXISTS (
      SELECT 1 FROM "ItemPageCopy" p
      WHERE p."itemId" = i."id" AND p."searchVector" @@ ${tsQuery}
    )
  `;
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
      ${scopeSql(scope)}
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
  scope: AskScopeFilter = ALL,
): Promise<string[]> {
  const rows = await prisma.itemEmbedding.findMany({
    where: {
      provider: query.provider,
      model: query.model,
      item: {
        deletedAt: null,
        canvas: { userId, isTemplate: false },
        ...scopeWhere(scope),
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

async function loadOwnedItemRows(
  userId: string,
  itemIds: string[],
  scope: AskScopeFilter,
) {
  if (itemIds.length === 0) return [];
  const rows = await prisma.canvasItem.findMany({
    where: {
      id: { in: itemIds },
      deletedAt: null,
      canvas: { userId, isTemplate: false },
      ...scopeWhere(scope),
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
  options: {
    embedQuery?: AskQueryEmbedder;
    limit?: number;
    scope?: AskScopeFilter;
  } = {},
): Promise<AskRetrievedItem[]> {
  const limit = options.limit ?? ASK_RETRIEVAL_LIMIT;
  const scope = options.scope ?? ALL;
  const textRows = await searchOwnedItems(
    userId,
    extractSearchTerms(question),
    limit,
    scope,
  );

  let vectorRows: ItemRow[] = [];
  if (options.embedQuery) {
    try {
      const embedding = await options.embedQuery(question);
      if (embedding) {
        const ids = await nearestOwnedItemIds(userId, embedding, limit, scope);
        const loaded = await loadOwnedItemRows(userId, ids, scope);
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
  const retrieved = merged.map(toRetrieved);
  // A short excerpt of each link's saved page, around the question's words.
  const excerpts = await pageCopyExcerpts(
    prisma,
    merged.filter((row) => row.type === "BOOKMARK").map((row) => row.id),
    extractSearchTerms(question),
    { length: ASK_PAGE_EXCERPT_CHARS, before: 120, fallbackToStart: true },
  );
  // What each item is linked to (IMP-095): "what is connected to this?".
  const links = await loadItemLinks(
    prisma,
    retrieved.map((item) => item.id),
    ASK_LINKS_PER_ITEM,
  );
  for (const item of retrieved) {
    const excerpt = excerpts.get(item.id);
    if (excerpt) item.pageText = excerpt;
    const itemLinks = links.get(item.id);
    if (itemLinks) item.links = itemLinks;
  }
  return retrieved;
}

export async function listOwnedBoards(userId: string): Promise<AskBoard[]> {
  return prisma.canvas.findMany({
    where: { userId, isTemplate: false },
    orderBy: { updatedAt: "desc" },
    take: ASK_BOARD_LIMIT,
    select: { id: true, name: true },
  });
}

/**
 * Checks a requested scope against what the user owns. A canvas that is not
 * theirs (shared with them, a template, or missing) is refused the same way,
 * so the answer never says whether someone else's canvas exists.
 */
export async function resolveAskScope(
  userId: string,
  scope: AskScope,
): Promise<{ filter: AskScopeFilter; used: AskScopeUsed }> {
  if (scope.kind === "canvas") {
    const canvas = await prisma.canvas.findFirst({
      where: { id: scope.canvasId, userId, isTemplate: false },
      select: { id: true, name: true },
    });
    if (!canvas) throw notFoundError("Canvas", scope.canvasId);
    return {
      filter: { kind: "canvas", canvasId: canvas.id },
      used: { kind: "canvas", label: askScopeLabel(scope, canvas.name) },
    };
  }
  if (scope.kind === "tag") {
    return {
      filter: { kind: "tag", tag: scope.tag },
      used: { kind: "tag", label: askScopeLabel(scope) },
    };
  }
  return { filter: ALL, used: { kind: "all", label: askScopeLabel(scope) } };
}

/** The canvases and tags the Ask box offers as scopes: the user's own only. */
export async function listAskScopeChoices(userId: string) {
  const [canvases, tags] = await Promise.all([
    listOwnedBoards(userId),
    prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT tag FROM "CanvasItem" i
      JOIN "Canvas" c ON i."canvasId" = c."id",
      unnest(i."tags") tag
      WHERE c."userId" = ${userId}
        AND c."isTemplate" = false
        AND i."deletedAt" IS NULL
      GROUP BY tag ORDER BY COUNT(*) DESC, tag ASC
      LIMIT ${ASK_SCOPE_TAG_LIMIT}
    `,
  ]);
  return { canvases, tags: tags.map((row) => row.tag) };
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
  /** Where the question looked (IMP-101). */
  scope: AskScopeUsed;
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
  scope?: AskScope;
}): Promise<AskResult> {
  const scope = await resolveAskScope(
    input.userId,
    input.scope ?? { kind: "all" },
  );
  const [items, boards] = await Promise.all([
    retrieveOwnedItems(input.userId, input.question, {
      embedQuery: input.embedQuery,
      scope: scope.filter,
    }),
    listOwnedBoards(input.userId),
  ]);
  const { context, refs } = buildAskContext(items, boards);
  const prompt = buildAskPrompt(input.question, context, scope.used.label);

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
    scope: scope.used,
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
