/**
 * TASK-243 — bulk canvas delete keeps a bounded number of DELETEs in flight
 * and stops dispatching after a 429.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/fetch-client";
import {
  BULK_DELETE_CONCURRENCY,
  deleteCanvasesBounded,
  removeCanvasesFromPages,
} from "./bulk-delete";

function tracker(fail: Record<string, ApiError | Error> = {}) {
  let inFlight = 0;
  let maxInFlight = 0;
  const started: string[] = [];
  const deleteOne = async (id: string) => {
    started.push(id);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    if (fail[id]) throw fail[id];
  };
  return { deleteOne, started, max: () => maxInFlight };
}

const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);

describe("deleteCanvasesBounded", () => {
  it("deletes everything with at most the concurrency limit in flight", async () => {
    const t = tracker();
    const result = await deleteCanvasesBounded(ids, t.deleteOne);
    expect(t.max()).toBeLessThanOrEqual(BULK_DELETE_CONCURRENCY);
    expect(t.max()).toBeGreaterThan(1);
    expect(result.deleted.sort()).toEqual([...ids].sort());
    expect(result.failed).toEqual([]);
    expect(result.notAttempted).toEqual([]);
    expect(result.rateLimited).toBe(false);
  });

  it("records server details for failures and keeps going on a 500", async () => {
    const t = tracker({
      c3: new ApiError(500, "Database unavailable"),
      c7: new ApiError(403, "Not your canvas"),
    });
    const result = await deleteCanvasesBounded(ids, t.deleteOne);
    expect(result.deleted).toHaveLength(10);
    expect(result.failed).toEqual([
      expect.objectContaining({
        id: "c3",
        status: 500,
        detail: "Database unavailable",
      }),
      expect.objectContaining({
        id: "c7",
        status: 403,
        detail: "Not your canvas",
      }),
    ]);
    expect(result.notAttempted).toEqual([]);
  });

  it("starts no new deletes after a 429", async () => {
    const t = tracker({
      c1: new ApiError(429, "Rate limit exceeded.", { retryAfterSeconds: 42 }),
    });
    const result = await deleteCanvasesBounded(ids, t.deleteOne, 2);
    expect(t.max()).toBeLessThanOrEqual(2);
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBe(42);
    // c0 and c1 start together; c2 starts when c0 finishes, before c1's 429
    // lands. Nothing starts after that.
    expect(t.started.length).toBeLessThan(ids.length);
    expect(result.notAttempted).toEqual(
      ids.filter((id) => !t.started.includes(id)),
    );
    expect(
      result.deleted.length + result.failed.length + result.notAttempted.length,
    ).toBe(ids.length);
  });

  it("never deletes an id twice and sends nothing for an empty list", async () => {
    const t = tracker();
    await deleteCanvasesBounded(["a", "a", "b"], t.deleteOne);
    expect(t.started.sort()).toEqual(["a", "b"]);
    const empty = tracker();
    await deleteCanvasesBounded([], empty.deleteOne);
    expect(empty.started).toEqual([]);
  });
});

describe("removeCanvasesFromPages", () => {
  it("drops deleted ids and lowers the total", () => {
    const data = {
      pageParams: [0],
      pages: [
        {
          canvases: [{ id: "a" }, { id: "b" }, { id: "c" }],
          pagination: { total: 3, offset: 0, hasMore: false },
        },
      ],
    };
    const next = removeCanvasesFromPages(data, new Set(["a", "c"]));
    expect(next?.pages[0].canvases).toEqual([{ id: "b" }]);
    expect(next?.pages[0].pagination.total).toBe(1);
  });

  it("leaves non-list cache entries alone", () => {
    const detail = { canvas: { id: "a" } };
    expect(removeCanvasesFromPages(detail, new Set(["a"]))).toBe(detail);
    expect(removeCanvasesFromPages(undefined, new Set(["a"]))).toBeUndefined();
  });
});
