/**
 * "You saved this already" (IMP-065). Exact duplicates are found with a
 * normalized URL and need no AI; near-duplicates (same article, different
 * URL) come from embeddings written by link enrichment and are only ever
 * flagged as "looks similar", never blocked.
 */

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

/** Query parameters that track a click and never change the page. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "li_fat_id",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "oly_anon_id",
  "oly_enc_id",
  "vero_id",
  "wickedid",
  "_ga",
  "_gl",
  "ref_src",
  "ref_url",
]);

function isTrackingParam(name: string) {
  const key = name.toLowerCase();
  return key.startsWith("utm_") || TRACKING_PARAMS.has(key);
}

/**
 * The form two saves of the same link share: lowercase host, no default
 * port, no tracking parameters (`utm_*`, `fbclid`, ...), the remaining
 * parameters sorted, and no trailing slash. A fragment is dropped as an
 * in-page anchor unless it is a hash route (`#/...` or `#!...`), which names
 * a different page in hash-routed apps and so stays verbatim in the key
 * (section-275520a7a3648f6070aec172/Q-005). Returns null for anything that
 * is not an http(s) URL.
 */
export function normalizeLinkUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const fragment = url.hash;
  const route =
    fragment.startsWith("#/") || fragment.startsWith("#!") ? fragment : "";
  url.hash = "";
  url.username = "";
  url.password = "";
  const kept = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a, av], [b, bv]) =>
      a === b ? av.localeCompare(bv) : a < b ? -1 : 1,
    );
  url.search = "";
  for (const [name, value] of kept) url.searchParams.append(name, value);
  const path = url.pathname.replace(/\/+$/, "");
  // URL already lowercases the host and drops a default port.
  return `${url.protocol}//${url.host}${path}${url.search}${route}`;
}

export interface ExistingLink {
  itemId: string;
  canvasId: string;
  canvasName: string;
  title: string | null;
  url: string;
  /** In-app path that opens the board with the item focused. */
  path: string;
}

export function existingLinkPath(canvasId: string, itemId: string) {
  return `/canvas/${canvasId}?item=${encodeURIComponent(itemId)}`;
}

function likePattern(normalized: string) {
  // Host plus path, so older bookmarks without a stored normalizedUrl are
  // still found; every candidate is re-normalized before it counts.
  const url = new URL(normalized);
  const core = `${url.host}${url.pathname}`.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${core}%`;
}

const MAX_CANDIDATES = 500;

/**
 * The user's live bookmarks that are exact duplicates of `urls`, keyed by
 * normalized URL (oldest first). `excludeItemIds` leaves out the items being
 * saved right now.
 */
export async function findExistingLinks(
  db: Db,
  userId: string,
  urls: string[],
  options: { excludeItemIds?: string[] } = {},
): Promise<Map<string, ExistingLink[]>> {
  const keys = [
    ...new Set(
      urls.map(normalizeLinkUrl).filter((key): key is string => !!key),
    ),
  ];
  const found = new Map<string, ExistingLink[]>();
  if (keys.length === 0) return found;

  const rows = await db.$queryRaw<
    Array<{
      id: string;
      canvasId: string;
      canvasName: string;
      url: string | null;
      title: string | null;
    }>
  >`
    SELECT i."id", i."canvasId", c."name" AS "canvasName",
           i."content"->>'url' AS "url", i."content"->>'title' AS "title"
    FROM "CanvasItem" i
    JOIN "Canvas" c ON c."id" = i."canvasId"
    WHERE c."userId" = ${userId}
      AND i."deletedAt" IS NULL
      AND i."type" = 'BOOKMARK'
      AND (
        i."normalizedUrl" = ANY(${keys}::text[])
        OR (i."content"->>'url') ILIKE ANY(${keys.map(likePattern)}::text[])
      )
      AND NOT (i."id" = ANY(${options.excludeItemIds ?? []}::text[]))
    ORDER BY (i."normalizedUrl" = ANY(${keys}::text[])) DESC NULLS LAST,
             i."createdAt" ASC
    LIMIT ${MAX_CANDIDATES}
  `;

  const wanted = new Set(keys);
  for (const row of rows) {
    const key = row.url ? normalizeLinkUrl(row.url) : null;
    if (!key || !wanted.has(key)) continue;
    const list = found.get(key) ?? [];
    list.push({
      itemId: row.id,
      canvasId: row.canvasId,
      canvasName: row.canvasName,
      title: row.title,
      url: row.url!,
      path: existingLinkPath(row.canvasId, row.id),
    });
    found.set(key, list);
  }
  return found;
}

/** Existing copies of one URL, or an empty list. */
export function existingFor(
  found: Map<string, ExistingLink[]>,
  url: string,
): ExistingLink[] {
  const key = normalizeLinkUrl(url);
  return (key && found.get(key)) || [];
}

/** Cosine similarity of two equal-length vectors (0 when either is empty). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
    normA += a[index]! * a[index]!;
    normB += b[index]! * b[index]!;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

/** Above this, two links are flagged "looks similar". */
export const NEAR_DUPLICATE_THRESHOLD = 0.92;
const MAX_SIMILAR = 3;
/** Most recent embeddings compared per link; pgvector is the scale seam. */
const MAX_COMPARED_EMBEDDINGS = 1000;

/**
 * The user's other live links whose embedding (same provider and model) is
 * close to `vector`, best first.
 */
export async function findSimilarLinks(
  db: Db,
  input: {
    userId: string;
    itemId: string;
    provider: string;
    model: string;
    vector: number[];
  },
): Promise<Array<{ itemId: string; score: number }>> {
  const rows = await db.itemEmbedding.findMany({
    where: {
      provider: input.provider,
      model: input.model,
      itemId: { not: input.itemId },
      item: { deletedAt: null, canvas: { userId: input.userId } },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_COMPARED_EMBEDDINGS,
    select: { itemId: true, vector: true },
  });
  return rows
    .map((row) => ({
      itemId: row.itemId,
      score: Array.isArray(row.vector)
        ? cosineSimilarity(input.vector, row.vector as number[])
        : 0,
    }))
    .filter((row) => row.score >= NEAR_DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIMILAR);
}
