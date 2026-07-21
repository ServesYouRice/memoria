# Logical / Implementation Audit — Memoria

Findings ordered by severity. "Location" references are exact file/line as of this audit.

---

## L-1 — CRITICAL: Upload rate-limit prefix also throttles image *reads* — 10 requests/hour/IP kills image-heavy canvases

- **Severity:** Critical
- **Location:**
  - `src/proxy.ts:95` — `if (request.nextUrl.pathname.startsWith("/api/v1/upload"))` (matches **both** `/api/v1/upload` and `/api/v1/uploads/...`)
  - `src/middleware/rate-limit.ts:100-104` — `uploadRateLimit = rateLimit({ maxRequests: 10, windowMs: 60 * 60 * 1000 })`
  - `src/app/api/v1/uploads/[assetId]/route.ts:95` — image responses sent with `cache-control: private, no-store`
  - `src/features/canvas/components/ImageItem.tsx:64-77` — every image item loads `content.url` (which is `/api/v1/uploads/<assetId>` per `src/app/api/v1/upload/route.ts:414`) via `new window.Image()`
- **Description:** The string-prefix match intended for the upload **write** endpoint (`/api/v1/upload`) also captures the private image **read** proxy (`/api/v1/uploads/[assetId]`). Reads are therefore limited to **10 per hour per IP**. Because responses are `no-store`, the browser refetches every image on every canvas mount/re-render — the 11th image request in an hour returns 429 and the image never renders (and `ImageItem` swallows the error, see UI-2).
- **Failure scenario:** Any user opens a canvas containing 11+ images (or opens two canvases with a few images each within an hour): all further images silently fail for the next hour. Behind a shared office IP/NAT, one colleague's canvas exhausts the budget for everyone (compounded by S-1).
- **Why it matters:** This breaks a core item type under completely normal usage; it is invisible in dev (memory store resets, and dev traffic rarely crosses 10 in an hour).
- **Recommended fix:** Use exact-segment matching in `src/proxy.ts` — apply `uploadRateLimit` only to `pathname === "/api/v1/upload"` (POST), and give `/api/v1/uploads/` its own generous read limit (e.g. 600/min per user). Additionally allow private caching (`Cache-Control: private, max-age=...` + `ETag`) on asset reads (see P-2).
- **Blocker:** **Yes.**
- **Related:** UI-2 (silent failure), S-1 (per-IP keying), P-2 (no-store + full buffering).

## L-2 — Per-endpoint/per-user rate-limit module is dead code; actual limits are per-IP only

- **Severity:** Medium
- **Location:** `src/lib/rate-limit/endpoint-limits.ts` (entire file — `getEndpointLimit`, `getRateLimitKey`, `getRateLimitHeaders` are imported nowhere; verified by grep)
- **Description:** A well-designed per-endpoint config (per-user keys, response headers, path normalization) exists but nothing uses it. The live limits come from `src/middleware/rate-limit.ts` and are keyed exclusively by IP (`x-memoria-client-ip`). The dead module's numbers also disagree with live ones (e.g. it documents 10 uploads/min while the live limiter is 10/hour), so anyone reading it will mis-tune the system.
- **Why it matters:** Dead code that looks authoritative causes wrong operational decisions; per-user limiting is genuinely needed (see S-1).
- **Recommended fix:** Either wire `endpoint-limits.ts` into the middleware (preferred — it already supports per-user keys) or delete it and document the real limits in one place.
- **Blocker:** No.

## L-3 — Auth lockout fails open on Redis errors while rate limiting fails closed — inconsistent degradation

