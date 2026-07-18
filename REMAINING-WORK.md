# Remaining work

**Consolidated from:** `audits-notes/` (deep audit, commit `e40dc83`, 2026-07-12) and the
superseded `audits-fable/` predecessor (2026-07-04). Both folders were removed after this
merge; their full original prose remains in git history.

**Re-verified against:** branch `chore/security-hardening-and-uploads` @ `f30b4c6`
("security hardening, private uploads, and pagination"), on 2026-07-17.

This file is a single ledger of all 178 audit findings with a **current status** column set
from reading the code on this branch. It supersedes the per-domain audit documents.

### Status legend
- ✅ **Fixed** — verified resolved in current code
- ◑ **Partial** — materially improved; residual work noted
- ☐ **Open** — verified still present, or untouched by the hardening pass
- ⊘ **Moot** — no longer applicable (feature/code path removed)
- ❔ **Re-verify** — carried over from the audit; not re-checked against current code (the
  owning file was often rewritten this pass, so status is genuinely unknown)

---

## 1. Release gates — headline status

| Gate | Status | Note |
|---|---|---|
| SEC-01 cross-tenant Yjs write | ✅ | `yjs-provider.ts` deleted; server no longer persists items |
| SEC-08 service-worker data cache | ✅ | `public/sw.js` rewritten (public assets only, legacy cache purged) |
| SEC-09 upload authorization | ✅ | Authorized proxy `uploads/[assetId]/route.ts` + private storage + delete lifecycle |
| SEC-10 / SEC-11 webhook SSRF / origin escape | ✅ | Manual redirect + per-hop revalidation; single-slash path guard |
| COR-01 duplicate agent execution | ✅ | Atomic `claimSuggestionForExecution` |
| SEC-16 rate-limit bypass | ✅ | Trusted `x-memoria-client-ip` (set in `server.ts`) + Redis store + per-prefix |
| SEC-19 recovery-token leakage | ✅ | `console` email provider forbidden in production (env + runtime) |
| COR-02 collaboration not wired | ✅ | Unsafe write path removed; now presence/cursors only (real-time items still not a feature) |
| COR-03 duplicate client mutations | ✅ | `mutations: { retry: false }` |
| **OPS-01 vulnerable runtime graph** | ✅ | Next 16.2.10; `jspdf`→4.2.1; `effect`/`postcss` pinned via pnpm overrides — `pnpm audit --prod` clean; CI gate GREEN |
| **OPS-02 / 03 / 04 self-host path** | ✅ | Multi-stage non-root image + `.dockerignore`; `setup.mjs` rejects placeholder secrets & generates real ones; self-host requires HTTPS `MEMORIA_PUBLIC_URL` (verified 2026-07-18) |
| **TST-01 / 03 release evidence** | ◑ | Coverage threshold gate **added** (TST-01 ✅); E2E still not re-verified |

**Blocking status for the P0 set:**
1. ~~**OPS-01**~~ — ✅ **Closed 2026-07-18.** `jspdf`→4.2.1 (clears 2 critical + 6 high), `effect`→≥3.20.0 and `postcss`→≥8.5.10 via `pnpm-workspace.yaml` overrides. `pnpm audit --prod` reports **no known vulnerabilities**; the CI `dependency-audit` gate exits 0.
2. ~~**OPS-02/03/04 + coverage gate**~~ — ✅ **Closed 2026-07-18.** Multi-stage non-root Docker image + `.dockerignore`; `setup.mjs` detects/rejects placeholder secrets and generates real ones; self-host requires an external HTTPS origin. Coverage threshold gate added to `vitest.config.ts` (TST-01). Remaining self-host nicety: a clean-clone Docker build job in CI (TST-15).

---

## 2. Security & privacy (SEC)

