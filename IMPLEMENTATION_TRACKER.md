# Senate One-Shot Implementation Tracker

Last updated: 2026-04-19
Status: Implemented, with explicit accepted risk and intentional deferrals only
Canonical source for execution progress: this file
Canonical source for the full implementation spec: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

## Objective

Execute the adopted Senate plan as the working implementation baseline and keep a persistent record of:
- locked decisions
- implementation order
- current progress
- completed work
- remaining blockers
- residual risks or intentional deferrals

This file is the execution companion to:
- [SENATE.md](./SENATE.md)
- [@CODEX.md](./@CODEX.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)

## Locked Decisions

- Production target is `stateful Node`, not serverless Next.
- Self-host baseline is `Node app + Postgres + Redis + S3-compatible object storage`.
- Setup automation must cover:
  - contributor bootstrap
  - self-host bootstrap
  - first-run app initialization
- The manual canvas remains the source of truth.
- The AI Organizer is a separate derived lens.
- BYOK is `server-side vault/proxy` by default.
- Adopted control-plane split:
  - `AgentProfile`
  - `ModelCredential`
  - `IntegrationAccount`
- Adopted agent gateway:
  - `/api/agent/v1/canvases/*`
  - `/api/agent/v1/items/*`
  - `/api/agent/v1/knowledge/*`
  - `/api/agent/v1/actions/*`
  - `/api/agent/v1/integrations/*`
  - `/api/agent/v1/providers/*`
- External transport model:
  - MCP-first externally
  - REST also first-class
  - outbound webhooks only
- No agent scope above `propose` opens before rollback/history and stable derived IDs exist.
- `KnowledgeRelation` is deferred until real usage proves the taxonomy.

## Gates

### Gate A: Senate Closure Sweep and Phase 0 Hardening
Goal: no unresolved Senate `Blocker` issues and no unowned Senate `High` issues.

Status: Complete, with one explicit accepted dependency risk

Planned work:
- [x] Deployment coherence: make `server.ts` the canonical runtime path.
- [x] Replace or demote serverless deployment assumptions in repo docs and scripts.
- [x] Fix ESM-unsafe build config in `next.config.mjs`.
- [x] Make `next build` a hard CI gate.
- [x] Remove `.env` from tracked-state guidance and tighten secret hygiene documentation.
- [x] Fix known async `params` route issues.
- [x] Fix rate-limiter store construction and double-counting.
- [x] Make optimistic locking atomic.
- [x] Unify REST/Yjs version authority and add per-canvas persistence locking.
- [x] Remove O(n) API-key fallback verify path.
- [x] Lock down template/public-share auth and privacy leaks.
- [x] Unify password policy and email normalization.
- [x] Remove raw owner/commenter emails from public/shared payloads.
- [x] Make upload quota enforcement atomic.
- [x] Enforce discriminated, type-bound `CanvasItem.content` validation on create/update.
- [x] Move canvas metadata to TanStack Query with shared invalidation.
- [x] Remove or reconcile `dotenv-safe` boot coupling.
- [x] Resolve auth/runtime ambiguity around `next-auth` beta usage.
- [x] Sweep high-value unique findings from Senate:
  - [x] WebSocket cookie naming
  - [x] public-canvas WS access
  - [x] Yjs `doc.destroy()` cleanup
  - [x] duplicate auth/account-lockout/sanitization modules
  - [x] multiple Redis client creation paths
  - [x] idempotency replay correctness
  - [x] `AsyncLocalStorage.enterWith()` bleed
  - [x] versions/template/public-share contract drift
  - [x] read-only share rendering for all item types
  - [x] `safeFetch` timeout cleanup
  - [x] SMTP stub handling

### Gate B: Setup Automation and Kickstart UX
Goal: a fresh clone or host can bootstrap the system with minimal manual work.

Status: Complete

Planned work:
- [x] Add cross-platform Node-based setup scripts under `scripts/`.
- [x] Add commands:
  - [x] `pnpm setup:dev`
  - [x] `pnpm setup:selfhost`
  - [x] `pnpm doctor`
  - [x] `pnpm stack:up`
  - [x] `pnpm stack:down`
  - [x] `pnpm stack:logs`
- [x] Expand Compose to include:
  - [x] app
  - [x] postgres
  - [x] redis
  - [x] minio-compatible object storage
- [x] Add production Dockerfile for the app.
- [x] Compile custom server to JS for production.
- [x] Add secure `/setup` first-run flow.
- [x] Rewrite README and self-host docs.

### Gate C: Foundation for Agents, History, and Semantic Layer
Goal: add the adopted schema and backend groundwork without opening unsafe automation.

