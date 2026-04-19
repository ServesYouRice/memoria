# Senate One-Shot Implementation Plan

Last updated: 2026-04-18
Status: Approved working plan
Purpose: durable implementation spec

Use this file as the canonical detailed plan.
Use [IMPLEMENTATION_TRACKER.md](./IMPLEMENTATION_TRACKER.md) as the canonical progress log.

## Summary

Implement the Senate's `2/3 adopted` decisions as binding and treat the remaining Senate audit as a `zero-unowned-risk` checklist. The project should ship as a `stateful Node`, `cheap self-host`, `open-source-first` product with `setup automation as a core feature`, not an afterthought.

The plan has four non-negotiable gates:

- `Gate A`: no unresolved Senate `Blocker` issues and no unowned Senate `High` issues
- `Gate B`: contributor bootstrap, self-host bootstrap, and first-run bootstrap are all automated and idempotent
- `Gate C`: no agent scope above `propose` opens until rollback/history and stable derived IDs exist
- `Gate D`: MCP, REST, and webhooks all run through one shared policy/service core

## Locked Decisions

- Production target is `stateful Node`, not serverless Next.
- Self-host baseline is `Node app + Postgres + Redis + S3-compatible object storage`, with a MinIO-compatible local/self-host reference stack.
- Setup automation must optimize for:
  - contributor bootstrap
  - self-host deployment
  - first-run app initialization
- The manual canvas remains the source of truth.
- The AI Organizer is a separate derived lens.
- BYOK is `server-side vault/proxy` by default.
- The adopted control-plane split is:
  - `AgentProfile`
  - `ModelCredential`
  - `IntegrationAccount`
- The adopted agent gateway is:
  - `/api/agent/v1/canvases/*`
  - `/api/agent/v1/items/*`
  - `/api/agent/v1/knowledge/*`
  - `/api/agent/v1/actions/*`
  - `/api/agent/v1/integrations/*`
  - `/api/agent/v1/providers/*`
- The adopted agent API transport model is:
  - MCP-first externally
  - REST also first-class
  - outbound webhooks only
- The adopted capability ladder is the policy frame; no write-capable scope bypasses it.
- V1 agent scoping is `canvas-level only`. Workspace-level grants are deferred until workspace sharing/roles exist.
- `CanvasView` is presentation state only. Semantic authority lives in `KnowledgeEntity` and `ItemEntityLink`.
- `KnowledgeRelation` is deferred until real usage proves the edge taxonomy.
- Production Redis is required for multi-instance collaboration, rate limiting, and agent/runtime safety. In-memory fallbacks remain dev-only and single-node only.
- Production object storage is required. Local disk uploads remain dev-only.
- Generic inbound webhooks do not exist. Inbound external events go through authenticated `integrations/*` routes only.

## Implementation Plan

### 1. Gate A - Senate Closure Sweep and Phase 0 Hardening

Create a `Senate closure matrix` mapping every Senate Part 1 `Blocker` and `High` item to one status:

- `fixed`
- `deferred with mitigation`
- `accepted risk with written rationale`

GA allows no unowned `Blocker` or `High`.

Fix the agreed Phase 0 blockers in this exact order:

1. deployment coherence: make `server.ts` the canonical runtime path and remove serverless deployment as the primary path
2. build unblock: replace ESM-unsafe `require.resolve` usage and make `next build` a hard CI gate
3. credential hygiene: untrack `.env`, rotate exposed secrets, and lock auth version strategy
4. async route params: fix the known Next 15 `params` outliers
5. rate limiting: memoize limiter/store construction and remove double-counting against the general API limiter
6. optimistic locking: switch item update/delete to atomic conditional writes
7. concurrency authority: unify REST/Yjs persistence under one authoritative write/version model and add per-canvas persistence locking
8. API-key auth: remove the `O(n)` verify fallback and require prefix/suffix lookup only
9. template and public-share lockdown: enforce ownership/publicness consistently and remove public email leakage
10. password policy and auth consistency: unify register/reset/change password policy, normalize email everywhere, and either enforce verification or explicitly disable the unfinished verification requirement
11. public payload privacy: strip raw owner/commenter emails from public or shared responses