| ID | Sev | Status | Finding / remaining action |
|---|---|---|---|
| SEC-01 | Crit | ✅ | Cross-tenant Yjs overwrite/delete — persistence layer removed |
| SEC-02 | High | ⊘ | Yjs bypassed content/geometry/attribution validation — path removed; **re-add validation if Yjs persistence returns** |
| SEC-03 | High | ◑ | WS authz: `sessionVersion` now attached + rechecked, but revoking a share / role change does not close/downgrade **live** sockets |
| SEC-04 | High | ❔ | WS `maxPayload`, per-message schema/byte caps, anonymous-connection DoS — re-verify `websocket-server.ts` |
| SEC-05 | High | ✅ | Presence payloads now emit `userId/name/color/accessLevel` only (no email) |
| SEC-06 | High | ❔ | `includeDeleted=true` retrievable by VIEW collaborators — re-verify canvas-items route |
| SEC-07 | High | ❔ | Canvas owner can silently rewrite another user's comment — re-verify |
| SEC-08 | Crit | ✅ | Service worker caches only public immutable assets; legacy cache purged |
| SEC-09 | Crit | ✅ | Private storage + authorized read proxy + OWNER delete + `private, no-store` |
| SEC-10 | Crit | ✅ | `redirect:"manual"` + per-hop `validateUrlForSsrfWithDns` + hop cap |
| SEC-11 | High | ✅ | Path must start with single `/`; re-validated with `validateUrlForSsrf` |
| SEC-12 | High | ◑ | Response now 64 KB bounded; **still open:** redact/encrypt persisted webhook metadata, downstream idempotency key/outbox |
| SEC-13 | Med | ✅ | CORS parses `new URL(origin)` + `hostname.endsWith('.'+domain)` |
| SEC-14 | Med | ✅ | CSP-report endpoint: Zod schema + 16 KB cap |
| SEC-15 | Med | ◑ | `agentRateLimit` defined; **verify** pre-Argon2 limiting for API/integration tokens |
| SEC-16 | High | ✅ | Trusted connection IP + Redis-backed limiter + per-prefix budgets |
| SEC-17 | High | ✅ | Atomic Redis Lua lockout script |
| SEC-18 | High | ✅ | `sessionVersion` in JWT + migration + per-request compare |
| SEC-19 | High | ✅ | `console` provider rejected in production (env validation + runtime guard) |
| SEC-20 | High | ◑ | Reset revokes sessions (via sessionVersion); **verify** token is hashed-at-rest + atomic single-use consume |
| SEC-21 | High | ✅ | Search logs `queryLength` only; blanket `middleware.ts` URL logging removed |
| SEC-22 | High | ✅ | `doctor.mjs` prints only `Configured`/`Missing` for secrets and `redactedConnectionTarget()` (host:port) for DB/Redis; `validate-env.mjs` errors use Zod `format()` (paths+messages, no values) (verified 2026-07-18) |
| SEC-23 | High | ✅ | Account deletion is one `$transaction`, reassigns cross-owner items, purges tokens/keys/shares/sessions/assets |
| SEC-24 | High | ✅ | `crypto.ts` now uses a dedicated **versioned** key: ciphertext tagged `v1.…` for future rotation; `AUTH_SECRET` fallback throws in production (only dev/test). Legacy unversioned payloads still decrypt. Covered by `tests/unit/agent-crypto.test.ts` (2026-07-18) |
| SEC-25 | Med | ✅ | Health returns coded errors (`redis_unavailable`), not raw `error.message` |
| SEC-26 | High | ✅ | Login requires `emailVerified` in production |
| SEC-27 | High | ◑ | `env.ts` tightened; **verify** bootstrap secret is real, constant-time compared, one-use |
| SEC-28 | High | ◑ | `agentRateLimit` exists; **verify** it is actually applied to `/api/agent/*` (no global middleware file remains) |
| SEC-29 | Med | ❔ | Unknown WS upgrade paths should be explicitly destroyed — re-verify |

---

## 3. Correctness & data integrity (COR)

