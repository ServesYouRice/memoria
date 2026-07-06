# Performance Issues

Severity: Critical / High / Medium / Low.

---

## P-1. Full-canvas item fetch on every canvas open (serial pagination), then everything re-fetched constantly

- **Severity:** High
- **Location:** `src/lib/hooks/use-canvas-items.ts:72-127` + `use-canvas-data.ts:71`
- **Problem:** `useCanvasItems(canvasId)` (no viewport) triggers `listItems`, which serially pages the **entire** canvas item set (page N+1 waits for N) before first paint, even though `CanvasBoard` then virtualizes rendering. Viewport-based loading exists in the API and hook but the canvas doesn't use it. On a 500-item board this is a multi-round-trip waterfall on every open.
- **Fix:** Use viewport loading by default, or return the full item list in a single response (canvases are size-bounded); parallelize pages if paging is kept.
- **Blocker:** No, but load time degrades sharply with canvas size.

## P-2. WebSocket persistence re-reads and re-writes items every 30 s per active canvas; `loadDocumentState` loads all items with no bound

- **Severity:** Medium-High
- **Location:** `src/lib/collaboration/yjs-provider.ts:111-151, 186-405`
- **Problem:** For every active canvas, a timer runs a multi-statement transaction (createMany + N updates + updateMany) every 30 s regardless of whether writes are needed beyond the dirty-set check (which helps), then **re-queries all dirtied+created rows** to sync versions back. `loadDocumentState` fetches every non-deleted item into a Y.Doc with no cap. With many concurrent canvases this is continuous DB pressure; combined with L-4 it's also writing incorrect data.
- **Fix:** Resolve L-4 first; batch/limit; only reschedule persistence when the dirty set is non-empty.
- **Blocker:** No (but couples to a Critical data bug).

## P-3. Base64 thumbnails stored in the `Canvas` row bloat every list query

- **Severity:** Medium
- **Location:** `prisma/schema.prisma:87` (`thumbnail String? @db.Text`), `CanvasBoard.tsx:522-542`, `GET /api/v1/canvases` (`findMany` with no `select` → returns `thumbnail`)
- **Problem:** `GET /api/v1/canvases` returns full rows including the base64 `thumbnail` Text column for every canvas — the dashboard list payload is dominated by image data even before any preview is shown. Thumbnails are regenerated 3 s after any edit and PATCHed back, so they churn.
- **Fix:** Store thumbnails in object storage and reference by URL; `select` away `thumbnail` in list endpoints; debounce generation (see U-17).
- **Blocker:** No.

## P-4. `CanvasBoard` is a 1,171-line component with dozens of `useState` and inline handlers — re-render pressure

- **Severity:** Medium
- **Location:** `src/features/canvas/components/CanvasBoard.tsx` (whole file)
- **Problem:** ~30 `useState` hooks, many inline closures recreated every render, all passed to Konva children and MUI toolbars. `handleAlign`/`handleDistribute`/drag handlers are not memoized; the `follow mode` effect writes `setPosition` on every cursor frame (`:409-418`), and remote message/reaction arrays trigger re-renders on a 3–5 s `setTimeout` cleanup cadence. Every collaborator cursor update re-renders the entire board subtree.
- **Fix:** Split into presentational children with `React.memo`, memoize handlers with `useCallback`, isolate cursor/presence rendering into a sibling that subscribes independently, throttle follow-mode `setPosition`.
- **Blocker:** No, but jank scales with item count and collaborators.

## P-5. Collaborative polling (5 s) runs in addition to WebSockets

- **Severity:** Medium
- **Location:** `src/lib/hooks/use-canvas-items.ts:308-339`, `constants.ts:376` (`ENABLE_COLLABORATIVE_POLLING = true`), `use-collaboration.ts`
- **Problem:** The app has a full WebSocket collaboration stack **and** an adaptive-polling hook that refetches items every 5 s (active tab). If both are enabled for the same canvas, that's redundant load: WS pushes updates while polling also hammers the REST list endpoint (which itself full-pages, P-1). `CanvasBoard` uses `useCanvasItems` (no polling) but the polling variant is globally enabled and used elsewhere.
- **Fix:** Pick one real-time strategy per canvas; disable polling when WS is connected; the 5 s poll + full pagination is expensive at scale.
- **Blocker:** No.

## P-6. TanStack default `retry: 3` with exponential backoff on all queries, including 4xx

- **Severity:** Low-Medium
- **Location:** `src/app/providers.tsx:33-46`
- **Problem:** Every failed query retries 3× (up to 30 s backoff) even for deterministic 4xx (401/403/404/400). A logged-out user or a forbidden canvas triggers 4 requests and a ~7 s delay before the error shows. Mutations retry once, which can double-apply non-idempotent POSTs that lack an idempotency key.
- **Fix:** `retry: (count, err) => err.status >= 500 && count < 3`; ensure all mutating hooks send `x-idempotency-key` if mutation retry stays on.
- **Blocker:** No.

## P-7. Per-upload full S3 prefix listing

- **Severity:** Medium
- **Location:** `src/app/api/v1/upload/route.ts:131-154, 418`
- **Problem:** Each image upload lists (and sums sizes of) all the user's objects to enforce quota — O(files) network calls per upload, up to 500 objects. See L-16.
- **Fix:** Maintain per-user usage counters in the DB.
- **Blocker:** No.

## P-8. Search filters items client-side after loading the whole canvas

- **Severity:** Low
- **Location:** `src/features/canvas/hooks/use-canvas-data.ts:149-185`
- **Problem:** In-canvas search/tag filtering runs in-memory over all loaded items (fine for the canvas), but strips HTML per keystroke over every note (`stripHtmlTags` on each filter pass) with no debounce — O(items × keystrokes). The global `/search` page uses a server route (better).
- **Fix:** Debounce the search input; precompute plaintext once per item.
- **Blocker:** No.

## P-9. No DB connection pooling guidance enforced; eager connect fine but pool sizing is documentation-only

- **Severity:** Low
- **Location:** `src/lib/db.ts:54-97`
- **Problem:** Pool size is "recommended" via comments only; actual pooling depends on `DATABASE_URL` query params which nothing validates. The custom long-lived Node server plus Prisma default pool (num_cpus×2+1) may be fine, but under the WS persistence load (P-2) and no PgBouncer, connection exhaustion is plausible.
- **Fix:** Set explicit `connection_limit`/`pool_timeout` and validate them; document PgBouncer for multi-instance.
- **Blocker:** No.

---

## Performance summary

Nothing here is a hard blocker on its own, but three patterns will bite at real scale and should be addressed early: **full-canvas serial item loading (P-1)**, **the redundant WS + polling + 30 s DB persistence trio (P-2, P-5)**, and **base64 thumbnails in list payloads (P-3)**. The `CanvasBoard` re-render pressure (P-4) is the main client-side jank source once boards get busy or collaborative.
