# Production Audit

## Scope

This audit covered the full repository structure, major execution surfaces, backend and frontend flows, async paths, data contracts, and deployment assumptions.

Main execution surfaces:
- `server.ts`: custom Node/Next server plus WebSocket collaboration bootstrap.
- `src/app`: App Router pages and API routes.
- `src/features/canvas`: main product surface, canvas UI, dialogs, and interaction hooks.
- `src/lib`: auth, db, API helpers, collaboration, cache, rate limiting, email, AI, validation, utilities.
- `src/stores`: Zustand UI state.
- `prisma`: schema, seed, and extra FTS SQL.
- `tests`: unit/integration coverage.

Verification work performed:
- `npm run type-check`: passed.
- `npm run lint`: passed.
- `npm test -- --run`: passed (`195` tests).
- `npm run build`: failed.
- `npm run start` on Windows: failed.
- Import-graph scan across `266` source files: no verified multi-file circular imports.

Highest-risk themes:
- The deployment model is internally inconsistent: the repo is built like a long-lived Node app, but `vercel.json` describes a serverless Next deployment.
- Template/public-sharing logic is confused and leaks private data.
- There are several non-atomic write paths, so concurrent edits can corrupt expectations around optimistic locking and idempotency.
- Frontend query contracts are out of sync with backend responses in versioning, templates, and public sharing.

## Deployment, Build, and Operational Blockers