| ID | Sev | Status | Finding / remaining action |
|---|---|---|---|
| COR-01 | Crit | ✅ | Atomic APPROVED→EXECUTING claim before side effects |
| COR-02 | High | ✅ | Unsafe Yjs write authority removed; scope the feature claim to presence/cursors |
| COR-03 | High | ✅ | Global mutation retry disabled (`retry:false`) |
| COR-04 | High | ❔ | Pan state uncontrolled / conflicts with selection (`CanvasBoard` heavily changed — re-verify) |
| COR-05 | High | ❔ | Zoom/pan loaded but never saved |
| COR-06 | High | ⊘ | REST/Yjs stale-snapshot overwrite — Yjs persistence removed |
| COR-07 | High | ❔ | Version restore ABA / legacy hard-delete (restore route changed — re-verify) |
| COR-08 | High | ❔ | Template "use" is a non-atomic two-step create (route changed — re-verify) |
| COR-09 | High | ❔ | Standard registration doesn't create Personal/Inbox that ingest needs |
| COR-10 | High | ❔ | `logActivity` has no producers; feed stays empty |
| COR-11 | High | ❔ | Canvas UI ignores viewer/comment/edit role |
| COR-12 | High | ❔ | Shared editors trigger owner-only thumbnail writes |
| COR-13 | High | ✅ | Account deletion handles collaborator-created items (reassign to canvas owner) |
| COR-14 | High | ❔ | Bookmark refresh breaks optimistic concurrency (cron route rewritten — re-verify) |
| COR-15 | Med | ❔ | Bookmark refresh discards metadata unless title changed |
| COR-16 | Med | ❔ | Failed bookmarks can starve refresh queue (needs backoff/attempts) |
| COR-17 | Med | ❔ | Refresh includes soft-deleted rows + unbounded history |
| COR-18 | Med | ✅ | Shared `parsePagination` rejects NaN/negative (bounded int coercion) |
| COR-19 | Med | ◑ | Pagination helper added; **verify** Dashboard exposes next-page/infinite load |
| COR-20 | Med | ❔ | Comments stop at first page (UI load-more) |
| COR-21 | Med | ❔ | Workspace-filtered "New canvas" creates unassigned canvas |
| COR-22 | Med | ❔ | Workspace deletion not atomic with unassignment (route changed — re-verify) |
| COR-23 | Med | ◑ | Revocation doesn't end live chat/reaction access — tied to SEC-03 |
| COR-24 | Med | ❔ | Thumbnail endpoint accepts unbounded data URLs |
| COR-25 | Med | ❔ | Template update fields uncapped |
| COR-26 | Low | ❔ | `Canvas.itemCount` unmaintained denormalized field |
| COR-27 | Med | ❔ | Serendipity can return soft-deleted items |
| COR-28 | Med | ❔ | AI summary includes soft-deleted items |
| COR-29 | Med | ❔ | Idempotency replays not bound to request-body hash |
| COR-30 | Med | ◑ | Idempotency rows purged on account delete; **still need** scheduled retention cleanup |
| COR-31 | Med | ❔ | Idempotency metadata persistence can turn success into 500 |
| COR-32 | Low | ❔ | Canvas view PUT labeled VIEW despite being a write |

---

## 4. Deployment, operations & supply chain (OPS)

