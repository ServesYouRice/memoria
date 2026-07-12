# Correctness and data-integrity audit

## Release-blocking findings

### COR-01 — Approved agent actions can execute more than once

**Severity:** Critical

The action route reads an APPROVED suggestion, performs the requested write/webhook, and only then calls `markSuggestionExecuted` (`src/app/api/agent/v1/actions/route.ts:415`, `:446`, `:493`, `:538`, `:565-576`). The marker is a conditional update from APPROVED to EXECUTED (`src/lib/agents/service-core.ts:1022-1035`), but its result count is ignored and the claim happens after the side effect.

Two concurrent requests can both observe APPROVED and both create/batch-update/send the webhook. The later conditional marker does not undo the duplicate.

**Fix:** add an atomic APPROVED → EXECUTING claim with a lease/attempt ID; proceed only when exactly one row was claimed; make writes and job state transactional where possible; require an idempotency key for external delivery; finalize EXECUTED/FAILED with durable retry semantics.

### COR-02 — Real-time item collaboration and cursors are not connected to the canvas

**Severity:** High product blocker

`useCollaboration` returns a Y.Doc and `updateCursor` (`src/lib/hooks/use-collaboration.ts:36-42`, `:254-289`), but `CanvasBoard` destructures neither one (`src/features/canvas/components/CanvasBoard.tsx:394-405`). Item reads/writes continue through React Query/REST, and no binding copies REST state into the Y.Doc or applies remote Yjs items to React state. The optional polling hook is not used either.

Consequences:

- a second user's open canvas does not receive item creates/edits/deletes in real time;
- the client never emits cursor positions, so the advertised live cursors/follow mode have no source;
- Yjs persistence remains a separate, mostly attacker/raw-client-only write authority;
- presence, transient chat, and reactions are the only live pieces.

Choose one authoritative model. If Yjs remains, bind item state explicitly, perform server-side authorization/validation, reconcile snapshots and versions, and test two clients plus two server instances. Otherwise remove/disable item Yjs persistence and accurately scope the feature claim.

### COR-03 — Global mutation retry can duplicate side effects

**Severity:** High

React Query globally retries every mutation once (`src/app/providers.tsx:41-43`). Client hooks do not attach `x-idempotency-key`; repository search finds the key only in server infrastructure/docs. A timeout after a successful POST can therefore create a second canvas, item, comment, API key, template, workspace, integration, or agent action.

Some endpoints support `runIdempotent`, but it is inactive without a header. Many other mutation endpoints do not use it at all.

**Fix:** default mutations to `retry: false`; opt in only for operations known to be idempotent; generate a stable key per logical create and retain it across retry; bind a request-body hash to stored idempotency records.

### COR-04 — Core pan state is not synchronized and conflicts with selection

**Severity:** High

The Stage is always draggable unless drawing, Space is held, or Time Machine is active (`src/features/canvas/components/CanvasBoard.tsx:937`). It has no Stage `onDragMove`/`onDragEnd` handler, so Konva changes its internal position while React `position` remains stale. Selection coordinate math uses that stale position (`src/features/canvas/hooks/use-canvas-interaction.ts:39-82`). A background mouse-down also starts a selection at the same time the Stage can drag.

Any rerender can reset the Stage to the old prop position, item placement/selection can be offset, and pressing Space disables rather than enables the common pan gesture. There is also no wheel handler in `CanvasBoard`; only header buttons and pinch change zoom.

Make pan an explicit controlled interaction: enable drag only in pan/Space mode, update React state during/end of drag, suppress selection while panning, add wheel zoom around the pointer, and cover it with interaction tests.

## High-priority correctness findings

### COR-05 — Zoom/pan are loaded but never saved

`useCanvasData` initializes local zoom/pan from the canvas (`src/features/canvas/hooks/use-canvas-data.ts:84-92`) but returns raw setters and never calls the canvas PATCH endpoint for navigation changes. A metadata refetch re-runs the effect and jumps the user back to stored values. The API and schema expose persistent `zoomLevel/panX/panY`, so current behavior contradicts the data model.

Debounce a dedicated viewport mutation or explicitly make viewport per-device/local; do not overload shared canvas metadata.

### COR-06 — REST and Yjs can overwrite each other with stale item snapshots

