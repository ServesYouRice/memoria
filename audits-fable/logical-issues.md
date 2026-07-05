# Logical Issues — Application Logic, Data Handling, Implementation Quality

Severity: Critical / High / Medium / Low. Each finding lists whether it is a **pre-launch blocker**.

---

## L-1. No Prisma migrations exist — the database cannot be provisioned

- **Severity:** Critical
- **Location:** `prisma/migrations/` (contains only `migration_lock.toml`), `package.json` (`db:migrate` = `prisma migrate deploy`), `.github/workflows/ci.yml` e2e job, `scripts/setup.mjs`
- **Problem:** There are zero migration folders. `prisma migrate deploy` is a no-op on a fresh database, so `pnpm setup:selfhost`, the Docker stack, and the CI "Run database migrations" step all produce an **empty database**. The schema apparently only ever existed via `prisma db push` or `migrate dev` on developer machines. `prisma/fts-migration.sql` (full-text search) is also orphaned — nothing applies it.
- **Why it matters:** First production deploy fails immediately; there is also no forward-migration story for schema evolution, no rollback story, and the CI e2e job silently runs against a schema-less DB.
- **Fix:** Run `prisma migrate dev --name init` against a clean DB to baseline, commit the migration, fold `fts-migration.sql` into a proper migration, and make container startup (or a release step) run `prisma migrate deploy` before the server starts.
- **Blocker:** **Yes.**
- **Related:** D-1 (Docker never runs migrations), T-2 (CI e2e).

## L-2. Auth rate limit (5 requests / 15 minutes) is applied to all of `/api/auth/*`, including NextAuth session endpoints

- **Severity:** Critical
- **Location:** `src/middleware.ts:63-79`, `src/middleware/rate-limit.ts:135-139`, `src/lib/constants.ts:30-36` (`AUTH_RATE_LIMIT_WINDOW_MS = 15min`, `MAX = 5`)
- **Problem:** The middleware applies `authRateLimit` to every path starting with `/api/auth` — which includes NextAuth's `/api/auth/session`, `/api/auth/csrf`, and `/api/auth/providers`, called by `SessionProvider` on effectively every page load and navigation. Five requests per 15 minutes per client exhausts instantly. Worse, the client identifier falls back to the literal string `"unknown"` when `x-forwarded-for`/`x-real-ip` are absent (`src/middleware/rate-limit.ts:40-47`), so on a bare deployment **all users share one bucket of 5 requests per 15 minutes**.
- **Why it matters:** The app hard-locks for every user within seconds of real traffic. This is a "nothing works in production" bug that dev testing may not catch if the in-memory store resets on every hot reload.
- **Fix:** Scope the strict limit to credential-mutating endpoints only (`/api/auth/callback/credentials`, `/api/v1/auth/register`, `/api/v1/auth/forgot-password`, `/api/v1/auth/reset-password`); exempt `/api/auth/session|csrf|providers` or give them the general API limit. Never rate limit on a shared `"unknown"` key — fail open or key by a session/cookie hash instead.
- **Blocker:** **Yes.**

## L-3. Rate limiting in middleware is in-memory, per-process, and unbounded — the Redis rate-limit store is never used by the middleware

- **Severity:** High
- **Location:** `src/middleware/rate-limit.ts:27-38` (module-level `Map` on `globalThis`), vs. the unused-for-middleware Redis implementation in `src/lib/rate-limit/*`
- **Problem:** Two parallel rate-limiting systems exist. The one that actually guards routes (Next middleware) stores timestamp arrays in a `Map` that (a) is per-process — meaningless with multiple instances/replicas despite Redis pub/sub being built for exactly that, (b) resets on restart, and (c) **never evicts keys** — every unique IP string allocates an entry forever (memory leak, and an attacker can spray random `x-forwarded-for` values to grow it).
- **Why it matters:** Production env validation *requires* Redis "for rate limiting" (`src/lib/env.ts:93-99`) but the requirement is not honored; limits are trivially bypassed by rotating the spoofable `x-forwarded-for` header; memory grows without bound.
- **Fix:** Back the middleware limiter with the existing `RedisRateLimitStore` (the custom Node server means Node APIs are available), or move rate limiting into route handlers via the existing `withRateLimit`. Evict expired entries. Derive client IP from the socket/trusted proxy config, not raw headers.
- **Blocker:** Yes (combined with L-2).