| ID | Sev | Status | Finding / remaining action |
|---|---|---|---|
| OPS-01 | Crit | ✅ | Next 15→16; `jspdf`→4.2.1, `effect`/`postcss` pinned via overrides; `pnpm audit --prod` clean, CI gate green (2026-07-18) |
| OPS-02 | Crit | ✅ | Multi-stage `Dockerfile` (build→runtime) with hermetic non-secret build args; `.dockerignore` present |
| OPS-03 | Crit | ✅ | `setup.mjs` `usableSecret()` rejects `replace-me/devpassword/minioadmin` placeholders + min-length; generates `randomSecret()` for all secrets |
| OPS-04 | Crit | ✅ | Self-host requires HTTPS `MEMORIA_PUBLIC_URL`; `AUTH_URL`/`NEXTAUTH_URL` set from it; container DNS only for infra URLs |
| OPS-05 | High | ✅ | `waitForInfrastructure(..., fromHost=true)` waits on `127.0.0.1:5432/6379/9000` from host |
| OPS-06 | High | ◑ | Compose now passes email/upload-scan/sentry/log/cron vars; **verify** parity against full `env.ts` schema |
| OPS-07 | High | ✅ | `db:migrate` runs both in image `CMD` and as a gated `compose exec app pnpm db:migrate` release step in `setup.mjs` |
| OPS-08 | High | ✅ | `server.ts` handles SIGTERM/SIGINT: closes WS clients (1001) + HTTP server, 20 s deadline. `start-server.mjs` imports in-process and Dockerfile `CMD` uses `exec node`, so the server is PID 1 |
| OPS-09 | High | ✅ | No weak defaults: DB/Redis/MinIO passwords are required env (`${VAR}` w/o fallback), Redis `--requirepass`, all ports bound to `127.0.0.1` |
| OPS-10 | High | ✅ | Doctor no longer logs secrets — redacted output verified (= SEC-22) |
| OPS-11 | High | ✅ | Recovery email: console forbidden in prod; provider required (= SEC-19) |
| OPS-12 | High | ✅ | `scripts/scheduler.mjs` shipped + compose service for cron |
| OPS-13 | High | ◑ | Health probes DB+Redis (3 s timeout, coded errors) + real memory; `/api/metrics` emits real process CPU/heap/uptime (no hardcoded zeros). **Residual:** no storage(S3)/migration-status probe |
| OPS-14 | High | ❔ | No backup/restore/retention workflow |
| OPS-15 | High | ❔ | Divergent env schemas / mandatory optional keys (env changed — re-verify) |
| OPS-16 | Med | ❔ | Build fetches live Google Fonts (hermetic build) |
| OPS-17 | Med | ✅ | Compose Postgres is `pgvector/pgvector:pg16` (pgvector available for doctor check) |
| OPS-18 | Med | ❔ | Stale Prisma FTS preview flags (schema changed — re-verify) |
| OPS-19 | High | ✅ | Multi-stage image; runtime stage runs as non-root `memoria` user after `pnpm prune --prod`; `read_only` rootfs + tmpfs in compose |
| OPS-20 | Med | ✅ | `.dockerignore` present (excludes `.git`, `.env*`, `node_modules`, `.next`, `dist`, audits, coverage, test artifacts) |
| OPS-21 | Med | ◑ | Migrations now committed/tracked; **verify** `.gitignore` no longer ignores `prisma/migrations` + add CI schema-diff |
| OPS-22 | Low | ❔ | Committed `.pnpm-store/*/index.db` |
| OPS-23 | Med | ❔ | Node/pnpm version drift across Docker/CI/local (CI changed — re-verify) |
| OPS-24 | Med | ❔ | Sentry/OpenTelemetry dynamic-require build warning |
| OPS-25 | Med | ❔ | Setup mutates infra before validating deploy choices |
| OPS-26 | Med | ◑ | SW now `memoria-public-v2`; **verify** metrics/db/container/User-Agent brand names |
| OPS-27 | Med | ❔ | `check-bundle` is a false gate (App Router/Windows misclassification; `analyze-bundle.mjs` changed — re-verify) |
| OPS-28 | Med | ❔ | Bundle check not part of build/CI |

---

## 5. Performance & scalability (PERF)

| ID | Sev | Status | Finding / remaining action |
|---|---|---|---|
| PERF-01 | High | ❔ | Canvas open downloads items via 3 paths (`use-canvas-data` changed — re-verify) |
| PERF-02 | High | ❔ | Version history is unbounded O(items × versions) on page load |
| PERF-03 | High | ❔ | Non-viewport item load serially drains pages (infinite-loop guard) |
| PERF-04 | High | ❔ | Implemented viewport path not used by main canvas |
| PERF-05 | High | ❔ | List/cache payloads include base64 thumbnails + full rows |
| PERF-06 | High | ❔ | Thumbnail regenerated after every item-array change |
| PERF-07 | High | ✅ | Real FTS migration: `searchVector` generated column + GIN indexes committed |
| PERF-08 | High | ❔ | Upload quota is O(objects) via `ListObjectsV2` per upload |
| PERF-09 | High | ◑ | AI prompt inputs now bounded (`max` in `validation/ai.ts`); **still need** per-user/workspace quota + concurrency |
| PERF-10 | High | ❔ | `CanvasBoard` broad-rerender hotspot (changed — re-verify) |
| PERF-11 | Med | ❔ | Public share ships heavy interactive bundle |
| PERF-12 | Med | ❔ | Dashboard eagerly aggregates management surfaces |
| PERF-13 | Med | ❔ | Template listing returns every item |
| PERF-14 | Med | ◑ | Pagination infra added; **verify** search UI consumes it + cancels stale requests |
| PERF-15 | Med | ✅/❔ | Search no longer logs raw query (privacy); count-cost optimization still optional |
| PERF-16 | Med | ❔ | Connections endpoint returns all edges |
| PERF-17 | Med | ◑ | Bookmark refresh moved to scheduler; **verify** bounded concurrency/deadline |
| PERF-18 | Med | ❔ | Redis presence has no TTL/heartbeat per remote instance |
| PERF-19 | Med | ❔ | Every integration-token request writes `lastSeenAt` |
| PERF-20 | Med | ❔ | Agent pagination uses offset + malformed parsing |
| PERF-21 | Med | ❔ | Canvas detail does extra share query after cache lookup |
| PERF-22 | Low | ❔ | Unused DB retry/timeout helpers leak timers |
| PERF-23 | Med | ❔ | Restore does sequential upserts in one long transaction |
| PERF-24 | Med | ❔ | Large images decoded/buffered multiple times |
| PERF-25 | Med | ❔ | Geometry SQL predicates may not use positional index |
| PERF-26 | Med | ❔ | No load/perf tests for the infinite-canvas use case |

