# OPUS.md — Pre-Production Audit

Comprehensive pre-production audit of the Next.js / Prisma / NextAuth v5 / Y.js project at `c:/Users/V/notes`. Findings are grouped by category with severity, evidence (file:line) and a recommended fix strategy. Nothing has been changed in code — this file is the single source of truth for the clean-up pass.

Severity key: **BLOCKER** (will fail in prod), **HIGH** (correctness/security), **MED** (perf/leak/latent), **LOW** (code-smell/DX).

---

## 1. Configuration

### 1.1 [BLOCKER] `require` used in ESM next.config.mjs
[next.config.mjs:53](next.config.mjs#L53) — `require.resolve('konva/lib/index.js')` executed in a `.mjs` file. `require` is not defined in native ESM → `ReferenceError: require is not defined` at `next build`.
**Fix:** use `import.meta.resolve('konva/lib/index.js')`, or convert to `createRequire`:
```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
```

### 1.2 [BLOCKER] `.env` committed to the repo
Git status at session start shows `.env` is tracked. Any secret in it (NEXTAUTH_SECRET, DATABASE_URL, OPENAI_API_KEY, S3 creds) is leaked in history.
**Fix:** rotate all secrets, `git rm --cached .env`, confirm `.gitignore` contains `.env`, audit git history (`git log -- .env`) and rewrite if needed.

### 1.3 [BLOCKER] Dynamic route params signature broken for Next.js 15
Next.js 15 turned `params` into a `Promise`. Two routes still use the synchronous shape:
- [src/app/api/v1/canvases/[canvasId]/route.ts:19](src/app/api/v1/canvases/[canvasId]/route.ts#L19) — `{ params }: { params: { canvasId: string } }` destructured directly without `await`. Every GET/PATCH/DELETE on a canvas detail page 500s.
- [src/app/api/v1/api-keys/[keyId]/route.ts:8](src/app/api/v1/api-keys/[keyId]/route.ts#L8) — same pattern; DELETE of an API key will fail.

Eleven other dynamic routes correctly use `Promise<{...}>` + `await params` (e.g. `canvas-items/[itemId]`, `items/[itemId]/comments`). These two are outliers.
**Fix:** change to `interface RouteContext { params: Promise<{ canvasId: string }> }` and `const { canvasId } = await params;`.

### 1.4 [HIGH] `@next/bundle-analyzer` version mismatch
[package.json:79](package.json#L79) pins `@next/bundle-analyzer: ^16.0.7` while [package.json:61](package.json#L61) pins `next: 15.0.3`. Major-version skew can break webpack hooks (`NextConfig` shape, plugin initialisation) and `ANALYZE=true pnpm build`.
**Fix:** pin `@next/bundle-analyzer` to `^15.0.3` (matching Next major).

### 1.5 [HIGH] `next-auth` is on a 5.x beta
[package.json:62](package.json#L62) — `next-auth: 5.0.0-beta.25`. Betas receive breaking changes without a semver bump (cookie names, JWT callback signature, salt).
**Fix:** either upgrade to the latest 5.x stable once released, or pin to an exact beta version and lock the lockfile.

### 1.6 [MED] TypeScript config excludes tests from type-check
[tsconfig.json](tsconfig.json) sets `"exclude": ["node_modules", "tests", "src/__tests__"]`. `tsc --noEmit` will not catch type errors in test files, and `noUncheckedIndexedAccess: false` means indexed access lies about possibly-undefined values.
**Fix:** remove `tests`/`src/__tests__` from `exclude` (or add a separate `tsconfig.test.json`) and turn `noUncheckedIndexedAccess` on for new code.

### 1.7 [MED] `dotenv-safe` requires `.env.example` at runtime
[server.ts](server.ts) imports `dotenv-safe/config`; this library reads `.env.example` to enforce that every key is present in `.env`. Missing or renamed keys crash the server at boot.
**Fix:** keep `.env.example` in sync with `src/lib/env.ts` schema, or drop `dotenv-safe` in favour of Zod-only validation (you already have it in `src/lib/env.ts`).

### 1.8 [LOW] Empty-string env values pass `z.string().optional()`
[src/lib/env.ts:26-48](src/lib/env.ts#L26-L48) — `SENTRY_DSN`, `S3_*`, `UPLOAD_*` are `z.string().optional()`. `.env.example` ships with `SENTRY_DSN=""` etc. Zod treats `""` as a valid string, not `undefined`, so downstream code checking `if (process.env.SENTRY_DSN)` still skips init, but code that does `.length > 0` will behave inconsistently.
**Fix:** either `.string().min(1).optional()` or transform `""` → `undefined`.

### 1.9 [LOW] Dead/commented import at top of next.config.mjs
[next.config.mjs:15](next.config.mjs#L15) — `// import { env } from './src/lib/env.ts';` — remove or wire through.

---

## 2. Dependency / Module Path Issues

### 2.1 [BLOCKER] Duplicate `requireAuth` with different return shapes
Two modules export a function named `requireAuth` with incompatible contracts:

| Module | Returns | Call sites |
|---|---|---|
| [src/lib/api/auth.ts:22](src/lib/api/auth.ts#L22) | `{ userId, email }` | used by most `/api/v1/*` routes |
| [src/lib/auth/middleware.ts:18](src/lib/auth/middleware.ts#L18) | raw `user` object | no current importers, but exported |

Both paths resolve via `@/lib/*` — a refactor that imports from the wrong one will silently compile (both return `Promise<something>`) and blow up at `.userId` access.
**Fix:** delete `src/lib/auth/middleware.ts` entirely (nothing imports it per `grep "from '@/lib/auth/middleware'"` → zero matches), keep `src/lib/api/auth.ts` as the one true auth module.

### 2.2 [BLOCKER] Duplicate `withAuth` helpers
- [src/lib/api/route-handler.ts:56](src/lib/api/route-handler.ts#L56) — wraps `(req, session, ctx) => handler`, has idempotency support, used throughout API routes.
- [src/lib/auth/middleware.ts:78](src/lib/auth/middleware.ts#L78) — a different generic `withAuth<T>` with a different signature; also unused.

**Fix:** same as 2.1 — delete `src/lib/auth/middleware.ts`.

### 2.3 [HIGH] Three independent Redis client constructions
- [src/lib/cache/redis-client.ts:36](src/lib/cache/redis-client.ts#L36) — singleton used by cache + auth.
- [src/lib/rate-limit/stores/redis.ts](src/lib/rate-limit/stores/redis.ts) — constructed fresh inside `createRateLimiter`.
- [src/lib/auth/account-lockout.ts:31](src/lib/auth/account-lockout.ts#L31) — yet another `new Redis(redisUrl, ...)`.

On a busy server you can end up with N Redis connections per process instance (see §3.2).
**Fix:** export a single `getRedisClient()` from `src/lib/cache/redis-client.ts`, have every other caller reuse it (call `.duplicate()` only when you need a dedicated pub/sub subscriber).

### 2.4 [HIGH] Duplicate account-lockout systems with different key formats
- [src/lib/auth.ts:20,34,49](src/lib/auth.ts#L20-L49) — uses Redis keys `auth:attempts:<email>` (no lowercase normalisation, TTL based on first attempt, cleared on success).
- [src/lib/auth/account-lockout.ts:42-164](src/lib/auth/account-lockout.ts#L42-L164) — uses `lockout:<email-lowercase>` with a JSON blob containing `{attempts, lockedUntil}`.

`authorize()` only calls the former; the latter is unreachable but imports `ioredis` at module level. A login succeeds, clears `auth:attempts:*`, but `lockout:*` never gets touched.
**Fix:** pick one. Recommend keeping `account-lockout.ts` (richer semantics, email normalisation) and rewriting `auth.ts` to use it.

### 2.5 [HIGH] Duplicate `sanitizeFilename`
- [src/lib/sanitization.ts:300](src/lib/sanitization.ts#L300) — library helper.
- [src/app/api/v1/upload/route.ts:42](src/app/api/v1/upload/route.ts#L42) — local copy with slightly different regex (keeps dots differently, no `..` collapse).

They drift independently.
**Fix:** import from `@/lib/sanitization`.

### 2.6 [LOW] Files deleted in working tree but still exported from barrels
`git status` shows many `src/lib/hooks/use-*.ts`, `src/lib/services/*.ts`, `src/lib/utils/*.ts`, `src/types/branded.ts` as **deleted** while [src/lib/hooks/index.ts](src/lib/hooks/index.ts), [src/lib/services/index.ts](src/lib/services/index.ts) and [src/lib/utils/index.ts](src/lib/utils/index.ts) are **modified**. Any consumer of these barrels that still imports a removed name will fail at build.
**Fix:** grep the codebase for each deleted symbol (`useClickOutside`, `useCopyToClipboard`, `useMediaQuery`, `useLocalStorage`, `useMount`, `useToggle`, `useWindowSize`, `analytics`, `featureFlags`, `notifications`, `share`, `accessibility`, `array`, `clipboard`, `color`, `date`, `debounce`, `image`, `object`, `performance`, `storage`, `string`, `url`, `Branded` types) and either restore the modules or delete the call sites.

### 2.7 [LOW] Stale `@deprecated SavedView` still in schema
[prisma/schema.prisma:316](prisma/schema.prisma#L316) — kept for "backwards compatibility" but there's no migration plan in the repo. Drop it before GA or the extra table stays forever.

---

## 3. Runtime / Async / Resource Leaks

### 3.1 [BLOCKER] Rate-limiter store created on every request
[src/lib/rate-limit/middleware.ts:112-118](src/lib/rate-limit/middleware.ts#L112-L118) — `checkRateLimit` calls `createRateLimiter(config)` on **every call**, which in [src/lib/rate-limit/index.ts:155](src/lib/rate-limit/index.ts#L155) constructs a fresh `RedisRateLimitStore` → `new Redis(...)` for each incoming request. In `src/middleware.ts` any `/api/v1/*` call runs through up to three limiters (specific + general + upload/auth), so we open 3× new Redis sockets per request.

Consequences: file-descriptor exhaustion within minutes, huge P95 tail from TCP handshakes, redis server refusing connections.
**Fix:** memoise the limiter per config key. E.g. cache `Map<string, RateLimiter>` keyed on a stable hash of the config, or have `rate-limit()` factories (used in `src/middleware/rate-limit.ts`) create the limiter once and close over it.

### 3.2 [HIGH] Double-counting against the general `apiRateLimit`
[src/middleware.ts:62-115](src/middleware.ts#L62-L115) — the middleware first applies the path-specific limiter (`authRateLimit`, `uploadRateLimit`, `canvasesRateLimit`, `itemsRateLimit`) and then falls through to `apiRateLimit` for anything `startsWith('/api/v1')`. Every canvas/item/upload/auth request counts **twice**, exhausting the general quota at a fraction of the true volume.
**Fix:** wrap the final `apiRateLimit` in an `else` branch, or early-return after the specific limiter runs.

### 3.3 [HIGH] Memory rate-limit store leaks `setInterval`
[src/lib/rate-limit/stores/memory.ts:19](src/lib/rate-limit/stores/memory.ts#L19) — constructor registers `setInterval(this.cleanup, 60_000)`. Paired with 3.1, each request creates a new store and a new interval handle. `destroy()` is never called. In dev (no Redis) this is a fast memory + CPU leak.
**Fix:** fix 3.1 first; then keep the timer ref-count-friendly by ensuring one store per process (or call `.unref()` on the timer).

### 3.4 [HIGH] Non-atomic optimistic locking on canvas items
[src/app/api/v1/canvas-items/[itemId]/route.ts:70-99](src/app/api/v1/canvas-items/[itemId]/route.ts#L70-L99) — read `version`, compare in JS, then `prisma.canvasItem.update({ where: { id }, data: { version: { increment: 1 } } })`. Two concurrent PATCH requests with the same `data.version` both pass the JS check and both succeed, corrupting the monotonic contract.
**Fix:** combine into a single conditional update:
```ts
const result = await prisma.canvasItem.updateMany({
  where: { id: itemId, version: data.version, deletedAt: null },
  data: { ...fields, version: { increment: 1 }, updatedById: userId },
});
if (result.count === 0) throw new VersionMismatchError(...);
```
Same issue in the `DELETE` branch (lines 126-148).

### 3.5 [HIGH] Upload quota is a TOCTOU race
[src/app/api/v1/upload/route.ts:333-352](src/app/api/v1/upload/route.ts#L333-L352) — `getDirectoryUsage(uploadDir)` scans the directory, then `writeFile(filePath, buffer)` later. Two simultaneous uploads both read `fileCount = 499` and both write → 501. Same problem for `totalBytes`.
**Fix:** either (a) move quota tracking into Postgres with a transactional counter on `User`, or (b) use `writeFile(...{flag:'wx'})` then re-scan and delete if over quota.

### 3.6 [HIGH] Yjs persistence has no mutex
[src/lib/collaboration/yjs-provider.ts](src/lib/collaboration/yjs-provider.ts) schedules `persistDocument(canvasId)` via `setTimeout`. Two independent callers for the same canvas (e.g. scheduled flush + client-triggered flush) can run concurrently; inside, we compute `toCreate/toUpdate/toDelete` from a shared `dirtyItemIds` set that is mutated while Prisma writes are in flight. Double-creates and "deleted item reappears" bugs are likely.
**Fix:** keep an `inFlight` Promise per `canvasId`; subsequent calls either await it or schedule a follow-up flush after it resolves.

### 3.7 [HIGH] WebSocket zombie cleanup mutates during iteration
[src/lib/collaboration/websocket-server.ts](src/lib/collaboration/websocket-server.ts) — the heartbeat loop iterates `clients` with `.forEach` and calls `clients.delete(client)` inside. For `Set.prototype.forEach` this is safe but fragile; if the collection is later migrated to `Map<canvasId, Set<Client>>` iteration the delete can skip entries.
**Fix:** collect zombies first into a local array, then `for (const c of dead) clients.delete(c)` after the iteration.

### 3.8 [HIGH] WebSocket cookie names are wrong for NextAuth v5
[src/lib/collaboration/websocket-server.ts](src/lib/collaboration/websocket-server.ts) — code reads `next-auth.session-token` / `__Secure-next-auth.session-token`. NextAuth v5 renamed them to `authjs.session-token` / `__Secure-authjs.session-token`. Unless you override `cookies.sessionToken.name` in the auth config, every WebSocket auth attempt fails → collaborative editing silently doesn't work.
**Fix:** import the config: `import { authConfig } from '@/lib/auth'` and read the real cookie names via `authConfig.cookies?.sessionToken?.name ?? 'authjs.session-token'`. Also verify the `decode({salt})` argument matches NextAuth v5 behaviour (salt = cookie name).

### 3.9 [HIGH] `sessionStorage.enterWith(cache)` leaks context
[src/lib/api/session-cache.ts:32-39](src/lib/api/session-cache.ts#L32-L39) — when the store is missing, `enterWith` is called to plant one. `enterWith` is notoriously unsafe: it mutates the current async context and stays alive for the rest of the event-loop turn, which can bleed one request's session into an unrelated background task. `auth()` only runs inside a Next.js request, so `enterWith` is rarely needed; if it is, it must be the `.run()` API.
**Fix:** remove the fallback. If `getStore()` returns undefined, just fetch fresh each time. The cache benefit within a handler is negligible once `auth()` itself is memoised per request upstream.

### 3.10 [HIGH] Idempotency key deleted on handler exception
[src/lib/api/route-handler.ts:207-210](src/lib/api/route-handler.ts#L207-L210) — if the wrapped handler throws, the idempotency row is deleted so the next retry "can succeed". That defeats the purpose: the handler may have committed partial side-effects (e.g. write a file, send an email) before throwing, and the retry will redo them.
**Fix:** don't delete on failure. Store the error response (`responseCode`, `responseBody`) so the client gets a stable reply; mark the row as `status: 'failed'` if you want to expose retry semantics.

### 3.11 [HIGH] API-key lookup is O(n) Argon2 verify
[src/lib/api/api-key-auth.ts:80-153](src/lib/api/api-key-auth.ts#L80-L153) — when no `keySuffix` match exists, we fall back to `findMany({ revokedAt: null })` and run `argon2.verify` against every key in the system. With Argon2id at `memoryCost: 19456, timeCost: 2`, a single verify is ~30-80 ms. 1,000 keys ≈ 30-80 seconds per request → trivial DoS.
**Fix:** require callers to include the `keyPrefix` (e.g. `ck_abc123…`), store it on creation, and look up by prefix+suffix. Refuse the request if neither matches. Legacy plaintext keys should be migrated one-time in a backfill job, not discovered on the hot path.

### 3.12 [MED] Fire-and-forget updates swallow errors
[src/lib/api/api-key-auth.ts:142-145](src/lib/api/api-key-auth.ts#L142-L145), [src/lib/api/route-handler.ts:161,208](src/lib/api/route-handler.ts#L161) — `.catch(() => {})` discards *all* errors, including Prisma schema mismatches that would otherwise surface during deploys.
**Fix:** log the error: `.catch(err => logger.warn({err}, 'background update failed'))`.

### 3.13 [MED] `instrumentation.ts` `process.exit(1)` only in production
The unhandledRejection/uncaughtException handlers register at boot but only exit the process when `NODE_ENV === 'production'`. In dev, a stray unhandled rejection leaves the server in an undefined state. That's the debugging experience you don't want.
**Fix:** always exit in a handler after flushing Sentry; use `nodemon`/`tsx watch` to restart.

### 3.14 [MED] DNS lookup on every redirect hop in SSRF guard
[src/lib/utils/ssrf-protection.ts](src/lib/utils/ssrf-protection.ts) validates the URL, then re-validates each redirect. DNS resolution is performed per hop; each hop can add 50-200 ms. For 5 redirects that's ~1 s wall-clock.
**Fix:** cache DNS results for the request's lifetime (small `Map<hostname, address>`), still respecting TTL boundaries.

### 3.15 [MED] Bookmark refresh cron is sequential
[src/app/api/cron/refresh-bookmarks/route.ts](src/app/api/cron/refresh-bookmarks/route.ts) — loops 10 bookmarks calling `safeFetch` serially. With 5s timeouts each, one slow host blocks the rest.
**Fix:** `await Promise.all(bookmarks.map(...))` with a small `p-limit` (e.g. 4).

### 3.16 [LOW] Zustand `persist` writes ephemeral viewport state
[src/stores/canvasStore.ts:161](src/stores/canvasStore.ts#L161) partializes correctly (only tool/grid/drawing), good. But `resetView` sets zoom/pan to `1.0/0/0` inside the persisted store — ephemeral fields exist on the state but aren't persisted, so this is fine. No change required; keeping as LOW note to confirm.

---

## 4. Security / XSS / SSRF / Auth

### 4.1 [HIGH] Public canvases let anonymous users post comments
[src/app/api/v1/items/[itemId]/comments/route.ts:65-83](src/app/api/v1/items/[itemId]/comments/route.ts#L65-L83) — access check is `isOwner || hasShare || isPublic`. `isPublic` doesn't require authentication; an unauthenticated user with the share link can POST comments because the `UnauthorizedError` at line 34 only fires when there's no session at all, but the call-site for anonymous users just gets the `!isOwner && !hasShare && !isPublic` branch. Actually re-reading: line 33-36 does throw `Unauthorized` if no session. So anonymous users are blocked — good. But **a logged-in user who is not the owner and has no share** can still comment on any public canvas. If that was intentional, say so; if not, tighten to `hasShare` only.
**Fix:** require an explicit share with at least `COMMENT` role regardless of `isPublic`, or add a rate-limit keyed on `userId+canvasId` to prevent spam.

### 4.2 [HIGH] Register vs reset-password password policy divergence
- Registration requires `min(10)` + zxcvbn score.
- [src/app/api/v1/auth/reset-password/route.ts](src/app/api/v1/auth/reset-password/route.ts) uses `min(8)` and **no** zxcvbn call, and imports `argon2.hash` directly instead of the repo's `hashPassword` wrapper. A user can reset to a weaker password than they were allowed to sign up with.
**Fix:** share one `passwordSchema` between register and reset; route both through `hashPassword`.

### 4.3 [HIGH] `sanitizeMarkdown` regex for `ALLOWED_URI_REGEXP` is permissive
[src/lib/sanitization.ts:144](src/lib/sanitization.ts#L144) — `/^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i`. The `[^a-z]` alternative matches anything starting with a digit, slash, `#`, etc., which is fine for relative URLs, but combined with DOMPurify it can be coaxed to accept URI-encoded payloads (`%6aavascript:`) depending on DOMPurify's handling.
**Fix:** use DOMPurify defaults (omit `ALLOWED_URI_REGEXP`) or a stricter `/^(?:https?:|mailto:|\/|#)/i`.

### 4.4 [MED] Raw SQL with user-provided tag array
[src/app/api/v1/search/route.ts](src/app/api/v1/search/route.ts) — uses `Prisma.sql` with `${tags}::text[]`. Prisma's template binding serialises arrays as JSON; the explicit `::text[]` cast may fail or accept surprising inputs.
**Fix:** use Prisma's first-class `tags: { hasEvery: tags }` filter unless there is a concrete reason for raw SQL.

### 4.5 [MED] `safeFetch` doesn't validate redirect Content-Type
If the initial URL returns `text/html` but a redirect lands on `application/octet-stream`, we will still parse it. Combined with the 2 MB cap this is bounded, but metadata extraction can crash on binary.
**Fix:** re-check `response.headers.get('content-type')` after the final hop and bail before parsing.

### 4.6 [MED] SVG blocked but only via MIME list — no re-encoding
[src/app/api/v1/upload/route.ts:28-33](src/app/api/v1/upload/route.ts#L28-L33) rejects SVG, which is correct. But uploaded PNG/JPEG/WebP/GIF are stored as-is; a malicious polyglot (valid PNG magic bytes wrapping JS in an IDAT chunk) served from `/uploads/...` on the same origin as the app can exfiltrate via `<img>` onload. Low severity because no script execution occurs from `<img>`, but worth noting if you ever add `<object>` or SVG sprites.
**Fix:** consider decoding + re-encoding via `sharp` server-side, which also strips EXIF.

### 4.7 [MED] Credentials login error message enumerates accounts
[src/lib/auth.ts:80](src/lib/auth.ts#L80) — when locked, throws `"Account locked due to too many failed attempts"`. This tells an attacker the email exists. Return the generic "Invalid credentials" + a server-side log for the lockout.
**Fix:** return `null` + surface a cooldown via a separate `/account-status` endpoint if you need UX feedback.

### 4.8 [LOW] `withAuthValidation` runs validation inside idempotency, not around it
[src/lib/api/route-handler.ts:109-118](src/lib/api/route-handler.ts#L109-L118) — the idempotency row is written before zod validates the body. A malformed body creates an idempotency row that later succeeds with a valid body under the same key.
**Fix:** validate before calling `runIdempotent`.

---

## 5. Data Model / API Contract

### 5.1 [HIGH] Two unrelated `Session` concepts
[prisma/schema.prisma:209](prisma/schema.prisma#L209) declares a DB `Session` table (required by PrismaAdapter) but [src/lib/auth.ts:58](src/lib/auth.ts#L58) uses `strategy: 'jwt'`. The adapter still creates Session rows in some flows (OAuth account linking) but they're never pruned or used — they accumulate forever.
**Fix:** either switch to database sessions (and delete the JWT callbacks) or set `strategy: 'jwt'` and swap the PrismaAdapter for `@auth/core/adapters` no-op for session ops. At minimum, schedule a cleanup cron for expired `Session` rows.

### 5.2 [HIGH] Comments POST allows VIEW users on public canvases (see 4.1) but also branches incorrectly
[src/app/api/v1/items/[itemId]/comments/route.ts:77-82](src/app/api/v1/items/[itemId]/comments/route.ts#L77-L82) — the "For shared users, check they have COMMENT or EDIT role" block is dead code: `hasShare` was computed with the role-filter `['COMMENT','EDIT'].includes(share.role)` so a VIEW share produces `hasShare === false`, which means the block at line 77 never triggers for VIEW.
**Fix:** compute `hasShare` as "any share exists" and do the role check once; delete the duplicate branch.

### 5.3 [HIGH] `isPublic` canvas returns unauthenticated comment list
[src/app/api/v1/items/[itemId]/comments/route.ts:115-157](src/app/api/v1/items/[itemId]/comments/route.ts#L115-L157) — GET doesn't require auth and returns full commenter details including `email`. Leaks emails of everyone who ever commented on a public canvas.
**Fix:** omit `email` from the select for public access, or require auth for any comment listing.

### 5.4 [HIGH] `canvases/[canvasId]/route.ts` cache ignores permission scope
[src/app/api/v1/canvases/[canvasId]/route.ts:28-51](src/app/api/v1/canvases/[canvasId]/route.ts#L28-L51) — uses `getCachedCanvas(canvasId)` before checking `requireCanvasAccess`. The access check does happen first (line 25), so OK, but the cache key doesn't include `email`/`userId`; ensure `getCachedCanvas` returns canvas-level data only (no per-user share info) — which the code comment claims. Verify the cache serializer doesn't include `shares`.
**Fix:** add a unit test that asserts the cached payload has no user-scoped fields.

### 5.5 [HIGH] Canvas deletion cascade implicitly deletes shared users' comments
Prisma `onDelete: Cascade` from Canvas → CanvasItem → Comment. Deleting a canvas deletes shared editors' comments with no audit log entry.
**Fix:** write an `AuditLog` row in the DELETE handler before the cascade runs, or move to soft-delete on Canvas (there is none today).

### 5.6 [MED] `Workspace` has no sharing / role model
[prisma/schema.prisma:303-313](prisma/schema.prisma#L303-L313) — owned by a single user. Features like "team workspace" that appear in the UI (`share` dialog, workspace switcher) cannot actually be team-shared.
**Fix:** scope the UI to single-user until a `WorkspaceMember` table is added, or add one now.

### 5.7 [MED] `ApiKey.key @unique` on an Argon2 hash
[prisma/schema.prisma:348](prisma/schema.prisma#L348) — Argon2 hashes embed a salt, so every hash is unique even for the same plaintext. The unique index is useless but harmless. However, the `@@index([key])` (line 360) is a large B-tree on hash strings; replace with a cheaper index on `keyPrefix`+`keySuffix` (the actual lookup columns).
**Fix:** drop `@unique` and `@@index([key])`, add `@@index([keyPrefix, keySuffix])`.

### 5.8 [MED] `CanvasItem.content Json` with no server-side type guard on PATCH
[src/app/api/v1/canvas-items/[itemId]/route.ts:94](src/app/api/v1/canvas-items/[itemId]/route.ts#L94) — writes `content as any`. The creation path validates via `canvasItemSchema`, but updates accept arbitrary JSON, letting a malicious client replace a NOTE's content with a BOOKMARK payload and vice-versa, breaking renderers and potentially triggering runtime errors (e.g. `bookmarkContent.url.toLowerCase()` on undefined).
**Fix:** re-validate content with a type-aware schema on update; alternatively, disallow changing `type` and branch the schema on the existing `item.type`.

### 5.9 [MED] `use-canvas-item-handlers` undo recreates items with new IDs
[src/features/canvas/hooks/use-canvas-item-handlers.ts:57-73](src/features/canvas/hooks/use-canvas-item-handlers.ts#L57-L73) — `undo()` calls `createItem({...})` which mints a new `id`. Any connection (`ItemConnection.fromId/toId`), comment, or link that referenced the original id is now orphaned. Redo of "delete" then hits "item not found".
**Fix:** change the DELETE endpoint to accept a soft-undelete via `PATCH {deletedAt: null}` and use it for undo, or implement a true "restore" endpoint that reuses the original id.

### 5.10 [LOW] Denormalised `Canvas.itemCount` is not maintained
[prisma/schema.prisma:88](prisma/schema.prisma#L88) has `itemCount Int @default(0)` but no code increments/decrements it. If any UI relies on it, it's permanently wrong.
**Fix:** either remove the field or wrap item create/delete in a Prisma interactive transaction that updates it.

---

## 6. Frontend / Canvas

### 6.1 [MED] `useCanvasData` manually fetches canvas metadata outside React Query
[src/features/canvas/hooks/use-canvas-data.ts:31-52](src/features/canvas/hooks/use-canvas-data.ts#L31-L52) — `fetchCanvasMetadata` uses bare `fetch`, sets local state, and is not cached/invalidated with other queries. When the canvas's name/zoom is updated elsewhere (PATCH via `updateCanvasName`) other hooks consuming TanStack Query's `useCanvas(canvasId)` won't see the change.
**Fix:** move fetch + mutation into TanStack Query (`useQuery(['canvas', id], ...)` + `useMutation` → invalidate).

### 6.2 [MED] Time-machine memoisation gap
[src/features/canvas/hooks/use-canvas-data.ts:75-80](src/features/canvas/hooks/use-canvas-data.ts#L75-L80) — returns the snapshot by reference; any mutation of `allItems` elsewhere doesn't affect `displayedItems` because the snapshot was frozen, but the tag index is built from `allItems` (line 83) not `displayedItems`, so tags don't match the time-machine view. Expect mismatches in UX.
**Fix:** build `allTags` from `displayedItems`.

### 6.3 [MED] Drag-to-select uses stale `position`/`zoom`
[src/features/canvas/hooks/use-canvas-interaction.ts:52-83](src/features/canvas/hooks/use-canvas-interaction.ts#L52-L83) — handlers capture `position` and `zoom` via closure. If a user pans/zooms mid-drag (via keyboard shortcut fired from another hook), the math is off. Unlikely but worth fixing for trackpad-heavy users.
**Fix:** read from a ref (`positionRef.current`) or from the store directly inside the handler.

### 6.4 [LOW] `CanvasErrorBoundary` wraps the whole canvas but doesn't log to Sentry
Confirm by reading [src/features/canvas/components/CanvasErrorBoundary.tsx](src/features/canvas/components/CanvasErrorBoundary.tsx) — if it only logs to `console.error`, add `Sentry.captureException(error, { extra: errorInfo })`.

### 6.5 [LOW] Upload flow has no client-side size guard before POST
`MAX_FILE_SIZE = 5MB` is server-side. The client-side uploader should reject oversize files before burning bandwidth; the user otherwise waits for the upload, then sees a 400.

---

## 7. Observability / Ops

### 7.1 [MED] `logger.warn(...)` on Redis failure but no metric
All Redis-dependent paths (rate-limit, lockout, cache) log on error and fall open. You have no SLO metric to alert on. Add a counter (Sentry breadcrumb or Prometheus gauge via @opentelemetry) for `redis.errors` so you notice when Redis is down.

### 7.2 [MED] `console.error` in canvas hooks bypasses the logger
E.g. [src/features/canvas/hooks/use-canvas-item-handlers.ts:79](src/features/canvas/hooks/use-canvas-item-handlers.ts#L79). Client-side errors don't reach Sentry unless you wire up `@sentry/nextjs`'s browser init.
**Fix:** replace with `Sentry.captureException(err)` after confirming `instrumentation-client.ts` initialises Sentry.

### 7.3 [LOW] Request ID set in middleware is not threaded into Prisma logs
[src/middleware.ts:18](src/middleware.ts#L18) — generates a nanoid(16) but the logger's `child()` isn't passed to Prisma. Cross-referencing a slow query back to a request ID is painful.
**Fix:** use AsyncLocalStorage for the request ID (`src/lib/logger.ts` already uses pino) so Prisma middleware can read it.

---

## 8. Recommended Fix Order

Triage from "ship-stops-until-fixed" downwards:

1. **§1.1** ESM `require` — the build doesn't succeed today without a trick (Next happens to strip webpack config for builds sometimes; verify on CI).
2. **§1.3** Promise params on the two broken routes — plain 500 for any canvas viewer and any API-key delete.
3. **§1.2** Secrets rotation & `.env` scrub.
4. **§3.1 + §3.2 + §3.3** rate-limiter explosion (Redis DoS once load arrives).
5. **§2.1 + §2.2 + §2.4 + §2.5** collapse duplicate modules; removes a whole class of import-the-wrong-thing bugs.
6. **§3.4 + §3.5 + §3.6** atomicity & race bugs.
7. **§3.8** WebSocket auth cookie fix — otherwise collaboration doesn't work in prod.
8. **§3.11** API-key O(n) DoS path.
9. **§4.1–§4.3** permission & crypto gaps.
10. **§5** data-model coherency (cache scoping, cascade audit, content validation).
11. **§6** frontend correctness.
12. **§7** observability polish.

---

## 9. Out-of-Scope Follow-ups (noted, not fixed)

- Vitest / Playwright test coverage isn't quantified here; recommend running `pnpm test:coverage` and making a separate task if < 70 % on `src/lib/*`.
- `prisma migrate status` not verified — confirm CI/CD runs `prisma migrate deploy` on boot.
- No CSP report-to endpoint is wired up despite having `/api/csp-report` — verify the middleware CSP actually points at it.
- Review Vercel-specific env wiring (`NEXTAUTH_URL` must be the deployed URL, not localhost).
- Seed data, backups, retention — no evidence in repo.

---
---

# Part II — Proposal: LLM / Agent Integration ("AI Organizer")

> This section is a design proposal, not an audit. It lays out a concrete strategy for shipping the new feature: an **AI-organized view** alongside the manual canvas, plus a **BYOK agent integration surface** so third-party assistants (OpenClaw, ChatGPT custom GPTs, WhatsApp bots, Telegram bots, Raycast plug-ins, etc.) can read and mutate a user's canvas on the user's behalf.

## A. Reframing the Product

Today, the product is: **a spatial mesh-canvas where a human arranges links, notes, images, and connections manually.** That is the ground truth.

The proposal turns it into a **two-surface product**:

| Surface | Owner | Mutates ground truth? | Purpose |
|---|---|---|---|
| **Canvas tab** (existing) | Human | Yes | Manual curation, spatial reasoning, the "home" of a note. |
| **AI Organizer tab** (new) | LLM/agent | **No** by default — produces *suggestions* and *virtual groupings* layered over the same notes. The user promotes suggestions into the canvas. | Automatic clustering, tagging, timeline views, "what should I do with this?" flows. |
| **Agent API** (new) | Third-party bots (OpenClaw et al.) | Yes, **only within granted scopes**, fully attributed and undoable. | External assistants acting on behalf of the user. |

Critical design commitment: **the AI never silently overwrites human curation.** AI output is a *lens* on the data (tags, clusters, layouts, summaries) until the user or the user's agent explicitly promotes it. The Agent API, when it *does* mutate, leaves an undoable trail with the agent's identity on every record.

## B. High-Level Architecture

```
┌──────────────────────┐   ┌──────────────────────┐   ┌───────────────────────┐
│ Canvas tab (human)   │   │ AI Organizer tab     │   │ External agents       │
│ existing Konva UI    │   │ (React, new)         │   │ (OpenClaw / WA bot /  │
└──────────┬───────────┘   └──────────┬───────────┘   │ Raycast / ChatGPT GPT)│
           │                          │               └──────────┬────────────┘
           │    TanStack Query        │                          │
           ▼                          ▼                          ▼
┌──────────────────────────────────────────────────┐   ┌───────────────────────┐
│         Canvas REST API  (existing, /api/v1)      │   │  Agent Gateway        │
│ - CRUD items, canvases, shares                    │◄──┤  /api/agent/v1/*       │
│ - Adds: /views, /suggestions, /embeddings         │   │  +  MCP server         │
│                                                   │   │  +  Webhooks (out)    │
└──────────────────────┬───────────────────────────┘   └──────────┬────────────┘
                       │                                           │
                       ▼                                           ▼
              ┌──────────────────┐                       ┌──────────────────────┐
              │ Postgres (Prisma)│                       │ Agent runtime         │
              │ + pgvector       │                       │ - Scope enforcement   │
              └──────────┬───────┘                       │ - BYOK crypto         │
                         │                               │ - Action journal      │
                         ▼                               │ - Per-agent rate limit│
              ┌──────────────────┐                       └──────────┬────────────┘
              │ Provider adapter │ ◄─────────────────────────────────┘
              │ layer (BYOK)     │   (used by AI Organizer tab + by bots
              │ OpenAI/Anthropic │    that delegate LLM calls to us rather
              │ /Gemini/Ollama/  │    than holding the key themselves)
              │ /local           │
              └──────────────────┘
```

Two key decisions fall out of this diagram:

1. **Agent Gateway is a separate surface** from the human-facing REST API. Same DB, different auth, different rate-limit scope, different error semantics, different versioning cadence. Bots evolve faster than UI; we don't want a bot regression to break the UI.
2. **The LLM provider adapter is shared** between the AI Organizer tab (where the *user* brings a key for their own use) and the Agent Gateway (where bots may either hold keys themselves or delegate to us). One abstraction = fewer surprises.

## C. The Agent Integration Surface

You named OpenClaw as the reference consumer, so the protocol must look familiar to that ecosystem: **MCP (Model Context Protocol) first, REST as the compatibility fallback, webhooks for push.**

### C.1 Three channels

1. **MCP server** at `wss://<app>/mcp` (or `stdio`/SSE transport depending on client). Exposes tools like `canvas.list_canvases`, `canvas.create_note`, `canvas.search`, `canvas.query_by_embedding`, `canvas.move_item`, `canvas.connect_items`, `canvas.add_to_workspace`, `canvas.commit_suggestion`. This is the native path for OpenClaw, Claude Desktop, Cursor, ChatGPT's MCP consumer, Raycast's MCP adapter, etc.
2. **REST API** at `/api/agent/v1/*` — the same tool set but as plain JSON endpoints. Lets bots written against the OpenAI function-calling schema, n8n nodes, Zapier actions, etc. consume it without MCP.
3. **Outbound webhooks** — per-user subscriptions. Fire on `item.created`, `item.updated`, `canvas.shared`, `suggestion.ready`. Used when an agent needs to react (e.g. "notify me on WhatsApp when the AI finishes clustering today's notes").

All three share the same authentication, scoping, audit and rate-limit machinery.

### C.2 Authentication model

There are *two* identities at play in every request:

- **User** (the account owner — already exists: `User.id`).
- **Agent** (the bot/automation acting on the user's behalf — new).

Add the concept of **Agent Credentials**, parallel to the current `ApiKey` table but purpose-built:

```prisma
model Agent {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  name        String        // "My OpenClaw bot", "WhatsApp helper"
  vendor      String?       // "openclaw" | "custom" | "zapier" | ...
  description String?

  // Scopes granted. One row per request is checked against these.
  scopes      String[]      // e.g. ["canvas:read","items:write","suggestions:commit"]

  // Restrict to specific canvases or workspaces (optional — null = all owned by user).
  canvasIds   String[] @default([])
  workspaceIds String[] @default([])

  createdAt   DateTime @default(now())
  expiresAt   DateTime?
  revokedAt   DateTime?
  lastUsedAt  DateTime?

  credentials AgentCredential[]
  actions     AgentAction[]

  @@index([userId])
}

model AgentCredential {
  id          String   @id @default(cuid())
  agentId     String
  agent       Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)

  // Either an API token (for REST) or an OAuth-style pair.
  tokenHash   String   // argon2id of the bearer token
  tokenPrefix String   // first 8 chars, for lookup + UI display
  tokenSuffix String   // last 4 chars, for UI display

  type        String   // "bearer" | "oauth_refresh"
  createdAt   DateTime @default(now())
  expiresAt   DateTime?
  revokedAt   DateTime?

  @@index([agentId])
  @@index([tokenPrefix, tokenSuffix])
}

model AgentAction {
  id          String   @id @default(cuid())
  agentId     String
  agent       Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  userId      String
  actionType  String   // "item.create" | "item.move" | "item.delete" | "suggestion.commit"
  targetType  String   // "canvas" | "item" | "workspace" | "suggestion"
  targetId    String
  before      Json?    // for undo
  after       Json?    // for audit
  reversible  Boolean  @default(true)
  reversedAt  DateTime?
  requestId   String?  // ties back to logs
  createdAt   DateTime @default(now())

  @@index([userId, createdAt])
  @@index([agentId, createdAt])
  @@index([targetType, targetId])
}
```

Key choices:
- **Hash the token** (§3.11 already flags the Argon2 cost issue — reuse the `keyPrefix + keySuffix` lookup pattern and keep the verify to O(1) per request).
- **Scopes are strings**, not an enum, so new capabilities don't require a migration.
- **`AgentAction` is a journal**, not a log. We use it for both attribution (who did this?) and undo ("reverse the last 5 actions this agent took in the past 24 h").
- **Resource restriction** via `canvasIds`/`workspaceIds` means a user can grant a bot access to only one canvas ("my Recipes board") without exposing the rest.

### C.3 Scopes

Define six starting scopes. Bots only get what they ask for at install, user approves explicitly:

| Scope | Grants |
|---|---|
| `canvas:read` | List canvases, read items, read tags, read connections, read shares. |
| `canvas:search` | Full-text + embedding search. Split from `canvas:read` because embeddings could leak data the user wants to wall off. |
| `items:write` | Create/update/delete notes, bookmarks, images; move, resize, tag. |
| `items:comment` | Add comments only. For low-trust bots. |
| `suggestions:read` | Read AI organizer output. |
| `suggestions:commit` | Promote an AI suggestion into the canvas as a permanent grouping/tag. |

The app should ship a default **"Everything except destructive"** bundle that excludes `items:delete` behaviours — most assistants don't need to delete.

### C.4 Authorization UX

Introduce an **Install Agent** flow in the Settings UI:

1. User clicks "Connect OpenClaw" (or pastes a custom agent manifest URL).
2. App shows a consent screen: agent name, vendor, description, scopes requested, which canvases/workspaces it will see.
3. On approval, generate `AgentCredential.token`, return it **once** to the agent's install URL (OAuth-style), never store plaintext.
4. User can revoke from the same UI; revoked tokens fail with a specific 401 code so the bot can prompt re-auth.

The MCP equivalent is an OAuth 2.1 flow with PKCE, which MCP clients already support.

## D. The "AI Organizer" Tab

This is the user-facing side of the LLM integration — the part the human looks at.

### D.1 What it actually does

- **Auto-cluster** items by topic ("these 12 notes are about a book club"), author, date, tag, visited URL patterns, etc.
- **Auto-tag** untagged items.
- **Auto-summarize** long notes and clusters.
- **Suggest connections** between items that look related.
- **Generate layouts** on demand ("arrange these as a timeline", "arrange as a kanban by status tag", "stack by similarity").
- **Answer questions** over the canvas: "What did I save about graphql last month?"

### D.2 Key UX constraint: non-destructive by default

The AI tab renders a **read-only virtual canvas** computed from the same items. Clustering/layout is stored as a `CanvasView` record — it references items but doesn't move them. The user sees a switcher:

- **Canvas → Manual** (ground truth)
- **Canvas → AI: Clusters** (virtual)
- **Canvas → AI: Timeline** (virtual)
- **Canvas → AI: Kanban** (virtual)

A "Promote to Canvas" button on any AI view materialises the groupings as real `ItemConnection`s, tags, or positional updates, with a single undo.

### D.3 Data model additions

```prisma
model CanvasView {
  id          String   @id @default(cuid())
  canvasId    String
  canvas      Canvas   @relation(fields: [canvasId], references: [id], onDelete: Cascade)
  userId      String
  name        String   // "AI Clusters", "My Kanban", ...
  viewType    String   // "ai_cluster" | "ai_timeline" | "ai_kanban" | "custom"
  generatedBy String?  // "user" | agent.id | "system"
  provider    String?  // "openai:gpt-4o" | "anthropic:claude-opus-4-7" | ...
  config      Json     // layout params, clustering algo, etc.
  layout      Json     // positions per itemId, NOT persisted to CanvasItem
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([canvasId])
  @@index([userId])
}

model Suggestion {
  id          String   @id @default(cuid())
  canvasId    String
  canvas      Canvas   @relation(fields: [canvasId], references: [id], onDelete: Cascade)
  userId      String
  type        String   // "tag" | "connect" | "cluster" | "summarize" | "rename"
  targetIds   String[] // item ids involved
  payload     Json     // type-specific: proposed tag, proposed connection, proposed summary
  rationale   String?  // LLM's explanation — shown to the user on hover
  provider    String?  // which LLM produced it
  status      String   @default("pending") // "pending" | "accepted" | "rejected" | "expired"
  createdAt   DateTime @default(now())
  decidedAt   DateTime?

  @@index([canvasId, status])
  @@index([userId, status])
}

model ItemEmbedding {
  itemId      String   @id
  item        CanvasItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  provider    String   // "openai:text-embedding-3-small" | "local:bge-small-en"
  dim         Int      // 1536 | 768 | ...
  vector      Unsupported("vector") // pgvector
  contentHash String   // hash of the content at embed time, to detect drift
  embeddedAt  DateTime @default(now())

  @@index([provider])
}
```

Enable `pgvector` in Postgres (Neon + Supabase both support it, and Vercel Postgres too). Embeddings are built lazily on item create/update via a background job.

### D.4 LLM provider adapter (BYOK)

Abstraction shape:

```ts
// src/lib/ai/providers/types.ts
export interface ChatProvider {
  id: string;                 // "openai" | "anthropic" | "gemini" | "ollama"
  chat(opts: ChatOptions): AsyncIterable<ChatChunk>;
  embed(opts: EmbedOptions): Promise<Float32Array[]>;
}

export interface UserProviderKey {
  userId: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | ...;
  // Encrypted at rest with a per-tenant KMS key (AWS KMS / GCP KMS / libsodium
  // sealed box if self-hosted). Never log, never return to the client after save.
  encryptedKey: string;
  nonce: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}
```

Concrete providers: `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `OllamaProvider` (for self-hosted / privacy-first users). Pick one model per provider as the default; let power users override in settings.

Storage: encrypt with libsodium `crypto_secretbox` keyed on a `PROVIDER_KEYS_ENCRYPTION_KEY` env var (32 bytes, base64). Rotate by re-encrypting on next use.

All LLM calls route through a single `callProvider(userId, provider, fn)` helper that:

1. Looks up the encrypted key, decrypts it in memory only.
2. Runs a provider-specific rate limit (also per-user).
3. Emits a usage record so you can show the user "you spent $X this month on Anthropic".
4. Retries on transient failure, doesn't retry on 4xx.

### D.5 When does the AI run?

Three triggers:

- **On demand** — user clicks "Re-cluster", "Generate timeline", "Summarize selection".
- **Scheduled** — nightly cron per user (opt-in) that re-embeds new items, suggests tags, flags duplicates.
- **Agent-initiated** — the bot's `canvas.organize` tool call triggers a cluster run on behalf of the user.

All three go through the same background job queue (introduce one — Trigger.dev, BullMQ on Redis, or just a Postgres `Job` table with a worker). Long-running LLM calls must not block the API request.

## E. Worked Example — The WhatsApp Flow

User message to OpenClaw over WhatsApp: *"Take my last 5 meeting notes and add them to my calendar for tomorrow at 9 AM."*

1. OpenClaw (running under the user's account, holding the `Agent` credential for this app) receives the message.
2. OpenClaw's LLM (user's chosen model, user's key) plans the action. Because our MCP server was installed, the LLM sees tools like `canvas.search({ type: "note", tag: "meeting", order: "recent", limit: 5 })` and `canvas.summarize({ itemIds })` in its tool list.
3. OpenClaw calls `canvas.search` → our Agent Gateway validates scope `canvas:search`, queries Postgres, returns 5 item summaries. Logged as an `AgentAction` of type `item.read` with the agent's id.
4. OpenClaw calls `canvas.summarize({ itemIds })` — our server uses the user's own BYOK key to generate a concise calendar-event description. Alternative: OpenClaw summarizes locally and only uses us for data.
5. OpenClaw pushes events to Google Calendar (that's its problem, not ours).
6. Optionally OpenClaw calls `canvas.add_tag({ itemIds, tag: "calendarized" })` on the same 5 notes. Agent Gateway checks `items:write`, mutates, logs the action with `before`/`after` so the user can one-click undo from the Settings → Agent Activity page.

Nothing in the above requires our app to know what WhatsApp is. That's what makes the surface composable.

## F. Safety, Observability, Trust

- **Attribution everywhere.** Every item shows an "edited by" avatar. Agent edits show the agent's name + vendor badge. A user should never wonder *who* made a change.
- **Per-agent undo.** "Undo everything OpenClaw did in the last hour" button. Uses the `AgentAction` journal.
- **Budget caps.** Per-provider monthly $ cap that short-circuits LLM calls once reached, with a setting to auto-downgrade to a cheaper model instead of failing.
- **Prompt-injection defence.** Bookmark content fetched via `/unfurl` is untrusted — never pass it verbatim into a tool-enabled LLM context. Strip to a canonical `{title, description, domain}` shape before it reaches any agent LLM.
- **Rate-limit per agent**, not just per IP. Use `agent:<agentId>` as the limiter key (different pool from human API traffic) so a rogue bot can't exhaust the user's human-side budget.
- **Scoped audit log** surfaced in the UI. The same `AgentAction` table powers "Agent Activity" in Settings.

## G. Mapping to the Existing Code

Minimally invasive integration points:

| Existing file | Change |
|---|---|
| `prisma/schema.prisma` | Add `Agent`, `AgentCredential`, `AgentAction`, `CanvasView`, `Suggestion`, `ItemEmbedding`, `UserProviderKey`, `AgentUsage`. |
| `src/lib/api/auth.ts` | Add `requireAgentAuth()` — parallel to `requireAuth()`, returns `{userId, agentId, scopes}`. |
| `src/app/api/agent/v1/**` | New route tree. Gets its own `withAgentHandler` wrapper (auth + scope + rate-limit + action-journal). |
| `src/lib/ai/**` | New module: providers, adapter, BYOK crypto, embeddings job, clustering. |
| `src/lib/mcp/**` | New module: MCP server glue. Can run in-process on the custom server already bootstrapping Next + WS in `server.ts`. |
| `src/app/(canvas)/[canvasId]/ai/**` | New AI Organizer tab. Reuses most of the existing Konva stage; swaps out the layout source. |
| `src/features/canvas/hooks/use-canvas-ai-handlers.ts` | Already exists. Extend it instead of writing new hooks from scratch — pipe it through the new provider adapter. |
| `src/lib/collaboration/websocket-server.ts` | Emit agent-originated changes via the same Y.js broadcast channel so live editors see bot edits in real time. |

**Do not** layer the Agent API on top of `/api/v1`. Keep it at `/api/agent/v1` so the two evolve independently.

## H. Rollout Order

Pragmatic, ship-something-every-two-weeks order:

1. **Fix the audit blockers in Part I first.** Shipping AI features on a broken rate-limiter is how you get a $30k OpenAI bill in a day.
2. **BYOK plumbing.** `UserProviderKey` table + encryption + settings UI for the user to paste keys for 3 providers. Zero AI features yet — just the key vault.
3. **Embeddings backfill.** pgvector, nightly job, `ItemEmbedding`. Unlocks semantic search for the next two milestones.
4. **AI Organizer tab v1 — read-only clusters.** User clicks "Re-cluster", backend runs k-means over embeddings + asks LLM for cluster names. Non-destructive `CanvasView` layout only. Ship.
5. **Suggestions flow.** Untagged-item tagger + duplicate detector. `Suggestion` table, tray UI with "Accept / Reject / Ignore".
6. **Agent Gateway v1 — read-only.** `Agent`, `AgentCredential`, `AgentAction`. `canvas:read` + `canvas:search` scopes only. MCP server + REST shim. First target: Claude Desktop + Cursor to dogfood, then invite OpenClaw.
7. **Agent Gateway v2 — writes.** `items:write`, `items:comment`, `suggestions:commit`. Full undo UI. Webhooks out. Public docs.
8. **More layouts.** Timeline, kanban, mind-map. Each is a `CanvasView.viewType` variant — minimal new infra once the foundation is there.
9. **Budget/usage surfacing.** Per-provider monthly spend chart, caps, alerts.
10. **Scheduled jobs per user.** Nightly re-cluster, proactive suggestions.

## I. Open Questions to Decide Before Writing Code

1. **Hosting of pgvector** — Neon supports it now; if you're staying on Vercel Postgres, double-check the `vector` extension is enabled in your plan.
2. **MCP transport** — WebSocket vs SSE vs stdio. For a web app, WSS is the natural fit; OpenClaw's docs will tell you what they consume.
3. **Per-user model cost ceiling** — hard-cap or soft-warn? Personal preference call.
4. **Privacy story** — are AI calls ever routed through our server using your key, or always client-side via a signed URL? Doing it server-side lets you rate-limit and log, but it means the key leaves the user's browser. Recommend server-side with a clear privacy disclosure.
5. **Team/workspace scoping for agents** — v1 scope is per-user only. Don't build multi-tenant agent permissions until users ask for them.
6. **Does the AI tab live at `/canvas/:id?view=ai`, `/canvas/:id/ai`, or a separate "Organizer" top-level tab?** Subpath is easier for routing and share URLs.
7. **Are agent edits allowed on *shared* canvases where the user is not the owner?** Default no — only on canvases the Agent's owner owns. Revisit when multi-user agents appear.

---

*This proposal is intentionally conservative about data mutation and aggressive about composability. The single biggest design bet is keeping the Agent Gateway separate from the human REST API; it costs a bit more code now and avoids a category of future pain where fixing a bot breaks the UI and vice versa.*

