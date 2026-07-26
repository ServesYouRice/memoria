# Performance Audit — Memoria

The team's own `REMAINING-WORK.md` already tracks the major scalability program (PERF-01…26). This file adds new findings, sharpens known ones with exact locations, and orders them by production impact. Items that duplicate a tracked ID reference it explicitly.

---

## P-1 — Image reads: rate-limit collision makes performance moot (see L-1)

- **Severity:** Critical (same defect as `logical-issues.md` L-1)
- **Location:** `src/proxy.ts:95`, `src/middleware/rate-limit.ts:100-104`
- Listed here for completeness: no image-pipeline optimization matters until reads stop being budgeted at 10/hour/IP.

## P-2 — Asset read proxy: full in-memory buffering, an extra copy, and `no-store` on every image

- **Severity:** High
- **Location:** `src/app/api/v1/uploads/[assetId]/route.ts:84-104`
- **Description:** Every image request (a) round-trips S3 → `transformToByteArray()` (whole object in memory), (b) then makes a **second full copy** (`const responseBytes = new Uint8Array(bytes.byteLength); responseBytes.set(bytes)`), and (c) is served `cache-control: private, no-store`, so browsers refetch on every canvas mount, tab switch back, or re-render that recreates the `Image` element. A 50-image canvas with 2 MB images costs ~200 MB of transient allocations per viewer per load, repeated per visit.
- **Why it matters:** This is the hottest byte-path in the product; it currently has zero caching at any layer and double-buffers in Node. It also holds the event loop's memory hostage under concurrent loads (documented as PERF-08/24 for the *write* path; the read path is worse because it's per-view, not per-upload).
- **Recommended fix:** (1) Stream the S3 body to the response (`object.Body` is a stream — pipe it) instead of buffering; (2) drop the redundant copy in any case; (3) serve `Cache-Control: private, max-age=86400` + `ETag` (asset IDs are immutable content, so even `immutable` is defensible); (4) longer term, presigned URLs would take Node out of the loop entirely for S3 mode.
- **Blocker:** The caching part should ship with the L-1 fix; streaming can follow.

## P-3 — A user-lookup DB query on every request from the JWT callback (see L-4)

- **Severity:** Medium
- **Location:** `src/lib/auth.ts:104-116`
- **Description & fix:** See L-4. Perf angle: with 5 s active polling per open canvas (`POLLING_INTERVAL_ACTIVE_MS`, `src/lib/constants.ts`) plus image fetches plus page loads, this single query is likely the highest-QPS statement in the system. A 10–30 s Redis-cached session version removes ~90 % of them.

## P-4 — Canvas polling refetches the complete item set every 5 seconds per open canvas

- **Severity:** Medium–High (root cause tracked as PERF-01/03/04)
- **Location:** `src/lib/hooks/use-canvas-items.ts` (`useCanvasItemsWithPolling`, intervals in `src/lib/constants.ts`: 5 s active / 30 s hidden), full-fetch path `:100-146`
- **Description:** Collaboration fallback polling re-runs the *full* item list (all pages, serially — L-6) on every tick. For a 1,000-item canvas that is a multi-page, full-payload fetch 12×/minute per viewer, hitting DB, JSON serialization, and the 200/min items rate budget. The WebSocket channel intentionally carries no item data, so polling is the only sync path and it is maximally expensive.
- **Recommended fix:** Short-term: make the polling query delta-based (`updatedAt > lastSyncAt` — an index on `(canvasId, updatedAt)` already exists in `prisma/schema.prisma:161`) and return tombstones for deletes (soft-delete rows already carry `deletedAt`). Medium-term: the PERF-01 viewport program.
- **Blocker:** No for small canvases; becomes the scaling wall quickly. Delta polling is a contained change worth doing before launch marketing mentions collaboration.

## P-5 — Base64 thumbnails inflate list payloads and are regenerated client-side (known: PERF-05/06)

- **Severity:** High (tracked)
- **Location:** Canvas list payloads / `useUpdateCanvasThumbnail` (`src/lib/hooks/use-canvases.ts`), dashboard cards
- **Description:** Already ledgered by the team: dashboard list responses can embed base64 thumbnails and the owning client regenerates thumbnails after item changes (canvas → dataURL → POST). Restating as a launch consideration: the dashboard is the first page after login; its payload should be budgeted now (even a 20-canvas account with 100 KB thumbnails is a 2 MB JSON parse before first paint).
- **Recommended fix:** Follow the tracked plan (object-storage assets + background generation). Interim: cap thumbnail dimensions/quality and exclude thumbnails from list responses behind a field selector.
- **Blocker:** No, but measure before launch.

## P-6 — WebSocket presence/cursor fanout is O(clients²) with JSON re-serialization per event