Fix the rest of the Senate-agreed majority issues as Phase 0 exit criteria:

- upload quota must be atomic
- `CanvasItem.content` must be a discriminated, type-bound shape on create and update
- canvas metadata must move into TanStack Query and use shared invalidation
- `dotenv-safe` boot coupling must be removed or made fully consistent with the validated env schema
- `next-auth` must stop being an ambiguous rolling beta dependency; either move to stable or exact-pin with explicit regression coverage and residual-risk note

Include the high-value unique findings in the Phase 0 closure sweep because they are too risky to leave behind:

- WebSocket auth cookie naming, public-canvas WS access, and Yjs `doc.destroy()` cleanup
- duplicate auth/account-lockout/sanitization modules and multiple Redis client creation paths
- idempotency replay correctness for `204` and empty-body responses and crash recovery
- `AsyncLocalStorage.enterWith()` request-context bleed
- versions/template/public-share contract drift
- read-only share rendering for all item types
- `safeFetch` timeout cleanup
- SMTP stub treatment: either implement, hide, or clearly disable unsupported email-provider options

### 2. Gate B - Setup Automation and Kickstart UX

Replace the manual setup story with `cross-platform Node-based automation` under `scripts/`.

Add these idempotent commands:

- `pnpm setup:dev`
- `pnpm setup:selfhost`
- `pnpm doctor`
- `pnpm stack:up`
- `pnpm stack:down`
- `pnpm stack:logs`

`pnpm setup:dev` must:

- verify Node and pnpm versions
- install dependencies if missing
- create `.env` from template only if absent
- generate local secrets automatically
- boot Postgres, Redis, and MinIO-compatible storage
- wait for health checks
- ensure the default bucket exists
- run Prisma generate and development migrations
- optionally seed demo data
- print the exact local URLs, credentials, and next commands

`pnpm setup:selfhost` must:

- generate a production env file from a committed template
- generate secrets and a one-time bootstrap token
- validate all required env vars and ports
- start the full Compose stack
- ensure the object-storage bucket exists
- run production migrations
- print operator URLs, health checks, and the first-run bootstrap URL

`pnpm doctor` must:

- support human-readable output and `--json`
- validate env, DB reachability, Redis reachability, object storage reachability, migration state, bucket existence, and vector-extension availability
- return non-zero on blocking problems

Expand the Compose story into the supported self-host baseline:

- app container
- Postgres container
- Redis container
- MinIO-compatible object-storage container

Add a production Dockerfile for the app and make Compose use it.

Compile the custom server to JS for production; `tsx` remains development-only.

Add a secure first-run route at `/setup`:

- enabled only when `User.count == 0`
- requires the bootstrap token generated by setup automation, except optional localhost-only convenience in development
- creates the first owner account
- creates the default `Personal` workspace and the default `Inbox` canvas
- disables automatically once the first user exists

Setup automation must be safe by default:

- never overwrite existing env files, buckets, or DB state without explicit `--force`
- never destroy data unless a dedicated `--reset` or equivalent destructive mode is intentionally invoked

Rewrite the README and self-host docs so a fresh user can bootstrap the app without manually editing half a dozen files. Remove outdated slice claims and replace them with the actual product and setup story.

### 3. Gate C - Phase 1 to Phase 5 Foundation

Add the control-plane schema:

- `AgentProfile`: logical assistant identity, owner, status, display name, default capability ceiling
- `ModelCredential`: user-owned outbound provider credential with encrypted secret, provider/baseUrl/model metadata, spend policy, verification status
- `IntegrationAccount`: inbound channel identity with auth material, replay/idempotency context, status, and last-seen metadata

Keep two credential planes separate by design:

- outbound provider auth lives in `ModelCredential`
- inbound assistant/integration auth lives under `AgentProfile` and `IntegrationAccount`

Adopt the BYOK security bar as implementation acceptance criteria:

- encrypted at rest
- decrypted only inside the provider gateway immediately before use
- never returned to the client after save
- never logged
- never exposed directly to third-party assistants
- per-provider spend cap and kill switch