## L-4. Dual write path: Yjs persistence and the REST API both write `CanvasItem` and can corrupt each other

- **Severity:** High
- **Location:** `src/lib/collaboration/yjs-provider.ts:186-405` (persistDocument), `src/app/api/v1/canvas-items/[itemId]/route.ts` (optimistic-locking PATCH), `src/lib/hooks/use-collaboration.ts`, `CanvasBoard.tsx`
- **Problem:** The client edits items **only via REST** (TanStack mutations); the Y.Doc in `useCollaboration` receives updates but the UI never writes item changes into it. Meanwhile the server keeps a Y.Doc per canvas loaded from the DB at first WS connection and **persists it back every 30 s, bypassing version checks** (`version: { increment: 1 }`, un-deletes rows via `deletedAt: null` when the doc still has the item). Concretely: user A opens a canvas (server Y.Doc snapshots items), user B deletes/edits an item over REST, any Yjs update on that canvas triggers persistence of the **stale** doc → the deleted item is resurrected / edits overwritten, versions bumped out from under REST clients (spurious 409s).
- **Why it matters:** Silent data loss and resurrection of deleted content under completely normal multi-user behavior. This is the single most dangerous data-integrity issue in the app.
- **Fix (choose one direction):** Either make Yjs the single source of truth for item state (UI edits go into the Y.Doc; REST becomes read-only for collaborative canvases), or keep REST authoritative and make the WS layer a pure relay for presence/cursors/chat (stop persisting the Y.Doc, stop loading items into it). Do not ship with both write paths active.
- **Blocker:** **Yes** if real-time collaboration ships enabled; otherwise disable Yjs persistence before launch.

## L-5. JWT sessions are never revalidated — deleted/locked users keep access, password change doesn't revoke sessions

- **Severity:** High
- **Location:** `src/lib/auth.ts:82-104` (jwt callback contains a placeholder comment instead of a check), `src/app/api/v1/users/change-password/route.ts`, `Session` model (has `revokedAt`, unused with JWT strategy)
- **Problem:** After login the JWT is trusted until cookie expiry. Deleting an account, "locking" it, or changing a password does not invalidate existing sessions. The `Session` table with `revokedAt`/`deviceInfo` implies session management that cannot work under `strategy: "jwt"`.
- **Fix:** On a cadence (e.g., token age > 15 min, hook already sketched at `auth.ts:91-101`) re-check the user exists/is active and bump a per-user `sessionVersion` claim that password change / account deletion increments.
- **Blocker:** Yes for a multi-user production deployment.

## L-6. Cron bookmark refresh: wrong query and self-defeating bookkeeping

