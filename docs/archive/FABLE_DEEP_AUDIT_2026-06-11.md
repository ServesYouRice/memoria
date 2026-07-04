# FABLE.md — Deep Project Audit

**Project:** Memoria (Next.js 15 canvas/notes app with agents, collaboration, knowledge graph)
**Audit date:** 2026-06-11
**Scope:** Full repository — build/tooling configs, runtime & server, database layer, auth & security, API/agent layer, frontend, tests & CI/CD, dependencies.
**Method:** Manual code review of every load-bearing module plus verification commands run against the working tree.

### Verification evidence collected during the audit

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ Passes, zero errors |
| `npx prisma validate` | ⚠️ Valid, but 2 preview-feature warnings (see §4.1) |
| `.env` tracked in git? | ✅ No (untracked; `.env.example` present) |
| Build artifacts (`dist/`, `.next/`, `tsconfig.tsbuildinfo`) tracked? | ✅ No |
| `react-konva@18.2.14` peer range vs React 19.2 | ✅ Satisfied (`react >=18.0.0`) — but v19 line exists, see §7 |

---

## 1. Executive summary

The codebase is unusually disciplined for its size — RFC 7807 errors, ADR references, idempotency keys, SSRF protection with DNS resolution, argon2id everywhere, an audited agent change-set/rollback system. The fundamentals are good. The problems cluster in four areas:

1. **A contradictory deployment story** (Vercel serverless config *and* a custom WebSocket server that Vercel can never run) that silently breaks collaboration, rate limiting, and account lockout depending on where you deploy.
2. **Self-defeating rate limits** that will lock legitimate users out of their own sessions long before they stop an attacker.
3. **A pinned, vulnerable framework version** (`next@15.0.3`) with a known middleware-bypass CVE, plus a beta auth library in production.
4. **Drift through duplication** — two rate-limiter implementations, suggestion-execution logic written twice, scope-checking helpers re-implemented per route, MCP schemas declared but never enforced.

Nothing here is unsalvageable; most fixes are local. Section 8 gives a prioritized remediation order.

---

## 2. Blockers (will break production or CI)