- **Severity:** Medium
- **Location:** `src/lib/auth/account-lockout.ts:140-142` (`catch` → logs and continues with `attempts = 1`, `locked = false`; the in-memory fallback is only reached when Redis is absent, not when it errors), vs. `src/lib/rate-limit/index.ts:108-121` (production fails closed)
- **Description:** If Redis errors mid-flight (failover, timeout), `recordFailedAttempt`/`isAccountLocked` swallow the error and effectively disable lockout, while the HTTP rate limiter in the same deployment rejects everything. Two abuse controls, opposite failure semantics.
- **Failure scenario:** During a Redis blip an attacker gets unlimited password attempts against a known email (auth HTTP rate limit may also be degraded if the limiter store is the same failing Redis — in that case *it* fails closed, masking the issue; but the WebSocket/lockout path has no such backstop).
- **Recommended fix:** In production, treat Redis errors in the lockout path as "locked" (fail closed) or fall through to the in-memory store on error as well as on absence.
- **Blocker:** No.

## L-4 — `jwt` callback issues a DB query on every request

- **Severity:** Medium (correct behavior, real cost)
- **Location:** `src/lib/auth.ts:104-116`
- **Description:** The session-revocation check (`sessionVersion`) runs `prisma.user.findUnique` inside the `jwt` callback, which executes for every `auth()` call — every RSC page render and every API request (the request-scoped `session-cache` dedupes within one request only).
- **Why it matters:** Adds a serial DB round-trip to every request; under the 5s canvas polling loop (`POLLING_INTERVAL_ACTIVE_MS`) each active collaborator generates ≥12 extra user lookups/minute. It also makes the DB a hard availability dependency for otherwise cache-served responses.
- **Recommended fix:** Cache `sessionVersion` per user in Redis with a short TTL (10–30 s) and invalidate on bump (change-password/account actions already know when they bump it). This preserves the ≤30 s revocation window already accepted for WebSockets (`AUTHORIZATION_LEASE_MS = 30_000`).
- **Blocker:** No.

## L-5 — WebSocket authorization heartbeat does 2 DB queries per connection every 30 s

- **Severity:** Medium
- **Location:** `src/lib/collaboration/websocket-server.ts:505-517` (heartbeat calls `revalidateConnectionAccess(client, true)` with `force = true`), `:607-641` (two Prisma queries per call)
- **Description:** The heartbeat forces revalidation for **every** client every 30 s regardless of the 30 s lease (`force=true` bypasses the freshness check that message handling uses). With the allowed 100 connections/canvas across many canvases, this is `2 × connections / 30s` steady-state DB load with zero batching (each connection queries the same canvas row separately).
- **Recommended fix:** Batch per canvas (one canvas+shares query per canvas per sweep, one `user.findMany` for distinct user IDs), or honor the lease timestamp in the heartbeat too (message-driven traffic already refreshes it).
- **Blocker:** No; matters at ~hundreds of concurrent collaborators.
- **Related:** `REMAINING-WORK.md` COR-23/PERF-18 (presence TTL model).

## L-6 — Full-canvas item fetch paginates up to 100 pages serially on the client

- **Severity:** Medium (known ceiling, sharp edge)
- **Location:** `src/lib/hooks/use-canvas-items.ts:113-140` (`while (hasMore && pageCount < 100)` … `throw new Error("Canvas exceeds the safe item page limit")`)
- **Description:** The default (non-viewport) path loads *all* items by fetching pages sequentially, then hard-fails the whole canvas load with an exception if there are still more. Two problems beyond the documented PERF-01 ceiling: (a) sequential awaits make worst-case load time `pages × RTT`; (b) crossing the limit turns a slow canvas into a **completely unloadable** canvas (the error is thrown, not degraded).
- **Recommended fix:** Until viewport loading becomes primary (PERF-01), parallelize page fetches after page 1 (total is known) and degrade gracefully (load first N items + banner) instead of throwing. Note each page also costs a rate-limit token from the 200/min items budget — 100 pages of polling can hit it.
- **Blocker:** No for launch-size canvases; yes before advertising "10k+ items".

## L-7 — Canvas share email matching relies on exact lowercase equality; share list can grow unbounded