Yjs loads a full item snapshot from the database, then persists every field of any dirty item. REST updates do not update the Y.Doc. A later Yjs change to one field rewrites content, geometry, tags, and attribution from the stale document and increments the version independently. On multiple instances, Redis-applied updates are observed as dirty because only origin `persist` is ignored (`src/lib/collaboration/yjs-provider.ts:59-84`, while Redis applies origin `redis` at `src/lib/collaboration/websocket-server.ts:300`). Multiple instances can persist the same change and increment versions repeatedly.

Unify the authority/merge policy and mark remote replicated persistence origins so only one durable writer commits a logical update.

### COR-07 — Version restore creates an ABA concurrency problem

Restore writes each snapshot's historical `version` back into the live record (`src/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route.ts:138-166`). A stale client holding that same historical version can then satisfy optimistic concurrency and overwrite the restored state. Restore should create a new monotonic version, never move the concurrency token backward.

The legacy restore path also hard-deletes all items (`:100-118`), cascading comments/connections and turning a view-state operation into irreversible data loss.

### COR-08 — Template use is a non-atomic two-step create

`POST /templates/[templateId]/use` creates a canvas, then separately increments template usage (`src/app/api/v1/templates/[templateId]/use/route.ts:51-84`). If the increment fails, the endpoint returns an error after the canvas already exists; the global mutation retry can create another copy.

Wrap both operations in one transaction and use a client idempotency key.

### COR-09 — Normal registration does not create the Inbox required by integrations

The bootstrap path creates starter resources, but standard registration does not create a Personal workspace/Inbox. Integration ingest without a `canvasId` only searches for a canvas literally named `Inbox` and fails if absent (`src/app/api/agent/v1/integrations/ingest/route.ts:37-60`). Thus the documented default ingest flow does not work for ordinary registered users.

Create system resources transactionally at registration or have ingest create a scoped Inbox safely.

### COR-10 — Notifications/activity feed has no producers

`logActivity` is the only `prisma.activity.create` call (`src/lib/activity.ts:32-47`), and it has no call sites. The dashboard feed and Notifications page read the table but normal canvas/item/share/comment operations never write it. The feature will remain empty outside seed/manual data.

Emit activities transactionally/outbox-backed for the intended events, define recipient semantics (actor vs canvas owner/collaborators), and add feed pagination/read state.

### COR-11 — Canvas UI ignores the user's role

Canvas data includes ownership and the current user's share role, but `CanvasBoard`, `useCanvasData`, and `CanvasHeader` contain no owner/edit/comment/view gating. A viewer/commenter sees create, edit, delete, share, rename, version restore, AI-add, template, autopilot, thumbnail, and other controls. The server rejects many of them only after interaction.

Derive a capability object once and use it to disable/hide controls and prevent local optimistic changes. Keep server checks as the final authority.

### COR-12 — Shared editors repeatedly attempt an owner-only thumbnail write

Every item-list change schedules a thumbnail upload (`src/features/canvas/components/CanvasBoard.tsx:537-542`), while the thumbnail API permits only the owner (`src/app/api/v1/canvases/[canvasId]/thumbnail/route.ts:25-37`). An EDIT collaborator's successful edit therefore triggers a predictable failing mutation (and the global retry), generating noise and stale thumbnails.

Gate generation to the owner or move thumbnail rendering to a server-side job.

### COR-13 — Account deletion can fail on collaborator-created items

The deletion route removes items only from canvases owned by the deleting user, then deletes the User. `CanvasItem.createdById` is required and restrictive. Items the user created in someone else's shared canvas remain and can block the transaction. See `SEC-23` for the privacy/lifecycle gaps.

Define whether those items are deleted or reassigned to a tombstoned actor and cover the cross-owner case in an integration test.

## Other validated correctness issues

