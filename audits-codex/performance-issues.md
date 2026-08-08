# Performance and Scalability Issues

## PERF-01 — Account export is an unbounded nested query and in-memory download

- **Severity:** High
- **Location:** `src/app/api/v1/users/account/route.ts:28-93`; `src/app/settings/SettingsContent.tsx:120-139`; `src/lib/policy/launch-limits.ts`
- **Description:** The export endpoint loads the user, up to 200 canvases, and every nested item/share in one Prisma object, serializes one JSON response, and the browser then materializes another Blob. Item counts are bounded per canvas, but there is no total content-byte quota and several item content types are unbounded. The same export omits other account domains such as comments, versions, notifications/preferences, activity, API-key metadata, agent records, upload metadata, and file bytes.
- **Production impact:** A legitimate large account can consume substantial database, Node heap, serialization, transfer, and browser memory, potentially terminating the process. The resulting artifact is simultaneously expensive and not actually a complete portable export.
- **Recommended fix:** Define a versioned export manifest, page/stream records into a compressed archive, include checksummed upload objects and all documented user-data domains, and process the job asynchronously with expiration and authorization. Put explicit total-byte/time limits and cancellation around export generation.
- **Production blocker:** Yes while the synchronous endpoint is exposed as “portable account data.”
- **Related risks/dependencies:** `SEC-03`, `NTH-HI-01`, privacy copy at `src/app/privacy/page.tsx:36-39`.

## PERF-02 — The main canvas fetches and renders the entire item set

- **Severity:** High
- **Location:** `src/features/canvas/hooks/use-canvas-data.ts:70-79`; `src/lib/hooks/use-canvas-items.ts:109-140`; `src/features/canvas/components/CanvasBoard.tsx:877-900,1158`; `src/features/canvas/components/CanvasItemLayer.tsx`; `src/features/canvas/components/CanvasAccessiblePanel.tsx`; `src/lib/policy/launch-limits.ts:4`
- **Description:** Although the item API and hook accept viewport bounds, `useCanvasData` calls `useCanvasItems(canvasId)` without them. The hook walks all pages and the board builds/filter-maps every item into Konva nodes; the full DOM accessibility list is also rendered (currently twice). A supported canvas can contain 2,000 rich items and images.
- **Production impact:** Initial load, JSON parsing, React reconciliation, Konva drawing, image decoding, search/tag filtering, and assistive-technology traversal all scale with total canvas size instead of visible content. Multi-user invalidation makes the work recur.
- **Recommended fix:** Load and cull by an expanded viewport, keep lightweight off-screen metadata for search/fit-to-screen, paginate the accessible organizer independently, and cache pages by stable cursors. Establish a 2,000-item performance budget for time-to-interactive, pan frame time, memory, and collaboration updates.
- **Production blocker:** Yes until the supported 2,000-item limit is proven on target hardware or the launch limit is reduced.
- **Related risks/dependencies:** `LOG-01`, `UI-04`, `TEST-05`.

## PERF-03 — Viewport persistence performs synchronous storage writes during pan/zoom

- **Severity:** Medium
- **Location:** `src/features/canvas/hooks/use-canvas-data.ts:129-159`; canvas pan handlers in `src/features/canvas/components/CanvasBoard.tsx`
- **Description:** Every position or zoom state update synchronously serializes and writes local storage. The server update is debounced, but the local write is not. Pointer-driven panning can generate many main-thread storage operations, and quota/security errors are not caught.
- **Production impact:** Canvas interaction can stutter on lower-end/mobile devices, while a storage exception can break the view. The cross-canvas correctness issue is documented in `LOG-04`.
- **Recommended fix:** Update in-memory state per frame, persist at idle or gesture end, cap write frequency, and treat local storage as a best-effort cache.
- **Production blocker:** No.
- **Related risks/dependencies:** `LOG-04`.

## PERF-04 — Response byte limiting repeatedly serializes the growing payload

- **Severity:** Medium
- **Location:** `src/lib/api/bounded-response.ts:8-24`; canvas-item query limits in `src/app/api/v1/canvas-items/route.ts`
- **Description:** The limiter calls `JSON.stringify(body)` after appending each item. For a page of `n` items it serializes the shared prefix approximately `n` times, producing quadratic CPU/allocation behavior. The viewport API permits pages as large as 1,000 items.
- **Production impact:** A request designed to protect response size can itself create CPU and garbage-collection pressure, especially with large JSON content and concurrent canvases.
- **Recommended fix:** Precompute metadata size and accumulate each item’s serialized byte cost once, or stream the response through a byte-counted encoder. Keep the correctness fix in `LOG-01` coupled to this rewrite.
- **Production blocker:** No independently; it becomes part of the `LOG-01` blocker.
- **Related risks/dependencies:** `LOG-01`, `SEC-03`.

## PERF-05 — Public image responses disable reusable caching

- **Severity:** Medium
- **Location:** `src/app/api/v1/uploads/[assetId]/route.ts:44-65`
- **Description:** Even when the owning canvas is public, image responses use `Cache-Control: private, max-age=0, must-revalidate`. Every anonymous revisit or shared-view client revalidates through the Node app and S3 path.
- **Production impact:** Popular shared canvases amplify application and object-storage traffic and increase image latency.
- **Recommended fix:** Give active public assets short public caching with ETags and an explicit revocation strategy, or serve immutable versioned object URLs behind an authorization-aware CDN. Keep private-canvas assets private/no-store as appropriate.
- **Production blocker:** No.
- **Related risks/dependencies:** Public-link revocation semantics and object-deletion delay must be tested before cache lifetime increases.

## PERF-06 — Outbox batches are leased together and processed serially

- **Severity:** High
- **Location:** `src/lib/outbox/worker.ts:21-46`; `src/lib/outbox/repository.ts:14-39`; `src/lib/email/providers/sendgrid.ts:57-85`; `src/lib/email/providers/resend.ts:52-72`
- **Description:** The worker claims 20 jobs with one 60-second lease, then awaits them one by one. Email provider fetches have no timeout. A slow early job can let later leases expire before processing, and a hung call stops the entire worker indefinitely. Resend receives an idempotency key; SendGrid receives only a custom argument, not a deduplication guarantee.
- **Production impact:** Verification, password reset, share mail, thumbnail work, and upload cleanup can backlog. Expired leases or restarts can cause duplicate delivery or concurrent handling.
- **Recommended fix:** Add per-handler deadlines, claim one job at a time or renew leases, use bounded concurrency with per-job ownership, and make every side effect idempotent. Track queue age, handler duration, lease loss, retries, and dead-letter counts with alerts.
- **Production blocker:** Yes because email is required for production registration/recovery.
- **Related risks/dependencies:** `DEP-04`, `TEST-06`.

## Verification note

`pnpm run check-bundle` passed its current four thresholds (shared 124.12 KiB, landing 3.44 KiB, auth 17.01 KiB, canvas route 3.69 KiB). The canvas number reflects the route wrapper with a dynamic import and does not replace a runtime/memory benchmark of the loaded editor.