- **Severity:** Low–Medium
- **Location:** `src/app/api/v1/canvases/[canvasId]/share/route.ts:56-71`; consumers `src/lib/api/auth.ts:52-57`, `src/lib/collaboration/websocket-server.ts:419-423`
- **Description:** Shares are keyed by lowercased email string, not user ID. Consequences: (a) a user who changes their account email loses all shares silently and the old email's future owner could inherit them (email-change exists via profile flows; shares do not migrate); (b) there is no cap on shares per canvas and no cleanup when a share target never registers; (c) no invitation/acceptance lifecycle (known: PRODUCT-01).
- **Recommended fix:** On email change, either migrate `CanvasShare.email` rows for the verified old address or invalidate them explicitly; add a per-canvas share cap (e.g. 100); proceed with the PRODUCT-01 invitation lifecycle.
- **Blocker:** No.

## L-8 — Share route (and a few others) bypass the shared handler stack

- **Severity:** Low (consistency/maintainability, tracked as MNT-06)
- **Location:** `src/app/api/v1/canvases/[canvasId]/share/route.ts` (manual try/catch, no `withApiHandler`, no idempotency, no request-scoped session cache), similarly `.../public/route.ts`, `src/app/api/v1/share/[token]/route.ts`, `src/app/api/v1/users/change-password/route.ts`
- **Description:** Newer routes use `withApiHandler`/`withAuthValidation` (centralized logging, RFC 7807 mapping, idempotency, session cache); these older routes hand-roll try/catch. Behavior is currently correct, but error/log format and correlation IDs diverge, and future cross-cutting changes (e.g. S-1 fix) must be applied twice.
- **Recommended fix:** Migrate the remaining hand-rolled routes onto the wrapper stack (mechanical change).
- **Blocker:** No.

## L-9 — Upload asset delete removes the object before the DB row — orphaned-row/object asymmetry

- **Severity:** Low
- **Location:** `src/app/api/v1/uploads/[assetId]/route.ts:116-131` (S3 `DeleteObjectCommand` then `prisma.uploadAsset.delete`)
- **Description:** If the process dies (or Prisma errors) between the S3 delete and the DB delete, a DB row points to a missing object: subsequent GETs 500 (S3 `NoSuchKey` propagates as an unhandled error, not a 404) and quota counters keep charging the user for freed bytes. The reverse order (DB first, object second) would instead leak storage — safer, and reconcilable by a sweep job.
- **Recommended fix:** Delete DB row first, then object (best-effort with logged failures), and map `NoSuchKey`/`ENOENT` on GET to a 404. Longer term this belongs with the SEC-12 outbox pattern.
- **Blocker:** No.

## L-10 — Bookmark refresh cron marks failed fetches as "fresh", so dead URLs cycle forever (known: COR-16)

- **Severity:** Low (tracked)
- **Location:** `src/app/api/cron/refresh-bookmarks/route.ts:52-59` (fetch-failed → `updatedAt = now`, version bump), `scripts/scheduler.mjs` (15-min cadence, batch of 10)
- **Description:** Failure handling just moves items to the back of the `updatedAt` queue with no backoff state — acknowledged in `REMAINING-WORK.md` COR-16. Added observation: bumping `version` on a *no-op* touch also invalidates optimistic-concurrency for any client that had the item open (their next autosave hits a version conflict and refetches), so a dead bookmark URL causes recurring edit interruptions for whoever keeps that canvas open.
- **Recommended fix:** Track attempt/backoff columns per COR-16, and do not bump `version` when content did not change (touch `updatedAt` only, or better: keep a separate `lastRefreshAt`).
- **Blocker:** No.

## L-11 — Registration verification email is sent outside the user-creation transaction with no failure recovery

- **Severity:** Medium
- **Location:** `src/app/api/v1/auth/register/route.ts:130-146` (token row created in tx; `sendEmailVerification` called after)
- **Description:** If the email provider errors after the user row is committed, the account exists but the user never gets the verification email. In production they cannot sign in (verification gate) and re-registering fails (email exists). Recovery exists (`/api/v1/auth/send-verification`) but nothing in the UI funnel points there (see UI-1), and the register response still reports success.
- **Recommended fix:** Catch send failures, log + surface `verificationEmailSent: false` in the response, and give the login page a visible "resend verification email" path.
- **Blocker:** Fold into the UI-1 fix (that one is a blocker).