### B1 — Vercel config vs. custom WebSocket server: pick one runtime
- [vercel.json](vercel.json) deploys the app as serverless Next.js. But realtime collaboration lives in [server.ts](server.ts) + [websocket-server.ts](src/lib/collaboration/websocket-server.ts), which only runs under `node scripts/start-server.mjs` (the Docker path). **On Vercel, the WebSocket server simply does not exist** — every `/api/collaboration/*` upgrade fails.
- Worse, the in-memory state that several subsystems silently fall back to (middleware rate-limit Map, account-lockout Map in [account-lockout.ts](src/lib/auth/account-lockout.ts), Y.Doc store in [yjs-provider.ts](src/lib/collaboration/yjs-provider.ts)) is per-lambda on Vercel — i.e., effectively disabled without any error.
- **Fix:** either delete `vercel.json` and commit to the Docker/self-host path, or split realtime into a separate service and make Redis-backed stores mandatory (env validation already requires `REDIS_URL` in production — the middleware limiter just doesn't use it, see B3).

### B2 — `next@15.0.3` is ~18 months old and carries known CVEs
- 15.0.3 predates **CVE-2025-29927** (middleware bypass via the `x-middleware-subrequest` header, fixed in 15.2.3). Everything [src/middleware.ts](src/middleware.ts) enforces — rate limiting, CORS, CSP, security headers — can be skipped by any client that sends that header.
- Several later 15.x advisories (image-optimizer and dev-server issues) are also unpatched at this version.
- The repo even has `@next/bundle-analyzer@^16.0.7` in devDependencies — a major version ahead of the framework it analyzes.
- **Fix:** upgrade to the latest 15.x (or 16). This is the single highest-leverage security change available.

### B3 — The app rate-limits itself to death
[src/lib/constants.ts](src/lib/constants.ts#L18-L36) + [src/middleware.ts](src/middleware.ts#L63-L79):
- `AUTH_RATE_LIMIT_MAX_REQUESTS = 5` per 15 minutes is applied to **everything under `/api/auth`**, which includes NextAuth's `/api/auth/session`, `/api/auth/csrf`, and `/api/auth/providers`. The app uses `SessionProvider` ([providers.tsx](src/app/providers.tsx#L83)) — session refetches alone will exhaust this budget, and all users behind one NAT/proxy share a single bucket (keyed by `x-forwarded-for`).
- `API_RATE_LIMIT_MAX_REQUESTS = 100` per 15 minutes for `/api/v1`, while the app's own collaborative polling is 5 s when active ([constants.ts:358](src/lib/constants.ts#L358)) → **180 requests/15 min from a single idle open tab.** One user with one canvas open exceeds the limit by design.
- **Fix:** exempt `/api/auth/session|csrf|providers` (limit only sign-in/callback POSTs), and raise the general API budget to match actual client behavior — or gate limits per-user instead of per-IP.

### B4 — CI pnpm version conflict
[package.json](package.json#L124) pins `"packageManager": "pnpm@8.15.0"`, while [ci.yml](.github/workflows/ci.yml#L22-L23) sets up **pnpm 9** via `pnpm/action-setup`. `pnpm/action-setup` errors out when its `version` input conflicts with the `packageManager` field ("Multiple versions of pnpm specified"). Even if resolved, a pnpm 8 lockfile and pnpm 9 resolution can diverge. Also: pnpm 8 is EOL.
- **Fix:** bump `packageManager` to a current pnpm 9/10 and remove the explicit `version` input from the action (it reads `packageManager` automatically).

### B5 — Bulk agent writes run inside a default-timeout interactive transaction
[service-core.ts](src/lib/agents/service-core.ts#L536-L650): `createCanvasItemBatchWrite` opens `prisma.$transaction(async tx => …)` and then, inside it:
1. snapshots the **entire canvas including all items and all comments** (`createCanvasCheckpointTx`, which also runs a redundant duplicate canvas query — `getOwnedCanvasTx` then `findFirst` again),
2. serializes that snapshot through `JSON.parse(JSON.stringify(...))`,
3. creates items **one-by-one in a loop** (`tx.canvasItem.create` per item).

Prisma interactive transactions default to a **5-second timeout**. On any non-trivial canvas this combination will start throwing `P2028` transaction-expired errors. Same loop pattern exists for the change records.
- **Fix:** use `createManyAndReturn` (Prisma ≥5.14, you're on 6), move checkpoint snapshotting out of the hot transaction, and set explicit `timeout`/`maxWait` for genuinely long transactions.

---

## 3. High-severity security findings

### S1 — CORS wildcard subdomain matching is bypassable, with credentials enabled
[cors.ts](src/middleware/cors.ts#L99-L105): `origin.endsWith(domain)` for `*.example.com` matches **`https://evilexample.com`** (no dot check). Combined with `Access-Control-Allow-Credentials: true` by default and origin reflection, any attacker who registers a suffix-matching domain gets credentialed cross-origin API access.
- **Fix:** `origin.endsWith("." + domain)` after parsing the origin's hostname (don't string-match scheme+port), or drop wildcard support.
- Related bug: `handleCorsPreflight` never returns `null`, so [middleware.ts:23-28](src/middleware.ts#L23-L28) short-circuits **every** OPTIONS request (route-level OPTIONS handlers are unreachable), and in production any OPTIONS without an `Origin` header gets a 403.

### S2 — WebSocket server has no Origin check → cross-site WebSocket hijacking
[websocket-server.ts](src/lib/collaboration/websocket-server.ts#L332-L478) authenticates upgrades purely via session cookies. Browsers attach cookies to cross-origin WebSocket handshakes and **CORS does not apply to WebSockets** — a malicious page can open `wss://your-host/api/collaboration/<canvasId>` with the victim's cookies and read/write canvas data (Yjs updates) silently.
- **Fix:** validate the `Origin` header against the allowed origins list during the upgrade, before `handleUpgrade`.

### S3 — Suggestion execution is not atomic → double execution of external webhooks
Both execution paths ([mcp.ts `executeApprovedSuggestion`](src/lib/agents/mcp.ts#L142-L318) and the duplicated logic in [actions/route.ts](src/app/api/agent/v1/actions/route.ts#L360-L591)) do: read suggestion → check `status === "APPROVED"` → perform the action (including **firing an external webhook**) → `markSuggestionExecuted` afterwards. Two concurrent requests both pass the check and both execute. `markSuggestionExecuted` already uses a conditional `updateMany` — it's just called too late.
- **Fix:** flip status first: `updateMany({ where: { status: APPROVED }, data: { status: EXECUTING } })`, check `count === 1`, then execute; revert on failure. Same TOCTOU exists in `revertChangeSet` ([service-core.ts:1400-1422](src/lib/agents/service-core.ts#L1400-L1422)) where the `revertedAt` guard is read *outside* the transaction → concurrent double-revert.

### S4 — Account lockout: trivially weaponizable, and racy
[account-lockout.ts](src/lib/auth/account-lockout.ts):
- Lockout keys on **email only** — anyone can lock any user out of their account with 5 wrong passwords (availability attack with zero auth). Consider per-IP+email composite counting, progressive delays, or CAPTCHA instead of hard lockout.
- The Redis path is read-modify-write JSON (`get` → `+1` → `setex`), not atomic `INCR` — concurrent failures undercount.
- The in-memory fallback silently engages when Redis is down, giving per-process (i.e., near-zero) protection.

### S5 — User enumeration via timing in `authorize`
[auth.ts](src/lib/auth.ts#L49-L66): when the user doesn't exist, the code returns immediately; when it exists, it runs an argon2 verify (~tens of ms). Classic timing oracle.
- **Fix:** verify against a static dummy hash on the missing-user path.

### S6 — Secrets-at-rest key management is fragile
[crypto.ts](src/lib/agents/crypto.ts#L9-L13): the AES-256-GCM key is `sha256(MODEL_CREDENTIAL_ENCRYPTION_KEY || AUTH_SECRET)`. `MODEL_CREDENTIAL_ENCRYPTION_KEY` is optional even in production ([env.ts:75](src/lib/env.ts#L75)) — so rotating `AUTH_SECRET` (a normal hygiene operation) **silently bricks every stored model credential and webhook signing secret**. There's no key-version byte in the payload, so rotation/migration is impossible after the fact.
- Also: the webhook **signing secret is stored inside the `replayCursor` JSON column** ([service-core.ts:369-380](src/lib/agents/service-core.ts#L369-L380)) — a cursor field doubling as a secrets vault is a trap for future maintainers.
- **Fix:** require the dedicated key in production, prepend a key-version to ciphertexts, move the signing secret to a dedicated column.

### S7 — Agent API surface has no rate limiting
[middleware.ts](src/middleware.ts#L98-L123) gates `/api/v1/**` only; **`/api/agent/v1/**` matches none of the prefixes** and gets no limiter at all. Integration-token auth runs an argon2id verify per request ([agents/auth.ts:131](src/lib/agents/auth.ts#L131), ~19 MB memory cost) — an unauthenticated attacker spraying invalid tokens with valid prefix/suffix shape gets free CPU/memory amplification.
- Also: `authenticateIntegrationToken` uses `findFirst` on prefix+suffix — a collision between two integrations makes the second one unverifiable (the ApiKey path in [api-key-auth.ts](src/lib/api/api-key-auth.ts#L82-L145) correctly iterates all matches; this one doesn't).

### S8 — Docker image leaks secrets and ships as root
[Dockerfile](Dockerfile) + **no `.dockerignore` exists**:
- `COPY . .` copies `.env` (real secrets), `.git`, `coverage/`, `.next/` and — on a host with installed deps — **the host `node_modules` over the freshly installed container ones** (Windows-built binaries like argon2 will then crash the Linux container).
- Single stage: devDependencies, source, and build cache all ship in the final image; runs as root; no `HEALTHCHECK`.
- **Fix:** add a `.dockerignore` (`.env*`, `.git`, `node_modules`, `.next`, `coverage`, `dist`), convert to multi-stage with `output: "standalone"` or a pruned prod install, add a non-root `USER`.

### S9 — Collaboration presence leaks emails; client-supplied fields trusted
- Presence payloads include every participant's **email address**, broadcast to all connections — including anonymous guests on public canvases ([websocket-server.ts:195-209](src/lib/collaboration/websocket-server.ts#L195-L209)).
- The Yjs persistence path ([yjs-provider.ts:221-304](src/lib/collaboration/yjs-provider.ts#L221-L304)) trusts `createdById`/`updatedById` and `content` straight from the client-replicated doc — no `parseCanvasItemContent` validation like the REST/agent write paths, and attribution is spoofable by any EDIT-level collaborator. Cursor `message.position` is also unvalidated and re-broadcast verbatim.

### S10 — CSP is nonce-based but the connect/img directives neutralize much of it
[csp.ts](src/middleware/csp.ts#L24-L26): `connect-src 'self' wss: https:` and `img-src ... https:` allow exfiltration to any HTTPS endpoint, which is most of what CSP would otherwise stop after script injection. `report-uri` is deprecated (add `report-to`). The nonce plumbing itself (middleware → `x-nonce` → layout → Emotion cache) is correctly implemented.

---

## 4. Correctness & robustness issues

1. **Prisma preview features are stale** (confirmed by `prisma validate`): `fullTextSearch` must become `fullTextSearchPostgres`, and `fullTextIndex` is deprecated/MySQL-oriented on a postgres datasource ([schema.prisma:1-4](prisma/schema.prisma#L1-L4)).
2. **Edge middleware bundles Node-flavored libs.** [middleware.ts](src/middleware.ts) imports the pino logger ([lib/logger](src/lib/logger/index.ts)) and logs *every request*. In the Edge sandbox pino resolves to its browser shim — different output format than server logs, redaction semantics differ, and each request allocates a child logger. Use a tiny edge-safe logger (or none) in middleware.
3. **In-memory edge rate-limit store never evicts** ([middleware/rate-limit.ts:27-38](src/middleware/rate-limit.ts#L27-L38)): keys are only cleaned when the *same* key recurs; unique IPs accumulate forever → unbounded memory growth on a long-lived custom server. It also trusts `x-forwarded-for` blindly — with the self-hosted server directly exposed, attackers rotate the header to dodge limits entirely.
4. **Pagination params are unguarded**: `parseInt(searchParams.get("offset") || "0")` with garbage input yields `NaN`, which Prisma rejects with a 500 ([canvases/route.ts:19-23](src/app/api/v1/canvases/route.ts#L19-L23), same pattern in agent routes). Clamp/validate with zod like the bodies are.
5. **`withTimeout` leaks timers and doesn't cancel the query** ([db.ts:178-189](src/lib/db.ts#L178-L189)) — no `clearTimeout` on success; the underlying query keeps running after "timeout".
6. **`process.exit(1)` on DB connect failure at module import** ([db.ts:130-140](src/lib/db.ts#L130-L140)) — acceptable for the custom server, hostile in serverless; gate it on the deployment target.
7. **Double validation/normalization everywhere in the agent layer**: routes call `normalizeAgentItemWriteBatch(...)` and then pass results to service functions that re-run the same normalization ([actions/route.ts:517](src/app/api/agent/v1/actions/route.ts#L517) → [service-core.ts:529](src/lib/agents/service-core.ts#L529)). Harmless today, but the duplicated `unknown`-typed seam invites drift.
8. **Webhook delivery reads unbounded response bodies** ([webhooks.ts:117](src/lib/agents/webhooks.ts#L117)) and stores them in `AgentAction.metadata` — a hostile endpoint returning gigabytes goes straight to memory and then to the DB. `safeFetch` in [ssrf-protection.ts](src/lib/utils/ssrf-protection.ts#L189-L304) already implements size-capped streaming — reuse it. Residual SSRF TOCTOU: DNS validated, then `fetch` re-resolves (rebinding window); pin the resolved IP or re-validate via a custom lookup.
9. **`logger` redaction paths are top-level only** ([logger/index.ts:62-74](src/lib/logger/index.ts#L62-L74)): `redact: ["password", "token", …]` does not match nested keys like `body.password`. Use wildcard paths (`*.password`, `req.body.password`).
10. **The "approved" NextAuth beta drift check lives in instrumentation** ([src/instrumentation.ts:19-59](src/instrumentation.ts#L19-L59)) — 40 lines of runtime version-string parsing that belongs in CI (a one-line lockfile assertion), not in the production boot path.

---

## 5. Performance & scalability

1. **Canvas list endpoints return base64 PNG thumbnails inline.** `Canvas.thumbnail` is a base64 `@db.Text` column, and `GET /api/v1/canvases` does `findMany` with no `select` ([canvases/route.ts:31-38](src/app/api/v1/canvases/route.ts#L31-L38)) — 50 canvases × ~100 KB thumbnail = multi-MB dashboard payloads and bloated Postgres pages/cache. Move thumbnails to object storage (S3 is already wired up) or at minimum `select` them out of list queries.
2. **`toJsonValue` = `JSON.parse(JSON.stringify(x))` on every agent write** ([service-core.ts:28-30](src/lib/agents/service-core.ts#L28-L30)) — full double serialization of items, snapshots, and change records; Prisma serializes again on write. For checkpoint snapshots of large canvases this triples the work inside a transaction (see B5).
3. **Unbounded queries:** `listScopedCanvasItems` returns *all* items with no pagination ([query-core.ts:150-163](src/lib/agents/query-core.ts#L150-L163)); `listScopedKnowledgeEntities` eagerly includes both relation directions with nested entities. Fine at 100 items, painful at 10 000.
4. **`ItemEmbedding.vector` stored as JSON** ([schema.prisma:702-715](prisma/schema.prisma#L702-L715)) — embeddings in a JSON column can't be indexed or similarity-searched; any vector search will be a full-table scan + in-app math. There's even a `scripts/vector-check.mjs` — adopt pgvector.
5. **`headers()` in the root layout** (for the CSP nonce, [layout.tsx:38](src/app/layout.tsx#L38)) makes **every page dynamically rendered** — no static optimization anywhere. That's the documented cost of nonce-based CSP; consider hash-based CSP for static-heavy pages if TTFB matters.
6. **`count()` + `findMany()` run sequentially** in list endpoints — `Promise.all` them, or skip exact counts in favor of `hasMore` (the agent routes already do the latter).
7. **Per-request awaited bookkeeping writes:** integration auth awaits a `lastSeenAt` update on every request ([agents/auth.ts:136-139](src/lib/agents/auth.ts#L136-L139)) — fire-and-forget or throttle it (the ApiKey path already fire-and-forgets correctly).
8. **Frontend:** `itemsById` Map and all filter arrays rebuilt every render with no `useMemo` ([CanvasOrganizerView.tsx:340](src/features/canvas/components/CanvasOrganizerView.tsx#L340)); every filter dropdown change fires an immediate `saveCanvasView` POST (no debounce); the timeline query refetches 100 records to display 8. Redundant duplicated indexes in the schema (`@@index([shareToken])` next to `@unique shareToken`; `@@index([key])` next to `@unique key`) waste write throughput.
9. **Cursor broadcasting is chatty:** every cursor move re-broadcasts the *entire* cursor list to every client and republishes to Redis ([websocket-server.ts:634-637](src/lib/collaboration/websocket-server.ts#L634-L637)). Throttle to animation-frame cadence and send deltas.

---

## 6. Best practices & modern patterns not respected

### Dependencies ([package.json](package.json))
| Issue | Detail |
|---|---|
| `next-auth@5.0.0-beta.25` | Beta auth in production, pinned ~14 months. Auth.js v5 stable shipped; migrate. |
| `eslint@8` + `.eslintrc.cjs` | ESLint 8 is EOL; flat config is the standard. `@eslint/eslintrc` is installed but unused for migration. |
| `@typescript-eslint/no-explicit-any: "off"` | Combined with `as any` casts in [route-handler.ts](src/lib/api/route-handler.ts) (`RouteContext = … \| any`), it erases the benefit of `strict: true`. |
| `@types/ioredis`, `@types/jspdf` | Deprecated stub packages — both libraries ship their own types. Remove. |
| `@types/ws` in `dependencies` | Type packages belong in `devDependencies`. |
| `zod@3`, `@mui/material@6`, `vitest@2` | All one major behind (zod 4 / MUI 7 / vitest 3). Not urgent, but the gap is widening. |
| `@next/bundle-analyzer@16` vs `next@15.0.3` | Major-version mismatch with the framework. |

### Architecture & code organization
- **Two parallel rate-limiter implementations**: the edge in-memory one ([src/middleware/rate-limit.ts](src/middleware/rate-limit.ts)) and a full Redis-backed framework ([src/lib/rate-limit/](src/lib/rate-limit/)) that the middleware never uses. The Redis stores exist precisely to fix the problems the middleware version has.
- **Suggestion-execution logic exists twice** — ~250 lines in [actions/route.ts](src/app/api/agent/v1/actions/route.ts) duplicating [mcp.ts `executeApprovedSuggestion`](src/lib/agents/mcp.ts#L142-L318), with *different* validation rigor (zod in the route, `String(x || "")` coercion in MCP). They will drift. Extract one `executeSuggestion(actor, suggestion)` service.
- **MCP tool schemas are declared but never enforced**: [mcp-schema.ts](src/lib/agents/mcp-schema.ts) advertises input schemas via `tools/list`, while [executeMcpTool](src/lib/agents/mcp.ts#L320-L798) hand-parses args in a 480-line switch. Validate `params.arguments` against the same zod schemas that generate the advertised JSON schema, and replace the switch with a tool-registry map (`name → {schema, handler, requiredRung}`).
- **Scope helpers re-implemented per route**: [actions/route.ts](src/app/api/agent/v1/actions/route.ts#L57-L91) re-implements `verifyCanvasOwnership`/`getItemCanvasScope` that already exist in [query-core.ts](src/lib/agents/query-core.ts).
- **Dead/vestigial schema**: `SavedView` is explicitly deprecated-but-kept; the `Session` model is unused under `strategy: "jwt"`; `CanvasShare` is keyed by email rather than user id (renamed emails silently lose access; invited-then-registered users work by string match only).
- **Stale branding**: RFC 7807 `type` URIs point at `https://canvascollect.com/...` and docker-compose mixes `memoria-app` with `canvascollect-postgres` container names.
- **Root [instrumentation.ts](instrumentation.ts) re-exports [src/instrumentation.ts](src/instrumentation.ts)** "so Next can resolve either location" — Next resolves exactly one (the `src/` one when `src/` exists); the root file is dead code that invites editing the wrong file.
- **tsconfig**: redundant path aliases (`@/*` already covers the six specific ones); `e2e/` is not excluded while `tests/` is; `allowJs: true` with no JS sources.

### Testing & CI ([ci.yml](.github/workflows/ci.yml), [vitest.config.ts](vitest.config.ts), [playwright.config.ts](playwright.config.ts))
- Coverage is collected but **no thresholds** are configured — coverage can silently collapse.
- Playwright's `webServer.command` is **`npm run dev`** in a pnpm repo, so E2E runs against the dev server (slow first-compile flakiness, dev-only behavior); CI's separate `build` job output is discarded — nothing E2E-tests the production build.
- The `ci` package script includes `pnpm audit`, but the GitHub workflow never runs it — no dependency-vulnerability gate in CI.
- CI defines `env.NODE_VERSION`/`PNPM_VERSION` then hardcodes the numbers in every step anyway.
- `docker-compose.yml` uses the obsolete `version: '3.8'` key and bakes default MinIO credentials (`minioadmin/minioadmin123`) as fallbacks.

### Frontend
- Module-level `QueryClient` in a client component ([providers.tsx:32](src/app/providers.tsx#L32)) — the App Router-recommended pattern is `useState(() => new QueryClient())` to avoid cross-request sharing during SSR.
- Hardcoded hex colors and gradients throughout [CanvasOrganizerView.tsx](src/features/canvas/components/CanvasOrganizerView.tsx) (`bgcolor: "#eef2f8"`, inline `linear-gradient(...)`) despite a theme system with dark-mode support — these panels won't respond to mode changes.
- `react-konva@18` works against React 19 by peer range, but the v19 line exists specifically for React 19 reconciler changes; upgrade alongside the Next bump.

---

## 7. What's genuinely good (keep doing this)

- **Env validation** ([env.ts](src/lib/env.ts)) with zod + cross-field `superRefine` (S3/SMTP/production invariants) and legacy alias handling — exemplary.
- **SSRF protection** with DNS resolution, manual redirect re-validation, and size-capped streaming reads ([ssrf-protection.ts](src/lib/utils/ssrf-protection.ts)).
- **Idempotency-key handling** with replay responses and race-aware unique-constraint fallback ([route-handler.ts:212-300](src/lib/api/route-handler.ts#L212-L300)).
- **Agent capability rungs + change-set/rollback audit trail** — a thoughtfully designed authorization ladder with reversible writes.
- **API keys and integration tokens stored as argon2id hashes** with prefix/suffix lookup columns and transparent legacy upgrade.
- **CSP nonce plumbing through to the Emotion cache** — most teams give up and ship `unsafe-inline`.
- TypeScript strict mode passes cleanly; `.env` and build artifacts are correctly untracked.

---

## 8. Prioritized remediation plan

| # | Action | Effort | Fixes |
|---|---|---|---|
| 1 | Upgrade Next.js to latest 15.x (then 16), align `@next/bundle-analyzer` | M | B2 |
| 2 | Decide deployment target; if self-host: delete `vercel.json`, make middleware limiter Redis-backed (reuse `src/lib/rate-limit`), keep custom server | M | B1, B3-infra |
| 3 | Fix rate-limit budgets: exempt session/csrf endpoints, raise `/api/v1` budget, add `/api/agent/v1` limits, add store eviction | S | B3, S7, §4.3 |
| 4 | Fix CORS wildcard dot-check + preflight null-return; add WS Origin validation | S | S1, S2 |
| 5 | Make suggestion execution & change-set revert atomic (status flip first) | S | S3 |
| 6 | Align CI pnpm with `packageManager`; add audit step + coverage thresholds | S | B4, §6-CI |
| 7 | Add `.dockerignore`, multi-stage Dockerfile, non-root user | S | S8 |
| 8 | Batch-write fixes: `createManyAndReturn`, checkpoint outside tx, explicit tx timeout | M | B5, §5.2 |
| 9 | Require `MODEL_CREDENTIAL_ENCRYPTION_KEY` in prod; version ciphertexts; move signing secret out of `replayCursor` | M | S6 |
| 10 | Lockout redesign (atomic INCR, per-IP component); dummy-hash timing fix | S | S4, S5 |
| 11 | Strip thumbnails from list queries / move to S3 | S | §5.1 |
| 12 | Deduplicate: one suggestion-execution service, one rate limiter, MCP registry with enforced schemas | L | §6-arch |
| 13 | Migrate next-auth beta → Auth.js stable; ESLint 8 → 9 flat config; re-enable `no-explicit-any` | L | §6-deps |
| 14 | Prisma: rename preview features, drop duplicate indexes, plan pgvector for embeddings | M | §4.1, §5.4 |

**Severity legend:** B# = blocker · S# = high-severity security · §-refs = supporting detail above.