---

## 6. UI, UX & accessibility (UX)

| ID | Sev | Status | Finding / remaining action |
|---|---|---|---|
| UX-01 | High | ❔ | Presentation Mode is a visible no-op |
| UX-02 | High | ❔ | Copy advertises a clipboard format Paste ignores |
| UX-03 | High | ❔ | Undo/redo narrow + broken for delete |
| UX-04 | High | ❔ | Pan/selection state unreliable (= COR-04) |
| UX-05 | High | ❔ | Shared-canvas controls don't reflect role (= COR-11) |
| UX-06 | High | ❔ | Canvas inaccessible to keyboard/screen-reader |
| UX-07 | High | ❔ | `CanvasHeader` can't fit its feature set responsively (changed — re-verify) |
| UX-08 | High | ❔ | AR repeatedly reacquires/stops camera stream (`ARCanvasLayer` changed — re-verify) |
| UX-09 | Med | ❔ | Drawing color swatch handler is an empty placeholder |
| UX-10 | Med | ❔ | Embed items are placeholders, not embeds |
| UX-11 | Med | ❔ | "Whisper Mode" is text entry, not voice |
| UX-12 | Med | ◑ | AI input bounded, but `OPENAI_API_KEY \|\| "dummy-key"` fallback may still emit simulated prose — disable/guard in prod |
| UX-13 | Med | ❔ | OAuth buttons rendered permanently disabled |
| UX-14 | Med | ❔ | Meeting timer local-only in a collaborative header |
| UX-15 | Med | ❔ | Autopilot can leave a partial layout |
| UX-16 | High | ❔ | Icon-only controls lack accessible names |
| UX-17 | Med | ❔ | Canvas rename is pointer-only text |
| UX-18 | Med | ❔ | Drawing color neither keyboard-operable nor semantic |
| UX-19 | Med | ❔ | Native `confirm`/`prompt` disrupt focus |
| UX-20 | Med | ❔ | Quick overlays lack dialog semantics/focus containment |
| UX-21 | Med | ❔ | Dark mode stops at a hardcoded light canvas |
| UX-22 | Med | ❔ | Fixed viewport/header assumptions hurt mobile/zoom |
| UX-23 | Med | ❔ | Reduced-motion behavior undefined |
| UX-24 | High | ❔ | Item-load failure looks like an empty canvas |
| UX-25 | Med | ❔ | Canvas error Retry refetches metadata only |
| UX-26 | Med | ❔ | Login hides lockout/retry guidance |
| UX-27 | Med | ❔ | Search opens canvas but not the matching item |
| UX-28 | Med | ❔ | Search dialog ignores non-OK responses |
| UX-29 | Med | ◑ | Pagination infra added; **verify** load-more surfaced on canvases/comments/templates/activities |
| UX-30 | Med | ❔ | Public share panning uncontrolled |
| UX-31 | Med | ✅ | Share route has `robots: noindex,nofollow,nocache` layout |
| UX-32 | Med | ❔ | Public share API overreturns internal item fields |
| UX-33 | Med | ❔ | Dashboard/Search Suspense boundaries have no fallback |
| UX-34 | Low | ❔ | Browser clipboard failure unhandled |
| UX-35 | Med | ❔ | Soft delete has no trash/recovery surface |

**Product page gaps (carry over):** offline/fallback page, privacy/terms/data-export, onboarding/status page, invite-acceptance workflow for email shares, in-app help/shortcuts surface.

