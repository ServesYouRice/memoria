# Performance and scalability audit

## High-impact findings

### PERF-01 — Opening one canvas downloads the same data through multiple paths

`useCanvasData` performs all of the following at page open:

1. `useCanvas(canvasId)`, whose API returns the Canvas plus **all active items** and caches that full snapshot (`src/app/api/v1/canvases/[canvasId]/route.ts:38-60`).
2. `useCanvasItems(canvasId)`, which separately fetches all items (`src/features/canvas/hooks/use-canvas-data.ts:70-72`).
3. `useCanvasVersions(..., { includeSnapshot: true })`, which fetches every version and every full snapshot (`:74-76`).

The first response's item array is not used as the displayed item source; React Query's item endpoint is. This doubles live item transfer/serialization before version history is counted.

**Fix:** make the canvas metadata endpoint metadata-only; load a bounded current viewport/item page once; fetch version metadata lazily and a single snapshot only when Time Machine requests it.

### PERF-02 — Version history is an unbounded O(items × versions) page-load cost

The versions API has no pagination/take and conditionally selects full snapshot JSON (`src/app/api/v1/canvases/[canvasId]/versions/route.ts:108-133`). The canvas always asks for snapshots. A canvas with 1,000 items and 100 versions can deserialize and transmit roughly 100,000 item snapshots before the user opens Time Machine.

Return paginated version headers (`id`, label, actor, date, item count/size); fetch one snapshot by ID; cap/compact retention; consider delta/checkpoint storage.

### PERF-03 — Non-viewport item loading serially drains every page

`listItems` fetches a page and then loops serially until `hasMore` is false (`src/lib/hooks/use-canvas-items.ts:96-113`). Large canvases pay N sequential round trips and are not interactive until all complete. If a malformed response says `hasMore` while returning an empty page, `currentOffset` never advances and the loop is infinite.

Use cursor pagination/viewport virtualization, expose progressive pages to the UI, and break on zero progress with a maximum-page guard.

### PERF-04 — The implemented viewport path is not used by the main canvas

The API and hook accept viewport bounds, but `useCanvasData` calls `useCanvasItems(canvasId)` with no viewport. `CanvasBoard` computes a viewport for `useVirtualItems` only after the entire dataset is already in memory. The optimization therefore reduces rendering, not database/network load.

Drive data fetching from the controlled pan/zoom viewport with overscan and stable cursor/deduplication semantics.

### PERF-05 — Canvas list/cache payloads include base64 thumbnails and full rows

Canvas list uses `findMany` without `select` (`src/app/api/v1/canvases/route.ts:31-37`), so every page includes the base64 `thumbnail` text and all template/share fields. The detail cache stores the entire Canvas plus every item as one Redis JSON value (`src/lib/cache/canvas-cache.ts:14-55`).

This creates large database rows, JSON serialization, network payloads, Redis values, and invalidations. Store thumbnails as fixed-size object assets; select summary fields; cache metadata and bounded pages separately; use compression only after fixing shape.

### PERF-06 — Thumbnail generation runs after every item-array change

`CanvasBoard` schedules a Stage `toDataURL` three seconds after any `allItems` change (`src/features/canvas/components/CanvasBoard.tsx:522-542`). Drag/autosave/refetch sequences repeatedly rasterize the full Stage, base64-encode it, POST it, write Postgres, and invalidate Redis. A separate `useCanvasThumbnail` implementation duplicates the same mechanism but is unused.

Generate only on meaningful settled revisions or asynchronously on the server/worker; use a small binary asset and content hash; never include it in every detail response.

### PERF-07 — Production text search silently falls back to JSON ILIKE scans

The GIN/`tsvector` SQL lives in `prisma/fts-migration.sql`, not a committed migration or setup step. Search probes for the column and falls back to four `ILIKE` expressions over JSON (`src/app/api/v1/search/route.ts:31-53`, `:105-176`). At scale this is a full accessible-item scan plus a separate count query.

Put the generated column/index in a real migration, validate it at readiness, add query/time limits, and measure plans with realistic tenant sizes.

### PERF-08 — Upload quota is O(number of stored objects) for every upload

Before each S3 write, `getS3Usage` paginates `ListObjectsV2` for the user's entire prefix (`src/app/api/v1/upload/route.ts:131-157`). Cost and latency grow linearly with files and can become a storage-provider bill/timeout vector. The 30-second lock has no renewal, and the local fallback cannot coordinate replicas.

Maintain transactional usage counters/reservations in Postgres or Redis, reconcile asynchronously, and use a renewable distributed lease or database advisory/row lock.

### PERF-09 — AI endpoints have no per-user budget and accept unbounded prompts

The general API limiter is IP-based, bypassable, and permits far more calls than a cost control. `chatSchema.message/context` and `generateSchema.system` have no maximum (`src/lib/validation/ai.ts:8-10`, `:18-22`). Summary loads all items including deleted ones and concatenates their text (`src/lib/ai/service.ts:43-50`). Any registered user can drive large input-token and request costs against the server-wide key.

Add account/workspace quotas, concurrency limits, maximum total prompt bytes/tokens, model allowlists, timeouts, usage accounting, and explicit billing/feature policy. Summarize in chunks with bounded active content.

### PERF-10 — CanvasBoard is a broad rerender and maintenance hotspot