Use a `shared policy/service core` as the canonical layer for agent behavior:

- scope resolution
- rung enforcement
- idempotency
- per-agent rate limiting
- audit emission
- history/change writing
- provider invocation

Build asynchronous work on a `Postgres-backed job table + worker` as the default queue for cheap self-hosting. Redis remains support infrastructure, not the canonical queue.

Add the semantic minimum:

- `ItemEmbedding`
- `KnowledgeEntity`
- `ItemEntityLink`

Add the history/rollback minimum as one shipping unit:

- `AgentAction`
- `ChangeSet`
- `ChangeRecord`

Add `Suggestion` for both internal proposals and external-action proposals.

Add `WorkspaceCheckpoint` as the gate for bulk/scheduled/external-execution rungs.

Phase 4 organizer behavior is fixed:

- read-only by default
- stable derived IDs from `KnowledgeEntity`
- source traceability through `ItemEntityLink`
- no silent mutation of manual canvas items

`Suggestion` acceptance rules are fixed:

- internal accepted suggestions may create or update derived state
- external-action suggestions may only move to execution after validation and approval
- ignored suggestions expire by default within 30 days

### 4. Gate D - Agent Gateway and Capability Ladder

Adopt the dedicated agent gateway:

- `/api/agent/v1/canvases/*`
- `/api/agent/v1/items/*`
- `/api/agent/v1/knowledge/*`
- `/api/agent/v1/actions/*`
- `/api/agent/v1/integrations/*`
- `/api/agent/v1/providers/*`

Responsibilities are fixed:

- `canvases/*`: canvas list/read, metadata, Inbox selection, scope resolution
- `items/*`: primary raw content surface, search, create, update, comment subroutes
- `knowledge/*`: derived entities and links
- `actions/*`: suggestion queue, approvals, execution records, reverts
- `integrations/*`: inbound channel registration and authenticated ingress
- `providers/*`: provider slots, model availability, capability flags, spend ceilings, credential status; never secrets

External transport model is fixed:

- MCP-first for OpenClaw-class and tool-native clients
- REST equally supported as a transport adapter
- outbound webhooks only
- inbound external events only through `integrations/*`

MCP tool taxonomy must mirror the same nouns:

- `canvases.*`
- `items.*`
- `knowledge.*`
- `actions.*`
- `integrations.*`
- `providers.*`

Neither MCP nor REST is canonical. The shared policy/service core is canonical. Each transport is a thin adapter over the same authorization, audit, idempotency, and domain services.

Capability ladder rollout is fixed:

- `Rung 0`: read-only
- `Rung 1`: ingest to Inbox only
- `Rung 2`: comment only
- `Rung 3`: propose internal changes only
- `Rung 4`: single-record internal writes
- `Rung 5`: grouped multi-record internal writes
- `Rung 6`: bulk/scheduled runs
- `Rung 7`: propose external actions
- `Rung 8`: execute approved external actions

Gating rules are fixed:

- rungs `0-3` can run on raw layer plus `Suggestion`
- rung `4+` requires stable derived IDs from `KnowledgeEntity` + `ItemEntityLink`
- rung `4` requires `ChangeRecord`
- rung `5` requires `ChangeSet`
- rung `6` requires `WorkspaceCheckpoint` + preview/draft branch + user-approved merge
- rung `7` requires structured external-action proposals and approval UI
- rung `8` requires execution records, compensating-action logging, per-provider spend cap, and approval default-on

All rungs `>=1` are opt-in and revoked per rung, not per agent only.

Rung `4+` writes remain canvas-scoped in v1. A single run may not cross canvases unless a future multi-canvas scope is deliberately introduced after workspace-role work.

## Public Interfaces and Schema Additions