| ID | Severity | Finding | Evidence / recommended correction |
|---|---|---|---|
| COR-14 | High | Bookmark refresh breaks optimistic concurrency. | `src/app/api/cron/refresh-bookmarks/route.ts:64-83` changes content/`updatedAt` without incrementing item `version` or setting `updatedById`. Use the same versioned write service as normal edits. |
| COR-15 | Medium | Bookmark refresh discards metadata changes unless the title changed. | Description/image are written only inside `oldTitle !== newTitle`; unchanged title merely touches `updatedAt`. Compare each field and record bounded history. |
| COR-16 | Medium | Failed bookmarks can starve the entire refresh queue. | The oldest ten are selected; failed fetches `continue` without touching scheduling state, so the same ten can be selected forever. Add `nextAttemptAt`, attempts, exponential backoff, and terminal failure state. |
| COR-17 | Medium | Refresh includes soft-deleted bookmarks and unbounded history. | The query has no `deletedAt: null`; `content.history.push` grows forever. Exclude deleted rows and move bounded history to a normalized audit table. |
| COR-18 | Medium | List query parsing accepts `NaN` and negative pagination in several routes. | Canvas/workspace/template/search/activity/agent routes use `parseInt` plus only `Math.min`; malformed values reach Prisma/raw SQL. Use shared Zod coercion with finite integer min/max. |
| COR-19 | Medium | Canvas list silently hides records after the first page. | API defaults to a limited page; Dashboard calls `useCanvases()` once and exposes no next-page control. Add cursor pagination/infinite loading and show total state. |
| COR-20 | Medium | Comments stop at the first page. | API returns `hasMore` (`src/app/api/v1/items/[itemId]/comments/route.ts:209-226`), but `use-comments`/CommentsPanel has no load-more path. Use an infinite query. |
| COR-21 | Medium | Workspace-filtered “New canvas” creates an unassigned canvas. | Dashboard create sends only a name even when a workspace filter is active. Pass `workspaceId` or clearly create in Unassigned. |
| COR-22 | Medium | Workspace deletion is not atomic with canvas unassignment. | The route unassigns canvases and deletes the workspace in separate calls. Use a transaction and define concurrent assignment behavior. |
| COR-23 | Medium | Public/share role revocation does not terminate live chat/reaction access. | This is the user-visible consequence of `SEC-03`; publish revocation to sockets and close/downgrade them. |
| COR-24 | Medium | Canvas thumbnail endpoint accepts unbounded data URLs. | It checks only string type and `data:image/` prefix (`src/app/api/v1/canvases/[canvasId]/thumbnail/route.ts:40-54`). A huge body bloats Postgres, cache, and list responses. Enforce MIME, decoded-byte, dimensions, and fixed output size. |
| COR-25 | Medium | Private/public template update fields have no useful caps. | `updateTemplateSchema` leaves name/description/category/thumbnail unbounded. Reuse creation limits and the thumbnail policy. |
| COR-26 | Low | `Canvas.itemCount` is an unmaintained denormalized field. | It defaults to zero and has no mutation writers. Remove it or update it transactionally; do not expose it as authoritative. |
| COR-27 | Medium | Serendipity can return soft-deleted items. | `src/lib/ai/serendipity-service.ts` filters type/content but not `deletedAt`. Apply active-record filtering and explicit access policy. |
| COR-28 | Medium | AI summary includes soft-deleted items. | `src/app/api/v1/ai/summarize/route.ts:12-14` uses `items: true`. Filter active items and make external data disclosure explicit. |
| COR-29 | Medium | Idempotency replays are not bound to the request body. | `runIdempotent` scopes by key/user/method/path only. Reusing a key with different JSON silently returns the old response. Store/compare a canonical body hash. |
| COR-30 | Medium | Idempotency cleanup is not implemented. | Rows have a TTL interpretation and index but no cleanup job; stale rows are deleted only when that exact key is reused. Add scheduled retention cleanup. |
| COR-31 | Medium | Metadata persistence can turn a successful side effect into a 500. | `runIdempotent` executes the handler, then must clone/store its response. A DB failure at that point surfaces failure after the underlying mutation succeeded. Treat response journaling as part of the transaction or return success with repair telemetry. |
| COR-32 | Low | Canvas view PUT requires only VIEW, despite being a write. | It writes a user-owned preference, so this is not cross-tenant corruption, but naming it VIEW permission obscures policy. Use a separate “save own view” capability. |

## Data-model strengths

- Core REST item updates use a version check and report conflict.
- Item connections verify both endpoints belong to the route canvas.
- Most ownership/share checks are centralized and consistently applied.
- Current migrations include the baseline, agent foundation, and knowledge relations; the missing-migrations claim in the reference audit is obsolete.
