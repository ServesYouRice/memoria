import { ApiError } from "@/lib/api/fetch-client";

/**
 * DELETEs in flight at once during a bulk canvas delete. Every
 * /api/v1/canvases* request shares the per-IP canvases budget with the list
 * GETs, so this stays small; correctness does not depend on the exact value
 * because a 429 stops further dispatch.
 */
export const BULK_DELETE_CONCURRENCY = 4;

export interface BulkDeleteFailure {
  id: string;
  status?: number;
  detail?: string;
}

export interface BulkDeleteResult {
  deleted: string[];
  failed: BulkDeleteFailure[];
  /** Ids never sent because a 429 stopped the run. */
  notAttempted: string[];
  rateLimited: boolean;
  retryAfterSeconds?: number;
}

/**
 * Delete canvases with at most `concurrency` requests in flight. After the
 * first 429 no new delete starts and the remaining ids are returned as
 * `notAttempted`. Each id is sent at most once.
 */
export async function deleteCanvasesBounded(
  ids: readonly string[],
  deleteOne: (id: string) => Promise<unknown>,
  concurrency: number = BULK_DELETE_CONCURRENCY,
): Promise<BulkDeleteResult> {
  const queue = [...new Set(ids)];
  const result: BulkDeleteResult = {
    deleted: [],
    failed: [],
    notAttempted: [],
    rateLimited: false,
  };
  let next = 0;

  async function worker() {
    while (!result.rateLimited && next < queue.length) {
      const id = queue[next];
      next += 1;
      try {
        await deleteOne(id);
        result.deleted.push(id);
      } catch (error) {
        const status = error instanceof ApiError ? error.status : undefined;
        result.failed.push({
          id,
          status,
          detail: error instanceof Error ? error.message : undefined,
        });
        if (status === 429) {
          result.rateLimited = true;
          if (error instanceof ApiError && error.retryAfterSeconds != null) {
            result.retryAfterSeconds = error.retryAfterSeconds;
          }
        }
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), queue.length) },
      worker,
    ),
  );
  result.notAttempted = queue.slice(next);
  result.failed.sort((a, b) => queue.indexOf(a.id) - queue.indexOf(b.id));
  return result;
}

interface CanvasListPage {
  canvases: Array<{ id: string }>;
  pagination: { total: number };
}

function isCanvasPages(
  data: unknown,
): data is { pages: CanvasListPage[]; pageParams?: unknown[] } {
  if (!data || typeof data !== "object") return false;
  const pages = (data as { pages?: unknown }).pages;
  return (
    Array.isArray(pages) &&
    pages.every(
      (page) =>
        page &&
        typeof page === "object" &&
        Array.isArray((page as CanvasListPage).canvases) &&
        typeof (page as CanvasListPage).pagination?.total === "number",
    )
  );
}

/**
 * Remove deleted canvases from a cached infinite canvas list and lower its
 * total, so the grid updates without a refetch. Other cache entries are
 * returned unchanged.
 */
export function removeCanvasesFromPages<T>(data: T, deleted: Set<string>): T {
  if (!isCanvasPages(data) || deleted.size === 0) return data;
  let removed = 0;
  const pages = data.pages.map((page) => {
    const canvases = page.canvases.filter((canvas) => !deleted.has(canvas.id));
    removed += page.canvases.length - canvases.length;
    return { ...page, canvases };
  });
  if (removed === 0) return data;
  return {
    ...data,
    pages: pages.map((page) => ({
      ...page,
      pagination: {
        ...page.pagination,
        total: Math.max(0, page.pagination.total - removed),
      },
    })),
  } as T;
}