---

## 7. Testing, maintainability & refactoring (TST / MNT)

| ID | Sev | Status | Finding / remaining action |
|---|---|---|---|
| TST-01 | High | ✅ | `vitest.config.ts` now enforces `coverage.thresholds` (lines/statements 8, functions 28, branches 50) — non-regression floor; ratchet up as TST-02 coverage lands (2026-07-18) |
| TST-02 | High | ❔ | Critical paths (collab, SW, AI, uploads, agent core, middleware) lacked behavioral coverage — re-verify new tests |
| TST-03 | High | ❔ | E2E used stale routes + fake auth (`playwright.config` changed — re-verify) |
| TST-04 | High | ❔ | Root `e2e/` security/observability specs orphaned |
| TST-05 | High | ❔ | Many E2E cases pass without testing behavior |
| TST-06 | Med | ❔ | E2E state/order unsafe under `fullyParallel` |
| TST-07 | High | ❔ | CI E2E lacks Redis/MinIO services |
| TST-08 | Med | ❔ | Visual tests normally all skipped |
| TST-09 | Med | ❔ | Unit output includes full recovery URLs |
| TST-10 | Med | ❔ | Coverage includes generated noise, excludes E2E value |
| TST-11 | Med | ❔ | No DB integration suite for constraints/transactions |
| TST-12 | Med | ❔ | No concurrency/multi-instance suite |
| TST-13 | Med | ❔ | No service-worker test harness |
| TST-14 | Med | ❔ | No a11y automation/manual protocol in CI |
| TST-15 | Med | ❔ | No clean-clone self-host smoke test |
| TST-16 | Med | ❔ | No dependency-update automation / SBOM / license gate |
| MNT-01 | — | ◑ | Hotspots: `websocket-server` slimmed (−138), `yjs-provider` removed; `service-core.ts` (~1.3k) + `CanvasBoard` still oversized |
| MNT-02 | — | ❔ | Parallel unused canvas architecture (dead `src/lib/canvas/*`, unused hooks) |
| MNT-03 | — | ❔ | Fragmented test setup files |
| MNT-04 | — | ❔ | Scripts/migrations excluded from lint/type checks |
| MNT-05 | — | ❔ | Boundary typing falls back to `any` (esp. WS `handleMessage`) |
| MNT-06 | — | ❔ | Inconsistent error/route-handler patterns + correlation-id header |
| MNT-07 | — | ◑ | Docs vs code drift; some claims corrected (email/SW), others (real-time items, shortcuts) remain |
| MNT-08 | Med | ❔ | `SavedView` + legacy brand names remain |
| MNT-09 | Med | ❔ | `FIXED: Issue #…` comments used as assurance |
| MNT-10 | Low | ❔ | Build/test warnings normalized |
| MNT-11 | Med | ◑ | Framework pin refreshed (Next 16); adopt deliberate update cadence/matrix |
| MNT-12 | Med | ✅ | This ledger keeps stable IDs + status/owner fields (supersedes stale reports) |

---

## 8. Suggested order of attack

1. **Close OPS-01:** bump `jspdf` (≥4.2.1) and `effect`; get `pnpm audit --prod --audit-level=high` green so the CI gate passes.
2. **Close the self-host gates (OPS-02/03/04):** `.dockerignore`, multi-stage non-root image, real secret generation, external HTTPS origin — with a clean-context Docker build in CI (TST-15).
3. **Finish partials:** SEC-03 live revocation, SEC-12 metadata redaction, SEC-20/24/27 token/key handling, OPS-07/08/13 migration-gate/graceful-shutdown/metrics.
4. **Add the coverage gate (TST-01)** and re-verify the ❔ items domain-by-domain — many owning files were rewritten this pass, so re-run each check before spending fix effort.
5. **Product coherence (COR/UX):** role-aware canvas UI, undo/redo model, pagination surfaced in every list, accessibility alternative for the canvas.

> Note: `audits-fable/` was the older (2026-07-04) predecessor and was fully superseded by
> `audits-notes/` (its findings were rechecked against the tree; its "no migrations exist"
> claim is obsolete). Nothing unique was carried from it. Original prose for both is in git
> history if a detailed rationale is ever needed.