Status: Implemented for the adopted Phase 1 to Phase 5 foundation

Planned work:
- [x] Add control-plane schema:
  - [x] `AgentProfile`
  - [x] `ModelCredential`
  - [x] `IntegrationAccount`
- [x] Add BYOK vault/proxy baseline.
- [x] Add shared policy/service core.
- [x] Add Postgres-backed job/worker baseline.
- [x] Add semantic minimum:
  - [x] `ItemEmbedding`
  - [x] `KnowledgeEntity`
  - [x] `ItemEntityLink`
- [x] Add history/rollback minimum:
  - [x] `AgentAction`
  - [x] `ChangeSet`
  - [x] `ChangeRecord`
- [x] Add `Suggestion`.
- [x] Add `WorkspaceCheckpoint`.
- [x] Keep organizer behavior read-only by default.

### Gate D: Agent Gateway and Capability Ladder
Goal: implement the adopted agent surface and open rungs only when their prerequisites exist.

Status: Implemented for the adopted gateway, transport, and product-surface scope

Planned work:
- [x] Build `/api/agent/v1/*` gateway families.
- [x] Implement MCP-first external surface.
- [x] Keep REST as equal transport adapter.
- [x] Implement outbound webhooks only.
- [x] Route inbound external events through `integrations/*`.
- [x] Mirror taxonomy in MCP tool groups.
- [x] Enforce rung gating:
  - [x] rung 0
  - [x] rung 1
  - [x] rung 2
  - [x] rung 3
  - [x] rung 4
  - [x] rung 5
  - [x] rung 6
  - [x] rung 7
  - [x] rung 8

## Senate Closure Matrix

Use this section to track each Senate `Blocker` and `High` issue to one of:
- `fixed`
- `deferred with mitigation`
- `accepted risk with rationale`

Current status:
- `fixed`
  - portable `build` and `start` scripts
  - compiled JS custom server bundle for production (`dist/server.mjs`)
  - env validation centralization and production storage/Redis requirements
  - async route params in known failing handlers
  - rate-limit double counting and per-request limiter churn
  - atomic item update/delete version checks
  - API-key prefix/suffix-only lookup path
  - template cloning and template visibility restrictions
  - public/share/comment email stripping
  - public share rendering now covers the full canvas item set in read-only mode
  - canvas-version listing now has an explicit `includeSnapshot` contract and the time-machine view hydrates version snapshots correctly
  - template creation now uses the shared hook contract end-to-end, including template names and public-template intent
  - public/share/auth URL generation now prefers `AUTH_URL`, falls back to `NEXTAUTH_URL`, and only then uses request origin
  - password reset/change policy alignment
  - upload quota checks for both local and S3 paths with locking
  - WebSocket cookie-name handling and public read-only access
  - Yjs doc cleanup on eviction and persistence serialization
  - shared account-lockout path and request-scoped session caching without `AsyncLocalStorage.enterWith()`
  - SMTP provider explicitly disabled and surfaced through diagnostics
  - generic inbound webhook path disabled in favor of authenticated `integrations/*` ingress
  - live smoke diagnostics now exist as a first-class operator path via `pnpm smoke`, `pnpm doctor`, and `pnpm setup:selfhost`
  - Auth.js beta usage is now an explicit exact-pin policy with runtime warnings, docs, and regression coverage instead of an ambiguous floating-beta state
  - full production build succeeds with `MEMORIA_ENV_FILE=.env.example`
  - Gate C/D schema and REST gateway foundation for agents, history, rollback, and semantic nodes
  - MCP transport surface under `/api/agent/v1/mcp` with shared query/service-core execution
  - `CanvasView`-backed organizer tab with read-only derived-entity rendering and traceability to source items
  - settings-side suggestion approval, execution, and change-set rollback console
- `deferred with mitigation`
  - the existing local `.env` on this machine is now intentionally rejected by validation until missing keys are added or regenerated via setup automation
- `accepted risk with rationale`
  - NextAuth remains exact-pinned to `5.0.0-beta.25` for now; runtime/docs/tests now make that policy explicit, but the dependency itself has not yet been migrated to a stable release

## Progress Log

### 2026-04-18
- Created this tracker as the canonical execution record before further implementation work.
- Confirmed the repo is currently a dirty worktree; implementation should avoid unrelated user edits.
- Confirmed the current production/runtime mismatch still exists:
  - custom `server.ts`
  - `vercel.json` serverless assumptions
  - partial Compose baseline
- Confirmed setup automation is still mostly manual and incomplete.
- Confirmed the adopted Senate decisions need to be translated into concrete repo changes.
- Landed Gate A/B foundation changes:
  - cross-platform `build`, `start`, setup, doctor, and stack scripts
  - Compose expansion to app + Postgres + Redis + MinIO
  - Dockerfile and Node-first runtime path
  - `/setup` bootstrap flow creating the first owner, `Personal` workspace, and `Inbox` canvas