## L-12 — `errorResponse` used with `request.url` may echo internals; correlation handling inconsistent (known: MNT-06)

- **Severity:** Low
- **Location:** e.g. `src/app/api/v1/canvases/[canvasId]/share/route.ts:74`, `src/lib/api/route-handler.ts:57` (correlation from `x-correlation-id` header) vs `src/proxy.ts:21` (`x-request-id`)
- **Description:** Two different correlation headers (`x-request-id` generated in proxy, `x-correlation-id` read in the handler) are never joined, so API error logs cannot be correlated with proxy access logs. Tracked broadly under MNT-06; called out here because it makes production incident debugging materially harder.
- **Recommended fix:** Have `withApiHandler` read `x-request-id` (set by proxy) as the correlation ID and include it in RFC 7807 bodies.
- **Blocker:** No.

## L-13 — Client hooks assume response shape without validation at the boundary

- **Severity:** Low (tracked as MNT-05 "boundary `any`")
- **Location:** `src/lib/hooks/use-canvas-items.ts:106-118` (`firstPage.total ?? items.length` etc. on untyped `response.json()`), `use-agent-control.ts`, others
- **Description:** Server responses are consumed as loosely-typed JSON; a server-side shape change (or an HTML error page from a proxy) produces `undefined` arithmetic rather than a clear failure. Zod exists on the server side; the client trusts blindly.
- **Recommended fix:** Share lightweight Zod response schemas (or generated types) for the highest-traffic endpoints (canvas-items list/create/update) and fail with a diagnosable error.
- **Blocker:** No.

## L-14 — Dev-mode WebSocket upgrade handler destroys non-collaboration upgrades (HMR risk)

- **Severity:** Low (dev-only)
- **Location:** `src/lib/collaboration/websocket-server.ts:466-469` (`else { socket.write("HTTP/1.1 404..."); socket.destroy(); }`) with `pnpm dev` running the same `server.ts`
- **Description:** The upgrade listener 404s every upgrade that isn't `/api/collaboration/*`. Next.js dev HMR (`/_next/webpack-hmr`) also uses WebSocket upgrades on the same HTTP server; depending on listener ordering this can kill hot reload in dev. Production is unaffected (no other WS endpoints).
- **Recommended fix:** In the `else` branch, return without destroying the socket when `dev === true` (let Next's own upgrade handler claim it).
- **Blocker:** No.

---

## Production Blockers

Things that must be fixed (or explicitly risk-accepted) before real users arrive:

| # | Item | Finding | Effort |
|---|---|---|---|
| 1 | Image reads throttled to 10/hour/IP + `no-store` + silent client failure | **L-1** (+ UI-2, P-2) | Small (one-line matcher fix + placeholder); caching fix medium |
| 2 | All abuse controls keyed to raw socket IP — collapse behind any reverse proxy / TLS terminator | **S-1** (see `security-issues.md`) | Medium (trusted-proxy config + per-user keys) |
| 3 | Registration → verification → login funnel broken in production only | **UI-1 / L-11** | Small |
| 4 | Open self-registration on self-hosted instances with no off switch | **S-2** | Small |
| 5 | Account-lockout DoS by email (5 wrong passwords locks any victim account) | **S-3** | Small–Medium |
| 6 | No DB-backed integration or real-flow e2e evidence for destructive paths (deletion, restore, webhook outbox) | `testing-gaps.md` T-1/T-2 (tracked TST-02/03) | Medium |

Items 1, 3, 4 are cheap and should land first; item 2 is the most operationally dangerous because the reference self-host deployment almost certainly sits behind a TLS-terminating proxy.