- **Severity:** Medium
- **Location:** `src/app/api/cron/refresh-bookmarks/route.ts:32-90`
- **Problem:** (a) `where: { type: BOOKMARK }` does **not** filter `deletedAt: null` — it refetches soft-deleted bookmarks forever. (b) The "unchanged" branch force-touches `updatedAt` to rotate the queue, which corrupts `updatedAt` as a user-facing signal, needlessly bumps cache invalidation for every touched canvas, and (via the `@@index([canvasId, updatedAt])` consumers) reorders UI lists. (c) `CRON_SECRET` is optional in the env schema, so the job 500s silently if unset. (d) The cron is only wired up in `vercel.json`, but the primary deployment target is self-host (see D-5) — **it never runs at all**.
- **Fix:** Filter `deletedAt: null`; track refresh state in a dedicated column (`lastCheckedAt`) instead of `updatedAt`; require `CRON_SECRET` in production env validation; schedule via a real scheduler in the self-host stack (compose sidecar, systemd timer, or in-process interval).
- **Blocker:** No (feature just doesn't work).

## L-7. Optimistic-update bugs in the canvas item hooks

- **Severity:** Medium-High
- **Location:** `src/lib/hooks/use-canvas-items.ts:373-528`
- **Problems:**
  1. **Temp IDs are interactive** — created items get `id: temp-${Date.now()}` in the cache; until the invalidation round-trip completes, dragging/deleting that item issues `PATCH /api/v1/canvas-items/temp-…` → 404/error toast (`onMutate` at :390-407).
  2. **Version not bumped optimistically** — `useUpdateCanvasItem.onMutate` merges `data` but leaves `version` stale, so two quick successive updates (drag then resize, or align-then-distribute in `CanvasBoard.handleAlign`) send the same version → guaranteed 409 storms; the 409 handler then invalidates **all** item queries (`error.message.includes('Version mismatch')`, :521-525) causing full refetch churn. Note the server error text is produced by `VersionMismatchError` — this string-matching contract is fragile.
  3. **Rollback races** — `onError` for update restores only the detail cache, not the list caches it also mutated.
- **Fix:** Block interactions on temp items (or return the created row and swap IDs in place); bump `version` in the optimistic merge; roll back list caches symmetrically; detect 409 by status code, not message text.
- **Blocker:** No, but users will see intermittent "Version mismatch" failures during normal editing.

## L-8. `listItems` client pagination can loop forever and always fetches the whole canvas serially

- **Severity:** Medium
- **Location:** `src/lib/hooks/use-canvas-items.ts:72-127`
- **Problem:** When no viewport is passed, the hook pages through the entire item set with `while (hasMore)`. If a page ever returns zero items while `hasMore` stays true (server bug, filter mismatch, `limit` coerced to 0), `currentOffset` stops advancing → infinite request loop. There is no guard on page count. It's also a serial waterfall (page N+1 waits for N).
- **Fix:** Break when `nextItems.length === 0`; cap total pages; prefer a server endpoint that returns all items for a canvas in one query (they're already capped by canvas size) or use viewport loading by default.
- **Blocker:** No.

## L-9. Canvas viewport (zoom/pan) resets whenever the canvas record refetches

- **Severity:** Medium
- **Location:** `src/features/canvas/hooks/use-canvas-data.ts:83-92`
- **Problem:** The effect keys on the `canvas` object identity and resets `zoom`/`position` to the persisted values on **every** refetch — e.g., after renaming the canvas (mutation invalidates the canvas query) or any background refetch, the user's current viewport jumps back to the stored one. There is also no code path that persists the live zoom/pan back to the server (the columns exist; `onFitToScreen` just resets locally), so the stored values are stale anyway.
- **Fix:** Initialize the viewport once (e.g., keyed on `canvas.id`), and add a debounced `PATCH` persisting zoom/pan.
- **Blocker:** No.

## L-10. Undo/redo history is incomplete and unsound

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx:203-345` (only delete gets a `Command`), `use-canvas-history.ts`
- **Problem:** Only keyboard-delete registers undo commands. Moves, resizes, edits, creates, context-menu deletes (`handleDeleteFromMenu:582-588`) are not undoable. Undo of a delete recreates items with **new IDs**, so a subsequent redo (re-delete) references the old items' stale `version`/IDs and fails.
- **Fix:** Route all mutations through the command stack, or drop the undo affordance until it's real; on undo-create, capture the newly created IDs into the command for redo.
- **Blocker:** No.

## L-11. WebSocket server: unvalidated message fan-out, no per-message ACL for chat, presence leaks

- **Severity:** High (also listed in security)
- **Location:** `src/lib/collaboration/websocket-server.ts:610-731`
- **Problem:** `case "message"` broadcasts `message.payload` spread verbatim to every client with the sender's userId attached — no schema validation, no size cap, and **no access check** (VIEW-only users and anonymous guests on public canvases can broadcast). `case "cursor"` stores `message.position` unvalidated (could be a huge object, broadcast to all). `broadcastPresence` sends every participant's **email** to all clients, including guests on public canvases.
- **Fix:** Zod-validate WS messages (type, payload shape, size); require COMMENT+ for chat/reactions; strip emails from presence payloads (send name/color only).
- **Blocker:** Yes for public-canvas deployments.

## L-12. Yjs document lifecycle leaks under contention

- **Severity:** Medium
- **Location:** `src/lib/collaboration/yjs-provider.ts:156-181`, `websocket-server.ts:64-104`
- **Problems:** (a) Eviction only happens inside the persistence timer; a canvas with any connected client is re-`getDocument`ed on every message, keeping docs + observers alive indefinitely (expected), but `remotePresence`/`remoteCursors` maps for a canvas are only cleaned in `unsubscribeFromCanvas`, which is skipped entirely when Redis is not configured → stale entries accumulate per canvas visited. (b) `colorIndex` is global and monotonic — fine — but `getNextUserColor` can return `undefined→USER_COLORS[0]` masking an off-by-one. (c) On WS `close`, `unsubscribeFromCanvas` decrements a counter that can go negative if `subscribeToCanvas` failed. (d) `server.on("upgrade")` ignores non-collaboration upgrade requests without destroying the socket — unmatched upgrade requests hang open until client timeout.
- **Fix:** Clean remote maps on last local disconnect regardless of Redis; destroy unmatched upgrade sockets; guard the subscription counter.
- **Blocker:** No.

## L-13. No graceful shutdown for the WS/Yjs layer — up to 30 s of collaborative edits lost on every deploy

- **Severity:** High
- **Location:** `server.ts` (no SIGTERM/SIGINT handling), `yjs-provider.ts` (`PERSISTENCE_INTERVAL = 30s`, `flushDocument` exists but is never called on shutdown)
- **Problem:** Yjs changes persist on a 30-second timer. A deploy/restart (SIGTERM from Docker) kills the process without flushing dirty documents; `src/lib/db.ts` handles Prisma disconnect but nothing drains WS connections or flushes docs.
- **Fix:** On SIGTERM: stop accepting upgrades, close clients with a going-away code, `await flushDocument` for all open canvases, then exit. Compose already sends SIGTERM with a default 10 s grace.
- **Blocker:** Yes if collaboration ships enabled.

## L-14. Idempotency keys grow forever and replay across a 24 h window without request-body comparison

- **Severity:** Medium
- **Location:** `src/lib/api/route-handler.ts:212-300`, `prisma/schema.prisma` `IdempotencyKey` (`@@index([createdAt]) // For cleanup cron jobs` — no such cron exists)
- **Problem:** Rows (including full response bodies as JSON) are deleted only lazily when the same key is re-used after expiry. No scheduled cleanup exists, so the table grows monotonically. Also, replay matches on key+user+method+path only — a client reusing a key with a *different body* silently gets the old response (spec-correct behavior is 422).
- **Fix:** Add a cleanup job (e.g., piggyback on the cron route or a startup sweep); optionally store a request-body hash and reject mismatched reuse.
- **Blocker:** No.

## L-15. Unvalidated numeric query params produce 500s

- **Severity:** Low
- **Location:** `src/app/api/v1/canvases/route.ts:19-23` (`parseInt(...)` NaN passes into Prisma `take`/`skip`), same pattern likely in sibling list routes
- **Problem:** `GET /api/v1/canvases?limit=abc` → `Math.min(NaN, 100)` = NaN → Prisma throws → 500 instead of 400.
- **Fix:** Parse with the existing zod pagination schemas (`viewportPaginationSchema` already exists for items).
- **Blocker:** No.

## L-16. Upload quota accounting is O(objects) per upload and the dev-fallback lock is broken

- **Severity:** Medium
- **Location:** `src/app/api/v1/upload/route.ts:131-154` (`getS3Usage` paginates the whole prefix on every upload), `:248-265` (in-memory waiter)
- **Problem:** Every upload lists all of the user's S3 objects to compute quota — cost and latency scale linearly with stored files (up to 500). The non-Redis fallback lock lets **all** queued waiters proceed simultaneously once the first finishes (each waiter awaits the same promise; there's no re-queue loop) — quota can be exceeded under concurrency in dev. (Redis path is correct.)
- **Fix:** Track per-user usage in a DB column updated transactionally; keep the S3 listing as a periodic reconciliation only.
- **Blocker:** No.

## L-17. `useCollaboration` reconnect churn from unstable deps

- **Severity:** Low
- **Location:** `src/lib/hooks/use-collaboration.ts:251` (effect deps `[canvasId, userId, email, name, enabled, handleMessage]`)
- **Problem:** `userId/email/name` come from `useSession()` and flip from fallback values (`"anon"`) to real values when the session hydrates → the whole WS connection and Y.Doc are torn down and rebuilt at least once per page load. None of these values are even sent to the server (identity comes from the cookie).
- **Fix:** Depend only on `canvasId`/`enabled`.
- **Blocker:** No.

## L-18. Duplicated logic / dead code inventory

- **Severity:** Low-Medium (maintainability)
- **Locations & items:**
  - Two rate-limiter implementations (`src/middleware/rate-limit.ts` vs `src/lib/rate-limit/*`) with duplicated 429 builders and identifier extraction (see L-3).
  - Two selection-state systems: `canvasStore.selectedItemId` (Zustand, persisted docs claim) vs `CanvasBoard` local `selectedItemId`/`selectedItemIds` — the Zustand one is mostly bypassed; context-menu state duplicated similarly.
  - `src/lib/auth-options.ts` back-compat shim re-exporting `authConfig`.
  - `SavedView` model explicitly deprecated but still in schema; `Session` table unused under JWT strategy.
  - Orphaned root `e2e/` Playwright specs not covered by `playwright.config.ts` (`testDir: ./tests/e2e`).
  - `/api/ai/generate` re-export shim beside `/api/v1/ai/generate`.
  - `vercel.json` for a deployment model the README declares a non-goal.
  - Presentation-mode plumbing hard-coded off (`isPresentationMode = false`, `onPresentationMode: () => {}` in `CanvasBoard.tsx:778,827`).
  - `checkRateLimitByUser` constructs `new Request('http://localhost')` just to satisfy a signature (`src/lib/rate-limit/middleware.ts:229-231`).
- **Fix:** Consolidate or delete; each duplicate is a future divergence bug.

## L-19. `SlidingWindowRateLimiter` is actually a fixed-window counter

- **Severity:** Low
- **Location:** `src/lib/rate-limit/index.ts:69-122` (INCR + TTL)
- **Problem:** Naming/docs claim sliding window; implementation is fixed-window INCR with TTL (allows 2× burst at window edges). Fail-open on Redis errors is a deliberate but undocumented-at-callsite availability>protection trade-off.
- **Fix:** Rename or implement sliding window (sorted-set or token bucket); document fail-open.
- **Blocker:** No.

---

## Production Blockers

Must be fixed before launch, in this order:

1. **L-1** — Create and commit Prisma migrations; wire `migrate deploy` into deploy/startup. Nothing else matters until the DB can be provisioned.
2. **L-2 + L-3** — Fix auth rate-limit scoping and identifier; back middleware limits with Redis. The app is unusable and unprotected otherwise.
3. **L-4** — Resolve the REST-vs-Yjs dual write path (or disable Yjs persistence) to stop silent data loss/resurrection.
4. **L-11** — Validate + authorize WebSocket messages; stop leaking emails in presence.
5. **L-13** — Graceful shutdown flush for Yjs docs (only if collaboration ships).
6. **L-5** — Session revalidation/revocation on password change and account deletion.
7. **S-1 (CORS wildcard bypass)** — see `security-issues.md`.