- **Severity:** Medium
- **Location:** `src/lib/collaboration/websocket-server.ts:757-807` (`broadcastPresence`/`broadcastCursors` rebuild the full user/cursor arrays and re-`JSON.stringify` on **every** cursor move), `handleMessage` `case "cursor"` broadcasts immediately with no coalescing
- **Description:** Every cursor message from any client triggers rebuilding and broadcasting the complete cursor list to all clients (plus a Redis publish). With 20 collaborators moving mice (~30 msg/s each within the 600/min cap ≈ 10/s… note the cap actually limits to 10 msg/s average), fanout is `20 × 20 × 10` sends/sec with full-array payloads.
- **Recommended fix:** Coalesce cursor broadcasts on a ~50 ms ticker per canvas (send at most 20 snapshots/sec regardless of input rate), and send only deltas (single moved cursor) rather than the whole array.
- **Blocker:** No; matters at >10 concurrent collaborators per canvas.

## P-7 — Heartbeat authorization sweep: unbatched DB load (see L-5)

- **Severity:** Medium — same finding as L-5; perf angle: 2 queries × N connections / 30 s, unbatched, plus `AUTHORIZATION_LEASE_MS` re-checks on message traffic. Batch per canvas or trust the lease in the sweep.

## P-8 — Undo/redo, autosave and polling interplay can double-fetch after version conflicts

- **Severity:** Low–Medium
- **Location:** `src/lib/hooks/use-autosave.ts` (500 ms debounce, version-checked PATCH), `src/app/api/cron/refresh-bookmarks/route.ts:56-58` (version bump on no-op touch — L-10)
- **Description:** Any server-side `version` bump that doesn't change user-visible content (bookmark touch) invalidates client optimistic state, causing conflict → refetch → re-render of the item layer. On canvases with many bookmarks the nightly/15-min refresh cycle creates periodic churn for every open client.
- **Recommended fix:** Stop bumping `version` for metadata-only refreshes (move refresh bookkeeping to separate columns), per L-10.
- **Blocker:** No.

## P-9 — Bundle size: Konva + MUI + TipTap + jsPDF in the primary canvas route (known: PERF-10/11/12/13)

- **Severity:** Medium (tracked)
- **Location:** `src/features/canvas/components/CanvasBoard.tsx` imports (Konva stage, dialogs, organizer, toolbars, TipTap editor, export via `jspdf`), `next.config.mjs` (`optimizePackageImports` for MUI only; `check-bundle-size.mjs` exists)
- **Description:** The team tracks decomposition; the concrete quick wins visible in imports: `jspdf` (export) and `CanvasOrganizerView` (836 lines) can be `next/dynamic` lazy imports triggered on first use; TipTap should load on first editor open. `ANALYZE=true pnpm build` exists — record a baseline number in CI via `check-bundle-size.mjs` so regressions gate merges (script exists but is not wired into `ci.yml`; verified the workflow has no `check-bundle` step).
- **Blocker:** No.

## P-10 — Sequential version-restore upserts (known: PERF-23) and full-snapshot versions

- **Severity:** Medium (tracked)
- **Location:** `src/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route.ts`
- **Description:** Tracked: restore iterates items row-by-row inside a transaction; large snapshots risk long transactions and lock contention. Nothing new to add beyond: put a hard item-count guard with a clear error before launch so a 10k-item restore can't wedge the DB mid-transaction.
- **Blocker:** No (with the guard).

## P-11 — Redis client sharing: rate-limit store creates its own connection config from discrete env vars

- **Severity:** Low
- **Location:** `src/lib/rate-limit/index.ts:186-204` (builds Redis config from `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` — *not* `REDIS_URL`) while the rest of the app uses `getRedisClient()` with `REDIS_URL` (`src/lib/cache/redis-client.ts`)
- **Description:** Two Redis configuration schemes. **Verified:** `RedisRateLimitStore` (`src/lib/rate-limit/stores/redis.ts:28-34`) does check `process.env.REDIS_URL` first, so the Compose deployment works correctly — the discrete `REDIS_HOST/PORT/PASSWORD` config passed in by `createRateLimiter` is dead weight that only applies when `REDIS_URL` is absent. Remaining issues: it opens a **separate ioredis connection** from the shared `getRedisClient()` pool, and the config-object indirection misleads readers into thinking `REDIS_HOST` matters in production.
- **Recommended fix:** Have the store reuse the shared `getRedisClient()` connection (one pool, one config source) and delete the discrete-var path.
- **Blocker:** No (verified working).

## P-12 — `dev` client identifier collapse (perf-adjacent)

- **Severity:** Low
- **Location:** `src/middleware/rate-limit.ts:24-28`
- **Description:** Without `server.ts` (e.g. `pnpm dev:next`), all clients share the `"unknown"` rate-limit identity; team dev sessions will trip shared limits mysteriously. Covered by S-1's fix.

---

## Priority order (performance only)

1. **P-11 verification** (possible boot-time failure of all rate limiting under Compose).
2. **P-1/P-2** — un-throttle and cache/stream the image read path.
3. **P-3** — cache `sessionVersion`, removing the top per-request query.
4. **P-4** — delta polling for item sync.
5. **P-5** — thumbnail payload budget (tracked).
6. **P-6/P-7** — collaboration fanout coalescing and heartbeat batching.
7. **P-9** — lazy-load jsPDF/TipTap/Organizer; wire `check-bundle-size.mjs` into CI.
8. **P-8/P-10/P-12** — hygiene.