- Landed Phase 0 hardening changes:
  - env validation now enforces production Redis/S3/bootstrap-token requirements
  - rate-limit middleware no longer double-counts specific routes
  - API idempotency now replays stored failures instead of deleting keys on exceptions
  - item updates/deletes now use atomic version-checked writes
  - API-key auth no longer falls back to full-table verification scans
  - templates are cloned instead of mutating the source canvas
  - public/shared/comment/template payloads no longer expose raw emails
  - password reset/change routes now share the same strength/hashing policy
  - upload quota checks now run for both local and S3-backed storage
  - canvas metadata now uses TanStack Query instead of ad hoc fetch state
  - WebSocket auth now supports Auth.js cookie names and read-only public canvas access
  - Yjs document eviction now destroys docs and serializes persistence
- Verification:
  - `pnpm type-check`: passes
  - `pnpm lint`: passes
  - `pnpm build` with the current local `.env`: fails fast because the env file is missing newly-required keys
  - `pnpm build` with `MEMORIA_ENV_FILE=.env.example`: gets through compilation/type/lint far enough to expose only sandbox worker-spawn limits and non-fatal Sentry/OpenTelemetry warnings
- Remaining open work from this slice:
  - compile the custom server to JS instead of using `tsx` for production start
  - reconcile duplicate auth/account-lockout/sanitization modules and multiple Redis client paths
  - finish public read-only rendering coverage for every canvas item type
  - sweep the remaining Senate high-value findings not yet closed

### 2026-04-18 (Execution Slice 2)
- Closed the remaining Gate A/B blockers:
  - production server build now emits `dist/server.mjs`
  - `pnpm start` now requires the compiled JS server artifact instead of `tsx`
  - build-time database eager connect was removed so `next build` no longer requires a live DB
  - server-route sanitization no longer imports browser-only DOM sanitizer code into the Next build path
  - the public share page now renders notes, bookmarks, images, drawings, shapes, arrows, text, frames, embeds, and polls in read-only mode
  - account lockout now uses the shared Redis client path and auth request caching no longer uses `AsyncLocalStorage.enterWith()`
  - SMTP is explicitly unsupported in this build and `pnpm doctor` reports that clearly
- Landed Gate C foundation:
  - Prisma schema + migration for `AgentProfile`, `ModelCredential`, `IntegrationAccount`, `AgentAction`, `ChangeSet`, `ChangeRecord`, `Suggestion`, `KnowledgeEntity`, `ItemEntityLink`, `ItemEmbedding`, `WorkspaceCheckpoint`, `CanvasView`, and `AgentJob`
  - BYOK secret encryption and fingerprinting
  - canvas-scoped agent policy helpers and integration-token auth
  - owner-managed agent profile APIs
- Landed Gate D foundation:
  - `/api/agent/v1/providers`
  - `/api/agent/v1/integrations`
  - `/api/agent/v1/integrations/ingest`
  - `/api/agent/v1/canvases`
  - `/api/agent/v1/items`
  - `/api/agent/v1/knowledge`
  - `/api/agent/v1/actions`
  - capability gating for read, ingest, propose, single-write, and external-action proposal scopes
  - audited single-record writes and change-set rollback plumbing
- Verification completed:
  - `pnpm db:generate`: passes
  - `pnpm type-check`: passes
  - `pnpm lint`: passes
  - `pnpm build:server`: passes
  - `MEMORIA_ENV_FILE=.env.example pnpm build`: passes
  - `pnpm test -- --run`: passes (`21` files, `195` tests)
- Remaining open work from this slice:
  - MCP transport is still not implemented
  - outbound webhook delivery is still not implemented
  - rung `2`, `5`, `6`, and `8` do not have dedicated route behavior yet
  - `KnowledgeRelation` is still intentionally deferred
  - operator diagnostics still do not perform a full running-stack smoke test automatically

### 2026-04-19 (Execution Slice 3)
- Expanded Gate D from foundation to actual ladder behavior:
  - rung `2` now supports audited agent comment creation with rollback records
  - rung `5` now supports grouped multi-item canvas writes through the shared change-set core
  - rung `6` now creates workspace checkpoints plus bulk-preview suggestions before execution
  - rung `8` now executes approved external actions through signed outbound webhooks only
- Added suggestion lifecycle operations:
  - approve suggestion
  - reject suggestion
  - execute approved suggestion
  - create manual workspace checkpoint