- `AgentProfile`: `id`, `userId`, `name`, `status`, `maxCapabilityRung`, `defaultModelCredentialId?`, standard timestamps
- `ModelCredential`: `id`, `userId`, `provider`, `label`, `baseUrl?`, `defaultModel`, `encryptedSecret`, `secretFingerprint`, `capabilities`, `dailySpendCap`, `monthlySpendCap`, `status`, `lastVerifiedAt`, standard timestamps
- `IntegrationAccount`: `id`, `agentProfileId`, `providerType`, `externalAccountId`, `authMode`, `encryptedSecretOrHash`, `status`, `lastSeenAt`, standard timestamps
- `AgentAction`: `id`, `userId`, `agentProfileId`, `integrationAccountId?`, `modelCredentialId?`, `kind`, `rung`, `status`, `summary`, `requestFingerprint`, `metadata`, standard timestamps
- `ChangeSet`: `id`, `userId`, `agentProfileId`, `agentActionId?`, `scopeType`, `scopeId`, `status`, `summary`, `startedAt`, `completedAt`, `revertedAt`
- `ChangeRecord`: `id`, `changeSetId`, `targetType`, `targetId`, `operation`, `before`, `after`, `reversible`, `revertedAt`
- `Suggestion`: `id`, `userId`, `agentProfileId`, `kind`, `status`, `summary`, `payload`, `expiresAt`, `actedAt`, standard timestamps
- `KnowledgeEntity`: `id`, `userId`, `entityType`, `title`, `summary`, `status`, `attributes`, `sourceConfidence`, standard timestamps
- `ItemEntityLink`: `id`, `itemId`, `knowledgeEntityId`, `linkType`, `confidence`, standard timestamps
- `ItemEmbedding`: `id`, `itemId`, `provider`, `model`, `contentHash`, `vector`, standard timestamps
- `WorkspaceCheckpoint`: `id`, `userId`, `scopeType`, `scopeId`, `snapshot`, `reason`, `createdByActorType`, `createdByActorId`, standard timestamps
- `CanvasView`: keep or add only as organizer presentation state keyed by `userId + canvasId + viewType`; it must not become semantic authority
- Replace the old `Agent` and `AgentCredential` names in all design docs and implementation plans with the adopted names above

## Test and Acceptance Plan

- `Phase 0` exit requires:
  - `pnpm lint`
  - `pnpm type-check`
  - `pnpm build`
  - unit tests
  - targeted E2E smoke tests
  - WebSocket smoke tests
  - a Senate closure matrix showing no unresolved `Blocker` and no unowned `High`
- Bootstrap acceptance requires:
  - a fresh clone on Windows/macOS/Linux can run `pnpm setup:dev`
  - a clean host can run `pnpm setup:selfhost`
  - `pnpm doctor` catches missing secrets, missing bucket, missing migrations, unhealthy DB/Redis/storage, and missing vector support
- Security acceptance requires:
  - no public template/auth/privacy leaks
  - no raw emails in public/shared responses
  - no provider secrets returned from APIs
  - bootstrap route locked behind token and disabled after first user
- Concurrency acceptance requires:
  - atomic item update/delete
  - upload quota enforcement under concurrency
  - REST/Yjs convergence
  - idempotency crash recovery
  - rung-appropriate revert coverage
- Gateway acceptance requires:
  - MCP and REST produce the same scope decisions and audit/history effects
  - outbound webhooks are signed and replay-safe
  - inbound integration routes are idempotent and bound to `IntegrationAccount`
- Organizer acceptance requires:
  - source-item traceability to derived entities
  - read-only behavior before approval
  - stable derived IDs at rung `4+`
  - no silent mutation of user-owned canvas items
- Operations acceptance requires:
  - app readiness check validates DB, Redis, object storage, migrations, and optional vector capability
  - unsupported email providers are either implemented or clearly disabled and surfaced in diagnostics

## Assumptions and Defaults

- The user's ruling stands: `2/3` Senate agreement is enough to proceed.
- Statefulness is not a temporary compromise; it is the deliberate v1 deployment model.
- Cheap self-hosting means avoiding mandatory managed queue infrastructure; Postgres-backed jobs are the default.
- Email verification/reset flows may remain disabled until a real provider is configured, but the app must surface that state clearly in setup and diagnostics.
- Vector support is required for Phase 2+, but the core app must still boot and function before semantic features are enabled.
- Licensing, pricing, and public distribution branding are outside this technical plan, but the packaging/docs must assume public open-source distribution.