`CanvasBoard.tsx` is roughly 1,170 lines and owns data, mutations, selection, history, dialogs, collaboration, timers, thumbnails, AI, keyboard, navigation, and rendering. Remote chat/reaction/cursor state updates rerender this component and its broad tree. Numerous `allItems.find/filter` operations occur across callbacks/renders.

Split a controller/data layer from memoized Stage overlays and dialogs; index items by ID; isolate high-frequency cursor/selection layers; profile before/after with 1k/10k items and multiple collaborators.

## Bundle and client-load findings

A successful audit-only production build reported these First Load JS sizes:

| Route | First Load JS |
|---|---:|
| `/dashboard` | 269 KB |
| `/share/[token]` | 261 KB |
| `/settings` | 252 KB |
| `/templates` | 243 KB |
| `/workspaces` | 243 KB |
| `/api-keys` | 242 KB |
| `/search` | 230 KB |
| `/notifications` | 214 KB |
| landing `/` | 163 KB |
| shared baseline | 101 KB |

The `/canvas/[canvasId]` route reports 144 KB before its dynamically imported CanvasBoard and feature chunks, so the actual interactive canvas cost is higher.

`pnpm run check-bundle` does not enforce these numbers. It looks for Pages Router path names and forward slashes, classifies almost all App Router/Windows output as unbudgeted `OTHER`, and reported 1,605 KB of gzipped JS as OK. See `OPS-27`.

### PERF-11 — Public share ships a heavy interactive bundle for read-only use

The public share route has one of the largest first loads (261 KB). Audit its dependency graph and provide a purpose-built read-only renderer that excludes authenticated editing dialogs, agent/AI controls, and management UI.

### PERF-12 — Dashboard eagerly aggregates many management surfaces

Dashboard combines canvas cards, workspaces, activity, search dialog, command palette, bulk actions, menus, and dialogs in one client component. Lazy-load infrequent dialogs/palette and paginate cards rather than paying 269 KB plus all data up front.

## Other scalability findings

| ID | Severity | Finding | Evidence / action |
|---|---|---|---|
| PERF-13 | Medium | Template listing/detail returns every active item for every template. | `src/app/api/v1/templates/route.ts` includes items in list results. Return summaries; fetch selected template content on demand. |
| PERF-14 | Medium | Search UI discards server pagination metadata. | `/search` returns total/limit/offset, but SearchContent treats only `json.results` as the dataset and has no next page. Add cursor/infinite loading and cancellation. |
| PERF-15 | Medium | Search logs every query and performs count + result SQL. | Besides privacy, count doubles work. Consider approximate/no count during typeahead, cache safe results briefly, and cancel stale requests. |
| PERF-16 | Medium | Connections endpoint returns all connections. | Large graph canvases have no paging/viewport filter. Fetch edges touching visible nodes or return a compact graph snapshot. |
| PERF-17 | Medium | Bookmark refresh is sequential and can exceed request budgets. | Ten URLs run one after another; `safeFetch`'s timeout is per redirect hop. Move to a job queue with bounded concurrency, whole-job deadline, and backoff. |
| PERF-18 | Medium | Redis collaboration presence has no TTL/heartbeat per remote instance. | A crashed instance's presence/cursors remain in in-process remote maps until local unsubscribe. Add timestamp expiry and periodic cleanup. |
| PERF-19 | Medium | Every valid integration-token request writes `lastSeenAt`. | `src/lib/agents/auth.ts` updates the integration row on every authentication. Throttle/coalesce this telemetry to avoid write amplification. |
| PERF-20 | Medium | Agent list/action pagination uses offset and malformed-number parsing. | Prefer stable cursor pagination for high-write audit/action tables and shared validation. |
| PERF-21 | Medium | API canvas detail performs an extra share query after cache lookup. | Permission is already queried by `requireCanvasAccess`, then share metadata is queried again. Return access details from one authorization query or short-lived request context. |
| PERF-22 | Low | DB retry/timeout helpers are unused and one timeout leaks timers. | `src/lib/db.ts` defines wrappers that are not called; clear timers in `finally` or remove dead abstractions. Add timeouts at actual external boundaries. |
| PERF-23 | Medium | Version restore performs sequential upserts in one long transaction. | `restore/route.ts:138-168` awaits each item. Use validated bulk staging/upsert SQL while preserving monotonic versions and constraints. |
| PERF-24 | Medium | Large images are decoded/buffered multiple times. | `request.formData()`, `file.arrayBuffer()`, malware multipart, and S3 body hold copies. Enforce ingress size before parsing and stream scan/storage where possible. |
| PERF-25 | Medium | Canvas geometry SQL uses expression predicates that the current positional index may not accelerate well. | Inspect `EXPLAIN ANALYZE`; consider a spatial/range index or materialized bounds for real viewport workloads. |
| PERF-26 | Medium | No load/performance tests protect the stated infinite-canvas use case. | Add repeatable budgets for open, pan, edit, search, WebSocket fan-out, version restore, and upload at realistic sizes. |

## Optimization order

1. Remove duplicate full-item/version transfers (`PERF-01` through `PERF-04`).
2. Move thumbnails/uploads out of hot database/list paths (`PERF-05`, `PERF-06`, `PERF-08`).
3. Install the real FTS migration and query budgets (`PERF-07`).
4. Split CanvasBoard/high-frequency overlays and repair controlled viewport state.
5. Correct bundle measurement, then lazy-load the large dashboard/share/settings surfaces.
6. Add account-level AI and agent cost controls before enabling those features broadly.