- Tightened the shared service core:
  - suggestion actions now embed `suggestionId` in action metadata for traceability
  - bulk item writes reuse the same audited `ChangeSet` / `ChangeRecord` path as single writes
  - rollback now covers agent-created comments in addition to canvas items and semantic records
  - signed webhook delivery now validates destinations, strips reserved headers, and clears request timeouts safely
- Tightened integration handling:
  - `WEBHOOK` integrations now validate `externalAccountId` as an http(s) delivery URL
  - webhook integrations store an encrypted outbound signing secret derived from the issued integration token
- Verification completed:
  - `pnpm type-check`: passes
  - `pnpm lint`: passes
  - `MEMORIA_ENV_FILE=.env.example pnpm build`: passes
  - `pnpm test -- --run`: passes (`22` files, `198` tests)
- Remaining open work from this slice:
  - MCP transport is still not implemented
  - organizer UI, suggestion approval UI, and action-history inspection UI are still not implemented
  - `KnowledgeRelation` is still intentionally deferred
  - operator diagnostics still do not perform a full running-stack smoke test automatically

### 2026-04-19 (Execution Slice 4)
- Closed the remaining Gate C/D product and transport gaps:
  - added shared read/query helpers so REST and MCP reuse one scoped data layer
  - added `/api/agent/v1/mcp` for `initialize`, `ping`, `tools/list`, and `tools/call`
  - split pure MCP schema/handshake metadata into `src/lib/agents/mcp-schema.ts` for lightweight testing
  - added `CanvasView` APIs under `/api/v1/canvases/[canvasId]/views`
  - added a manual vs organizer toggle in the canvas header
  - added a read-only organizer lens that renders derived entities, proposal state, and audited change sets for a canvas
  - added a settings-side agent control center for suggestion approval, execution, provider/integration visibility, and change-set rollback
- Verification completed:
  - `pnpm type-check`: passes
  - `pnpm lint`: passes
  - `pnpm build:server`: passes
  - `MEMORIA_ENV_FILE=.env.example pnpm build`: passes
  - `pnpm test -- --run`: passes (`23` files, `200` tests)
- Remaining open work from this slice:
  - `KnowledgeRelation` is still intentionally deferred
  - versions/template/public-share contract harmonization is still not fully swept across every consumer surface
  - NextAuth remains pinned on beta pending an explicit migration or long-term pin decision
  - operator diagnostics still do not perform a full running-stack smoke test automatically

### 2026-04-19 (Execution Slice 5)
- Closed the remaining Gate A residual implementation debt:
  - canvas-version listing now supports `includeSnapshot=true` and the time-machine client hydrates snapshot items instead of assuming the wrong shape
  - save-as-template now uses the shared template hook contract instead of a local mock mutation and supports `name` plus `isPublic`
  - public canvas share links, password reset links, and verification links now resolve against `AUTH_URL` first
  - CORS default-origin warnings now align with the `AUTH_URL`-first runtime model
  - Auth.js beta usage is now an explicit exact-pin policy in runtime logging and docs
- Closed the remaining operator-diagnostics gap:
  - added `scripts/lib/smoke.mjs` plus `pnpm smoke`
  - `pnpm doctor` now reports live app smoke checks when the app is reachable and can require them with `--smoke`
  - `pnpm setup:selfhost` now runs smoke checks against the app root, login page, health route, and collaboration upgrade path before reporting success
- Added explicit regression coverage for the auth pin with `tests/unit/auth-version-policy.test.ts`
- Verification completed:
  - `pnpm type-check`: passes
  - `pnpm lint`: passes
  - `pnpm build:server`: passes
  - `MEMORIA_ENV_FILE=.env.example pnpm build`: passes
  - `pnpm test -- --run`: passes with escalation (`24` files, `201` tests)
  - `node scripts/smoke.mjs --json`: returns the expected non-failing warning when no local app is running
- Remaining intentional non-implementation items:
  - `KnowledgeRelation` is still intentionally deferred
  - the exact-pinned `next-auth` beta remains an accepted dependency risk until an explicit stable migration is performed

## Current Execution Slice

The current implemented baseline is:
1. Completed Gates A-D for the adopted Senate scope.
2. Left only explicit future scope and accepted risk:
   - `KnowledgeRelation`
   - stable `next-auth` migration beyond the exact-pinned beta policy
   - any broader outbound event/subscription surface beyond MCP + REST if it is still wanted later

## Rules While Executing

- Do not overwrite unrelated dirty worktree changes.
- Prefer cross-platform scripts over shell-specific setup steps.
- Treat self-hosting as a first-class supported path.
- Do not open write-capable agent scopes before rollback/history primitives exist.
- Update this file whenever a meaningful implementation milestone lands.