- `CRITICAL` `next.config.mjs`: `next build` is currently broken because the config is ESM but uses `require.resolve('konva/lib/index.js')`. Verified failure: `ReferenceError: require is not defined`. Fix: replace `require.resolve` with an ESM-safe approach (`createRequire(import.meta.url)`, `import.meta.resolve`, or a direct alias string) and make `next build` a hard CI gate.
- `CRITICAL` `server.ts`, `src/lib/collaboration/websocket-server.ts`, `vercel.json`, `package.json`: the app depends on a custom Node server and raw WebSocket upgrades, but `vercel.json` declares a normal Next/Vercel deployment. That deployment will not run `server.ts`, and collaboration will not work as designed. Fix: choose one production architecture and align the repo to it: either stateful Node hosting for `server.ts`, or a serverless-safe redesign for collaboration.
- `HIGH` `src/app/api/v1/upload/route.ts`, `vercel.json`: local upload storage writes to `public/uploads`, which is incompatible with ephemeral serverless filesystems. Fix: require S3-compatible storage in production and make local storage development-only.
- `HIGH` `package.json`: the production start script is Windows-broken. Verified failure: `'NODE_ENV' is not recognized as an internal or external command`. Fix: use `cross-env NODE_ENV=production tsx server.ts` or a platform-neutral equivalent.
- `HIGH` `src/app/api/v1/upload/route.ts`: per-user upload quotas are enforced only in local-storage mode; S3 mode skips the quota/file-count checks entirely. Fix: move quotas to persistent metadata in the database so they apply to every storage backend.
- `MEDIUM` `prisma/fts-migration.sql`, `src/app/api/v1/search/route.ts`, `vercel.json`: full-text search depends on a standalone SQL script, not Prisma migrations. Production deployments that only run `prisma migrate deploy` will usually miss `searchVector` and silently fall back to slower search. Fix: convert the FTS SQL into a real migration or make startup fail when the expected production search index is absent.
- `MEDIUM` `package.json`, `src/instrumentation.ts`: auth is pinned to `next-auth@5.0.0-beta.25`, and the instrumentation code already warns about it. Fix: move to a stable auth stack before production or explicitly accept the beta risk and run targeted auth regression tests.
- `MEDIUM` `src/lib/env.ts`: environment validation is incomplete relative to real runtime usage. Important variables used elsewhere are not validated here, including `OPENAI_API_KEY`, `EMAIL_PROVIDER`, `SMTP_*`, `SENDGRID_API_KEY`, `RESEND_API_KEY`, `CORS_*`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`, `LOG_LEVEL`, and `AUTH_SECRET`. Fix: make `env.ts` the single source of truth for every production env var the code reads.

## Security, Privacy, and Access Control

- `CRITICAL` `src/app/api/v1/templates/route.ts`: the "public templates" endpoint does not filter for publicness or ownership; it filters only `isTemplate: true`. That exposes every user's template canvas. Fix: separate template visibility from canvas sharing, then enforce `public OR owner` in every template read path.
- `CRITICAL` `src/app/api/v1/templates/[templateId]/route.ts`: template detail fetch is unauthenticated and returns any template by ID, again without checking publicness or ownership. Fix: apply the same visibility rules as template listing.
- `HIGH` `src/app/api/v1/templates/route.ts`, `src/app/api/v1/templates/[templateId]/route.ts`, `src/app/templates/page.tsx`: template APIs and UI expose creator email addresses publicly. Fix: never return raw user emails in public template responses; return only display-safe profile fields.
- `HIGH` `src/app/api/v1/shared-canvases/route.ts`: the shared-canvas list returns owner emails to recipients. Fix: return a safe owner profile object without email.
- `HIGH` `src/app/api/v1/items/[itemId]/comments/route.ts`, `src/app/api/v1/items/[itemId]/comments/[commentId]/route.ts`: comment APIs include commenter emails, and the list endpoint is readable on public canvases. That leaks commenter emails to anonymous viewers. Fix: remove `email` from comment user payloads or gate it to the commenter and owner only.
- `HIGH` `src/middleware/cors.ts`: wildcard subdomain matching uses `origin.endsWith(domain)`, so `*.example.com` would also accept `evil-example.com`. Fix: enforce a dot-boundary check or parse hostnames and validate actual subdomain relationships.
- `HIGH` `src/lib/auth.ts`, `src/app/api/v1/auth/register/route.ts`, `src/app/api/v1/auth/send-verification/route.ts`: auth flows are inconsistent. Registration lowercases email, but credentials login does not, so mixed-case login attempts can fail. Also, email verification exists but is not enforced at login, and the verification route appears unused by the UI. Fix: normalize email at every auth boundary and either enforce verified email or remove the half-finished verification requirement.
- `HIGH` `src/lib/rate-limit/*`, `src/app/api/v1/auth/*`, `src/lib/auth.ts`: the repo has a rate-limit framework, but most public auth routes do not use it. Password reset, registration, reset, and verification endpoints are not actually wrapped. Also, login lockout silently disappears when Redis is absent. Fix: apply explicit rate limits to all public auth endpoints and define a production requirement for durable rate limiting.
- `HIGH` `src/lib/api/api-key-auth.ts`, `src/app/api/v1/extensions/clip/route.ts`, `src/app/api/v1/webhooks/trigger/route.ts`: invalid API keys can trigger expensive scans of all active keys, including Argon2 verification, before any rate limiting is applied. This is a CPU/DB exhaustion vector. Fix: remove the legacy full-scan path after migration, require strict key format, look up by prefix and suffix, and add cheap pre-auth IP throttling.
- `MEDIUM` `src/lib/utils/ssrf-protection.ts`: SSRF defenses are decent but still have a DNS-rebinding TOCTOU gap because DNS is validated before `fetch`, not pinned through the socket connection. Fix: use an HTTP client that lets you connect to the validated IP directly, or document this as residual risk and isolate the service.
- `MEDIUM` `src/app/api/v1/canvases/[canvasId]/public/route.ts`, `src/app/share/[token]/page.tsx`: the system claims public shares are read-only, but the page uses editable canvas components that still fire write attempts. Fix: create dedicated read-only item renderers for public pages.

## Concurrency and Race Conditions

- `CRITICAL` `src/app/api/v1/canvas-items/[itemId]/route.ts`: optimistic locking is not atomic. PATCH and DELETE read the version in one query and update in a second query, so two concurrent requests with the same version can both succeed. Fix: collapse the version check into the write (`updateMany where id + version`) or use a transaction/row lock.
- `HIGH` `src/lib/hooks/use-autosave.ts`: autosave still has a stale-version race. It sends `currentVersionRef.current` but does not advance the local version after success, so quick sequential saves can reuse an old version before a refetch lands. Fix: update the local version on mutation success or drive autosave from authoritative cache updates.
- `HIGH` `src/lib/hooks/use-autosave.ts`: pending changes can be stranded if new changes arrive while a flush is already running. The timer fires, `flush()` returns early because `isFlushingRef` is true, and no follow-up flush is guaranteed. Fix: add a "flush again" flag or a post-success check for queued changes.
- `HIGH` `src/features/canvas/components/BookmarkItem.tsx`, `src/features/canvas/components/ImageItem.tsx`, `src/features/canvas/components/CanvasItemLayer.tsx`, `src/features/canvas/components/CanvasBoard.tsx`: bookmark and image drag-end handlers write twice: once via local autosave and again via the parent `onDragEnd`. This creates duplicate PATCHes and version conflicts. Fix: choose one drag persistence path per item type.
- `HIGH` `src/lib/collaboration/yjs-provider.ts`, `src/app/api/v1/canvas-items/[itemId]/route.ts`: collaboration persistence increments item versions independently from the REST mutation path. REST clients and Yjs clients can drift or collide because they do not share one concurrency model. Fix: unify persistence behind one write path or one version authority.
- `HIGH` `src/lib/api/route-handler.ts`: idempotency locks can become stale for up to 24 hours. If the process dies after inserting the idempotency row and before storing a response or deleting it, retries get `409` forever. `lockedAt` exists in the schema but is not used. Fix: add lock expiry/recovery semantics and treat orphaned in-flight records as reclaimable after a short timeout.
- `MEDIUM` `src/app/api/v1/upload/route.ts`: local upload quota enforcement is check-then-write. Concurrent uploads can exceed file-count and storage limits because usage is read before the write and never reserved atomically. Fix: track quota consumption in the database or lock per user during upload finalization.
- `MEDIUM` `src/app/api/v1/extensions/clip/route.ts`, `src/app/api/v1/webhooks/trigger/route.ts`: default Inbox creation is racy. Two first-time requests can both see no inbox and create duplicate "Inbox" canvases. Fix: introduce a unique default-canvas invariant and use an upsert or transaction.
- `MEDIUM` `src/app/api/v1/templates/[templateId]/use/route.ts`: canvas creation and template `usageCount` increment are separate writes. A partial failure leaves state inconsistent. Fix: wrap both operations in one transaction.
- `MEDIUM` `src/app/api/v1/canvases/[canvasId]/connections/route.ts`: connection creation checks item existence first and inserts later. Concurrent item deletion or duplicate connection creation can surface as raw database errors instead of controlled API behavior. Fix: use one transaction and map unique/FK violations to explicit API responses.

## API, Data Model, and Contract Drift

- `CRITICAL` `src/lib/validation/canvas-item.ts`: item validation does not bind `content` to `type`. A request can send `type: NOTE` with bookmark/image/text content and still pass validation. Fix: replace the loose union with a discriminated schema keyed by `type`.
- `HIGH` `src/types/canvas.ts`: type guards are unsound. `isNoteContent()` returns true for any object with `text`, and `isTextContent()` requires `fontSize`, so valid text items without `fontSize` disappear or get misclassified. Fix: make content validation and runtime guards use the same explicit discriminators.
- `HIGH` `src/features/canvas/components/CanvasItemLayer.tsx`: TEXT rendering depends on `isTextContent(item.content)`, so valid TEXT items without `fontSize` do not render. Fix: fix the guard and add rendering tests for minimal TEXT payloads.
- `HIGH` `src/app/api/v1/canvases/[canvasId]/versions/route.ts`, `src/lib/hooks/use-canvas-versions.ts`, `src/features/canvas/hooks/use-canvas-data.ts`: the time-machine contract is broken. The versions API GET returns only `id`, `name`, and `createdAt`, but frontend code expects `snapshot` data. Fix: either return snapshot summaries where needed or remove the snapshot-dependent UI path.
- `HIGH` `src/lib/hooks/use-canvas-versions.ts`, `src/features/canvas/components/VersionHistoryDialog.tsx`: version restore invalidates the wrong query keys for items and canvas detail. The UI can stay stale after restore. Fix: standardize query-key factories and invalidate via those factories only.
- `HIGH` `src/lib/services/templates.ts`, `src/features/canvas/components/TemplatesGallery.tsx`, `src/app/api/v1/templates/*`: there are multiple incompatible template models in the repo. One service uses `x/y`; the canvas runtime uses `positionX/positionY`; built-in note templates include `title` even though `NoteContent` only supports `text`; the canvas dialog uses hardcoded local templates instead of the backend template system. Fix: define one template schema and remove or migrate the legacy one.
- `HIGH` `src/app/api/v1/templates/route.ts`: "save as template" mutates the original canvas in place instead of cloning it. That means a live user canvas becomes a template object. Fix: create a separate template record/canvas copy instead of reclassifying the source canvas.
- `HIGH` `src/app/api/v1/templates/[templateId]/route.ts`: the template update/delete route does not require `isTemplate` to be true. It can mutate ordinary owned canvases through a template endpoint. Fix: enforce `canvas.isTemplate` for template-only routes.
- `HIGH` `src/app/api/v1/canvases/[canvasId]/route.ts`: canvas PATCH accepts any `workspaceId` without checking that the workspace belongs to the same user. A user who knows another workspace ID can attach their canvas to it. Fix: validate workspace ownership before writing the foreign key.
- `MEDIUM` `src/features/canvas/hooks/use-canvas-data.ts`, `src/app/api/v1/search/route.ts`: client-side filtering and server-side search snippets only really handle notes, bookmarks, and images. TEXT and newer item types are partially or fully excluded. Fix: define searchable content extraction per item type in one shared utility and reuse it on both client and server.
- `MEDIUM` `src/app/api/v1/templates/[templateId]/route.ts`: template `PUT` writes `isPublic` directly to the canvas `isPublic` flag, which is also used for public canvas sharing. That mixes template visibility with canvas share visibility. Fix: split template visibility into a dedicated field.
- `MEDIUM` `src/app/api/v1/canvases/route.ts`, `src/app/api/v1/workspaces/route.ts`, `src/app/api/v1/templates/route.ts`, `src/app/api/v1/search/route.ts`, `src/app/api/v1/items/[itemId]/comments/route.ts`: several list endpoints use raw `parseInt()` without guarding `NaN`. Invalid query params can turn into runtime errors or invalid Prisma inputs. Fix: validate query params with `z.coerce.number()` and explicit bounds.

## Frontend Runtime Logic and Async Issues

- `HIGH` `src/features/canvas/components/CanvasBoard.tsx`: `updateItem` is destructured from `useUpdateCanvasItem()` as `mutate`, but the autopilot loop uses `await updateItem(...)`. That `await` does not wait for network completion, so sequencing assumptions are false. Fix: use `mutateAsync` where ordering matters.
- `HIGH` `src/features/canvas/components/CanvasBoard.tsx`: several handlers call `mutateAsync` functions without `await` or `.catch()`, including note creation, duplication, and menu deletion flows. These can surface as unhandled promise rejections with no user feedback. Fix: either `await` them with error handling or intentionally fire-and-forget with `void` plus centralized error handling.
- `MEDIUM` `src/features/canvas/components/CanvasBoard.tsx`: the distribute algorithm updates the last item too because it checks `index < selectedItems.length` instead of excluding the last index. Fix: use `index < selectedItems.length - 1`.
- `MEDIUM` `src/features/canvas/hooks/use-canvas-data.ts`: canvas metadata is fetched outside TanStack Query even though the rest of the canvas state uses Query. This creates extra requests and stale-state risk after restore/rename/share changes. Fix: move canvas metadata into a proper query with shared invalidation.
- `MEDIUM` `src/features/canvas/components/CanvasBoard.tsx`: item placement math is inconsistent with zoom. `handleAddNoteFromAI()` converts screen coordinates by `zoom`, but `handleSelectTemplate()`, `handleWhisperSend()`, and `handleAddSerendipityItems()` do not. Fix: centralize screen-to-canvas coordinate conversion and use it everywhere items are created.
- `MEDIUM` `src/app/share/[token]/page.tsx`: the public share page only renders NOTE and BOOKMARK items. IMAGE, TEXT, DRAWING, SHAPE, FRAME, EMBED, POLL, and connections are silently missing from the shared view. Fix: create a read-only renderer that supports the full canvas item set.

## Reliability, Resource, and Performance Risks

- `HIGH` `src/lib/services/search.ts`: `createDebouncedSearch()` leaves older returned promises unresolved when a later call clears the timer. That is a real dangling-promise bug and can leak waiting UI states. Fix: reject or resolve superseded calls explicitly.
- `MEDIUM` `src/lib/utils/ssrf-protection.ts`: `safeFetch()` does not clear the timeout in every failure path because the timer is cleared only after a successful `fetch()` return. Fix: wrap the timed fetch block in `try/finally`.
- `MEDIUM` `src/lib/rate-limit/index.ts`, `src/lib/rate-limit/stores/memory.ts`, `src/lib/api/session-cache.ts`, `src/lib/collaboration/yjs-provider.ts`: several subsystems fall back to in-memory behavior that is not multi-instance safe. That includes rate limiting, request-session caching assumptions, and live collaboration state. Fix: document which services require Redis or another shared backend in production, and fail fast when the dependency is mandatory.
- `MEDIUM` `src/app/api/v1/canvases/[canvasId]/thumbnail/route.ts`: thumbnails are accepted as arbitrary `data:image/*` strings with no size bound and then stored directly in the database. This can bloat rows and responses. Fix: validate actual size/type and move thumbnails to object storage if they are meant to persist.
- `MEDIUM` `src/lib/email/providers/smtp.ts`, `src/lib/email/index.ts`: SMTP is presented as a supported provider, but the implementation is still a stub that always throws unless someone manually installs and wires `nodemailer`. Fix: either finish the provider or remove `smtp` from advertised production options.

## Checked and Not Verified as Problems

- Import-graph scan found no verified multi-file circular imports in the current source set.
- `tsc --noEmit` passed, so there are no currently verified broken module paths or references to missing symbols at the TypeScript level. The bigger problems here are runtime logic, deployment drift, and contract mismatches.

## Recommended Remediation Order

1. Fix the hard deployment blockers first: `next.config.mjs`, the production hosting model, object storage, and the broken start script.
2. Untangle template/public-sharing semantics next. Right now this is the largest privacy and authorization problem in the repo.
3. Unify write concurrency: atomic optimistic locking, idempotency recovery, and one version authority between REST and Yjs.
4. Repair the versioning/template/frontend contract drift so the UI matches what the APIs actually return.
5. Apply production-grade security controls: email normalization, actual rate limiting, API-key pre-auth throttling, CORS fix, and removal of public email leakage.
6. Only after the above, tune the lower-level reliability issues like debounced search promises, thumbnail storage, and optional-provider cleanup.

## Product Direction Proposal: User Graph + Agent Graph

### Working Product Definition

The core idea still makes sense:
- This is a visual personal knowledge canvas.
- Users place notes, links, files, text blocks, images, and connections on a canvas.
- The canvas acts like a personal mesh or graph of context, not just a whiteboard.
- Grouping, clustering, linking, and spatial organization are central to the product.

The new direction should not replace that. It should add a second operating mode:
- `Manual Graph`: user-organized, direct manipulation, canonical visual workspace.
- `Agent Graph`: LLM-organized, derived structure generated from user data and external agent actions.

That is the right split for this codebase. Do not let the agent layer overwrite the raw user layer by default.

### Recommended Product Model

The app should evolve into a `personal memory graph` with two views over the same underlying knowledge:

1. `User Workspace`
   - The user adds notes, links, files, bookmarks, and relationships manually.
   - This remains the source of truth for raw captured information.

2. `Agent Workspace`
   - An assistant organizes the same material into semantic nodes such as:
     - projects
     - people
     - tasks
     - meetings
     - reminders
     - calendar intents
     - decisions
     - follow-ups
   - This view can be fully automatic or copilot-assisted.

3. `External Agent Integration Layer`
   - External assistants like OpenClaw, WhatsApp bots, or future agent systems can create notes, propose structure, update tasks, and trigger workflows through your API.
   - Users bring their own model keys and choose which provider powers their assistant.

The important design decision is this:
- Raw captured items and agent-derived organization should be separate layers.
- Agents should create `derived nodes`, `links`, `tasks`, `calendar actions`, and `proposals`, not mutate arbitrary user notes silently.

### What Not To Do

Do not start by adding "AI auto-organize" directly inside the current canvas item model only.

That would fail for three reasons:
- The current item model is already too loose and has contract drift.
- LLM outputs are probabilistic and need auditability.
- External assistants need structured actions, not just random canvas mutations.

Instead, treat the current canvas as the capture and display layer, and add a proper agent-memory layer beside it.

## Recommended Architecture for the New Feature

### 1. Keep Raw Notes and Agent Structures Separate

Add a new logical split in the data model:
- `Source Items`
  - existing canvas items, files, links, notes, uploads
  - user-created or integration-created raw inputs
- `Derived Entities`
  - semantic nodes inferred by agents
  - examples: `Project`, `Task`, `Person`, `Event`, `Reminder`, `Topic`, `Goal`
- `Derived Relations`
  - typed edges such as `belongs_to`, `mentions`, `blocks`, `scheduled_for`, `related_to`
- `Agent Actions`
  - proposed or executed actions like `create_calendar_event`, `add_reminder`, `tag_note`, `move_item_to_group`

This gives you:
- a stable user-owned raw layer
- an auditable machine-generated layer
- a clean way to show multiple views of the same information

### 2. Add Two Tabs or Modes, Not Two Separate Products

Recommended UI:
- `Canvas`
  - current manual board
- `Organized`
  - graph or list view of agent-generated nodes and clusters
- `Inbox`
  - recent captured items from app and integrations
- `Actions`
  - pending or recently executed assistant actions

Recommended first implementation:
- Keep the existing canvas page.
- Add a second page/tab for `Organized View`.
- Do not try to make the first version of agent organization fully spatial and freeform.
- Start with clustered graph + side panels + filters, then later allow sync back into the spatial canvas.

### 3. Use an Event-Driven Agent Pipeline

The right backend shape is:

`Capture -> Normalize -> Store -> Classify -> Derive -> Propose/Execute`

Concretely:
1. User or external bot creates a note/input.
2. Store the raw item exactly as received.
3. Emit an internal event such as:
   - `note.created`
   - `bookmark.created`
   - `file.uploaded`
   - `external.message.received`
4. Queue an agent job.
5. Agent reads recent relevant context and produces:
   - entity extraction
   - relation extraction
   - summary
   - task/reminder/calendar intent
   - suggested grouping
6. System stores those outputs as derived records.
7. If action execution is enabled, create an action record:
   - proposed
   - approved
   - executed
   - failed

Do not make user-facing note creation wait on LLM calls.

### 4. Add a Provider Abstraction for BYOK

You want users to choose their own LLM provider. Build that in explicitly.

Recommended abstraction:
- `ModelProvider`
  - OpenAI
  - Anthropic
  - Google
  - OpenRouter-compatible
  - local/self-hosted OpenAI-compatible endpoint

Provider config should include:
- provider id
- base URL
- model id
- API key reference
- enabled tools/capabilities
- cost guardrails
- timeout and retry policy

Do not spread provider-specific logic across routes.

Create one service layer such as:
- `src/lib/agents/providers/*`
- `src/lib/agents/runtime/*`
- `src/lib/agents/tools/*`

### 5. Treat Assistants as Tool-Using Workers, Not Just Chatbots

The assistant should be able to operate on structured tools:
- create note
- update note
- create task
- create reminder
- create calendar intent
- link item to entity
- tag item
- move item into a group
- search memory
- fetch recent notes
- retrieve project context

That means your main abstraction should be:
- `agent runtime + tool registry`

not
- `prompt in, paragraph out`

This is the right direction if you want OpenClaw-like agents to interact with the app.

## Recommended Data Model Additions

Add new tables or equivalent models for:

- `KnowledgeEntity`
  - `id`
  - `userId`
  - `type`
  - `title`
  - `summary`
  - `status`
  - `attributes` JSON
  - `sourceConfidence`
  - `createdBy` (`user` | `agent` | `integration`)
  - `agentRunId?`

- `KnowledgeRelation`
  - `id`
  - `userId`
  - `fromEntityId`
  - `toEntityId`
  - `relationType`
  - `weight/confidence`
  - `agentRunId?`

- `ItemEntityLink`
  - link raw canvas items to derived entities
  - one raw note can map to multiple derived nodes

- `AgentProfile`
  - assistant name
  - provider config reference
  - enabled tools
  - policy mode
  - automation level

- `ModelCredential`
  - encrypted provider key metadata
  - provider type
  - owner user id
  - never log raw secrets

- `AgentRun`
  - input scope
  - provider/model used
  - prompt version
  - status
  - token/cost metadata
  - output summary
  - errors

- `AgentAction`
  - proposed action
  - target system
  - payload
  - review status
  - execution status
  - audit trail

- `IntegrationAccount`
  - WhatsApp/OpenClaw/external bot identity
  - webhook secret or token metadata
  - permission scope
  - last sync

- `IntegrationEvent`
  - raw inbound message/event payload
  - normalized command/result
  - replay protection

This is the minimum structure needed to make the assistant layer durable and auditable.

## External Agent and Bot Integration Strategy

### Primary Idea

Do not integrate only with "a specific bot".
Build a generic `assistant integration API` so OpenClaw is one consumer of it.

Recommended external API capabilities:
- ingest note/message
- fetch recent notes
- fetch context by project/topic/entity
- create task/reminder/calendar intent
- link or classify an item
- query pending actions
- confirm/approve action execution

Example flow:
1. User sends WhatsApp message to OpenClaw.
2. OpenClaw decides it should store or organize something.
3. OpenClaw calls your ingestion endpoint.
4. Your system stores the message as a raw note plus metadata:
   - source = whatsapp
   - actor = external agent
   - timestamp
   - thread/conversation id
5. Your agent pipeline derives tasks, meetings, reminders, and links.
6. If it wants calendar changes, it creates an `AgentAction`.
7. Depending on user policy:
   - auto-execute
   - require approval
   - save as draft only

### Integration Modes

Support three modes:

1. `Write to Inbox`
   - safest first step
   - external agents can only create notes/items

2. `Propose Organization`
   - agents can classify, link, and suggest actions
   - user approves execution

3. `Execute Actions`
   - agents can create reminders/calendar entries/update structured entities
   - reserved for trusted integrations and explicit user policy

Start with mode 1 and 2 only.

## BYOK Strategy

### Core Recommendation

BYOK should be per user, per provider, and optionally per assistant.

Each user should be able to:
- connect one or more providers
- choose default provider
- choose which model powers which assistant
- set usage caps
- disable automation per assistant

### Security Requirements

Do not ship BYOK until these are true:
- secrets are encrypted at rest
- secrets are never returned after save
- secrets are redacted from logs
- model calls are rate-limited and audited
- provider access is isolated by user id

Recommended rules:
- store encrypted credentials, not plaintext
- use a server-managed encryption key or KMS
- show only masked provider configuration in UI
- attach every provider call to `userId`, `assistantId`, and `agentRunId`

## Agent Policy Model

You need a permissions model for assistants, not just auth.

Recommended policy fields per assistant:
- can read all notes?
- can read only tagged scopes or selected canvases?
- can create notes?
- can create derived entities?
- can modify existing user notes?
- can create reminders/calendar intents?
- can execute external actions automatically?
- requires approval for destructive or high-impact actions?

Recommended default:
- read selected canvases
- create inbox notes
- create derived entities
- propose tasks and calendar actions
- no silent mutation of user-authored notes
- no automatic external side effects without approval

## UI Strategy

### Phase 1 UI

Add:
- `Assistant Settings`
  - provider config
  - BYOK
  - automation policy
- `Inbox`
  - recent captures from user and external agents
- `Organized View`
  - derived graph of projects, tasks, people, events
- `Actions Panel`
  - pending assistant actions and execution history

Do not start with:
- full autonomous multi-agent orchestration UI
- multi-provider live switching inside every canvas interaction
- complex spatial auto-layout editing inside the current Konva board

### How the Views Should Relate

The user should be able to:
- click a note on the canvas and see which entities it contributed to
- click a derived entity and see the raw notes behind it
- accept or reject suggested classifications
- pin an agent-generated cluster back into a manual canvas if desired

That connection between raw and derived layers is what makes the product valuable.

## API Strategy

Add a new API family instead of overloading current canvas endpoints:

- `/api/v1/agents/*`
  - manage assistants
  - trigger runs
  - inspect run history

- `/api/v1/knowledge/*`
  - derived entities
  - derived relations
  - graph queries

- `/api/v1/integrations/*`
  - inbound ingestion
  - webhook registration
  - external identity mapping

- `/api/v1/actions/*`
  - proposal queue
  - approvals
  - execution history

- `/api/v1/providers/*`
  - BYOK provider management

Keep `/api/v1/canvas-*` focused on the manual visual workspace.

## Agent-Safe Versioning and Rollback

This needs a real rollback system before bots are allowed to organize anything important.

The correct mental model is `git-inspired history`, not just a weak "save version sometimes" feature:
- every meaningful automated change should create a commit-like record
- every bot run should be reversible
- users should be able to inspect what changed before reverting it
- bots should preferably work in a draft layer before touching the main workspace

Do not reuse the current canvas version feature as-is for this. The current versioning implementation is already inconsistent and too narrow for agent automation.

### What the rollback unit should be

The primary rollback unit should be:
- `AgentRun`
  - one assistant session or automation job
- `ChangeSet`
  - all internal writes produced by that run
- `ChangeRecord`
  - row-by-row or entity-by-entity before/after diff

That gives you three useful recovery modes:
1. `Revert one action`
   - undo a single assistant action such as "created 3 tasks"
2. `Revert one run`
   - undo everything a bot did in one run
3. `Restore checkpoint`
   - restore the full workspace or graph to a named earlier state

### Recommended versioning model

Add history models such as:
- `WorkspaceCheckpoint`
  - full snapshot of a workspace scope
  - created manually, before major bot runs, and on schedule
- `ChangeSet`
  - commit metadata
  - actor type: `user` | `agent` | `integration`
  - actor id
  - provider/model used
  - createdAt
  - status: `applied` | `reverted` | `partial_failed`
  - parent checkpoint/version reference
- `ChangeRecord`
  - target type: canvas item, entity, relation, action, reminder, calendar intent
  - target id
  - operation: `create` | `update` | `delete`
  - before JSON
  - after JSON
  - reversible flag
- `RollbackRun`
  - tracks explicit revert operations and whether they succeeded

This is the important split:
- checkpoints are coarse-grained recovery
- change sets are fine-grained git-like history

### How bot changes should execute

Rules for agent writes:
- before a bot run starts, create a checkpoint if the run can touch more than trivial metadata
- group all internal writes from one bot run under one `ChangeSet`
- store `before` and `after` state for every changed record
- apply the internal changes transactionally where possible
- only mark the run `applied` after all internal writes succeed

For external side effects:
- never mix external side effects and internal commit semantics blindly
- a calendar write, email send, or webhook call should be a separate action record
- internal graph changes can be reverted
- external side effects may need compensating actions rather than simple rollback

### Branches and preview mode

The safest product behavior is:
- bots organize in a `draft branch` or `preview layer`
- the user reviews the diff
- the user merges or rejects the proposal

You do not need full git branching on day one, but you do need the equivalent concept:
- `live workspace`
- `agent draft`
- `merge/apply`
- `revert`

This is especially important for:
- bulk reorganization
- retagging many notes
- calendar and reminder extraction
- external-assistant ingestion

### UI requirements

Add a visible `History` or `Timeline` surface with:
- actor
- provider/model
- source integration
- timestamp
- affected records count
- diff summary
- `Revert` button
- `Restore checkpoint` button

Users should be able to answer:
- what did the bot just change?
- what source notes caused that change?
- can I undo only this run?
- can I go back to the state from yesterday?

### Recommended safety policy

Default automation policy should be:
- all bot runs are logged
- all bot runs create reversible change sets
- high-impact runs create a checkpoint first
- bulk reorganizations run in preview mode first
- destructive changes require approval

### Best implementation order

Before external assistants get broad write access, implement:
- workspace checkpoints
- change sets
- change records
- rollback execution
- history UI

Without that, agent automation will become operationally unsafe very quickly.

## Recommended Rollout Plan

### Phase A: Stabilize the Existing Product

Before this new feature, fix the blockers already documented above:
- build/deploy alignment
- template/privacy bugs
- optimistic locking
- data contract drift

Without that, adding agents will multiply instability.

### Phase B: Build the History and Recovery Layer

Implement:
- `WorkspaceCheckpoint`
- `ChangeSet`
- `ChangeRecord`
- `RollbackRun`
- history/timeline UI

This should come before broad bot write access.

### Phase C: Build the Knowledge Layer

Implement:
- `KnowledgeEntity`
- `KnowledgeRelation`
- `ItemEntityLink`
- `AgentRun`
- `AgentAction`

Then add:
- background job runner
- ingestion events
- simple rule-based plus LLM classification pipeline

### Phase D: BYOK + Provider Runtime

Implement:
- provider abstraction
- encrypted credential storage
- model call audit log
- per-user assistant settings

Start with one provider first even if the abstraction supports many.

### Phase E: External Assistant API

Implement:
- API keys or OAuth-style integration auth
- note ingestion endpoint
- agent action proposal endpoint
- replay protection and event signing

This is where OpenClaw-style integrations plug in.

### Phase F: Organized View

Implement:
- graph/list view over derived entities
- filters by entity type
- traceability from entity back to source notes
- action approval UX

### Phase G: Automation

Only after the above:
- calendar integration
- reminder sync
- auto-scheduled jobs
- agent-generated maintenance and organization runs

## Strong Recommendation on Calendar/Task Execution

For actions like "add recent notes to calendar":
- do not let the LLM directly call calendar APIs from first release
- have the LLM produce a structured action proposal
- validate it server-side
- optionally require user approval

This protects against:
- hallucinated dates
- duplicate actions
- malformed payloads
- silent external side effects

## Best Fit for This Project

The strongest version of this product is not "a canvas with some AI buttons".

It is:
- a visual personal memory graph
- with a user-owned manual layer
- an agent-organized semantic layer
- and a secure integration surface for external assistants using BYOK providers

That direction is coherent with the current canvas concept and gives the app a clear role in an agent ecosystem:
- humans capture and inspect
- agents organize and propose
- the system preserves traceability between raw notes, derived structure, and executed actions
