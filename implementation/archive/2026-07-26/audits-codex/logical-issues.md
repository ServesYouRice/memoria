# Application Logic and Data-Integrity Audit

## Findings

### LOG-01 — Collaborators do not receive other users’ item edits

- **Severity:** High
- **Location:** `src/features/canvas/hooks/use-canvas-data.ts`, `src/lib/hooks/use-canvas-items.ts`, `src/lib/hooks/use-collaboration.ts`, `src/lib/collaboration/websocket-server.ts`
- **Description:** The live canvas calls `useCanvasItems`, not the available polling hook. Global queries are fresh for five minutes and do not refetch on focus. WebSockets only transport presence, cursors, chat, and reactions; binary/item updates are explicitly rejected. No active mechanism invalidates another client’s item query after a REST write.
- **Why it matters for production:** Two editors can work on stale canvases for minutes, overwrite each other through optimistic-concurrency conflicts, and believe “real-time collaboration” is functioning because cursors remain live.
- **Recommended fix:** Choose one supported synchronization contract: publish validated item events after committed REST mutations and invalidate/merge by version, or implement actor-attributed schema-validated CRDT patches. Until then, enable bounded polling for shared canvases and present conflicts explicitly.
- **Blocker before production:** Yes for multi-user collaboration.
- **Related risks or dependencies:** Cross-instance fanout must cover item events; add two-client and two-instance tests (`TEST-04`).

### LOG-02 — Autosave can strand or lose changes while a save is in flight

- **Severity:** High
- **Location:** `src/lib/hooks/use-autosave.ts`
- **Description:** A timer that fires during `isFlushingRef` returns without rescheduling; pending changes remain forever unless another edit occurs. Unmount flush also returns when a request is in flight. Changes are removed from the pending buffer before the request and are not restored on error.
- **Why it matters for production:** Normal rapid typing/dragging or navigation can silently lose the most recent edits even without a server bug.
- **Recommended fix:** Implement a serialized save queue: merge new deltas while a request is active, flush again in `finally`, retain failed deltas, advance from the server-returned version, and expose a promise that unload/navigation can await or warn about.
- **Blocker before production:** Yes.
- **Related risks or dependencies:** UI save-state requirements are in `UI-07`; add deterministic fake-timer tests for in-flight edits, failure, retry, and unmount.

### LOG-03 — Failed optimistic item updates are not rolled back

- **Severity:** High
- **Location:** `src/lib/hooks/use-canvas-items.ts` (`useUpdateCanvasItem`)
- **Description:** The mutation snapshots only the detail cache, while the active canvas uses list caches. `onMutate` modifies every list cache, but `onError` restores only a detail entry that usually does not exist. Non-version errors do not invalidate lists, and version-conflict recovery depends on matching an error-message string.
- **Why it matters for production:** Permission errors, validation failures, outages, and conflicts can leave the client displaying data that the server never accepted.
- **Recommended fix:** Snapshot and restore every touched query, use a typed error/status code for version conflicts, and always reconcile the affected canvas list after failure.
- **Blocker before production:** Yes because it compounds silent-save and read-only-role failures.
- **Related risks or dependencies:** Coordinate with `LOG-02` so queued deltas and cache rollback share one version source.

### LOG-04 — Movement persistence is inconsistent and can issue duplicate conflicting writes

- **Severity:** High
- **Location:** `CanvasItemLayer.tsx`, `BookmarkItem.tsx`, `ImageItem.tsx`, `DrawingItem.tsx`, `ShapeItem.tsx`, `ArrowItem.tsx`, `TextItem.tsx`, `FrameItem.tsx`, `EmbedItem.tsx`, `PollItem.tsx`
- **Description:** Bookmark and image items invoke both component autosave and the parent drag-end mutation, using the same old version. Drawing, shape, arrow, text, frame, embed, and poll items are draggable when selected but are not wired to a persistence callback. Note uses a third path.
- **Why it matters for production:** Dragging can create a guaranteed version race or appear to work and then snap back. This affects most supported item types.
- **Recommended fix:** Route all item geometry through one parent-owned serialized mutation path; pass a consistent `readOnly` and `onGeometryCommit` contract to every item; remove component-local duplicate writes.
- **Blocker before production:** Yes for the canvas editor.
- **Related risks or dependencies:** Add a parameterized test covering every `ItemType`, role, drag, resize, success, and conflict.

### LOG-05 — Undo/redo recreates deleted items with new identities and broken relations

- **Severity:** High
- **Location:** `src/features/canvas/components/CanvasBoard.tsx`, `src/lib/hooks/use-canvas-history.ts`
- **Description:** Delete undo recreates items through the create API instead of restoring original IDs. Connections, comments, creator metadata, knowledge links, and item-to-item references remain attached to the soft-deleted originals. Redo still targets old IDs/versions.
- **Why it matters for production:** A feature presented as recovery can corrupt graph semantics and make redo fail. Users may not notice until later.
- **Recommended fix:** Add an explicit restore endpoint that reactivates the original item with optimistic concurrency and restores dependent relations transactionally. Store returned versions/IDs in commands; disable undo/redo until command invariants are correct.
- **Blocker before production:** Yes unless undo/redo is removed from launch scope.
- **Related risks or dependencies:** Related known item `UX-03`; connections and knowledge entities need defined delete/restore semantics.

### LOG-06 — Duplicate and template flows copy stale item and upload references

- **Severity:** High
- **Location:** `src/app/api/v1/canvases/[canvasId]/duplicate/route.ts`, `src/app/api/v1/templates/route.ts`, `src/app/api/v1/templates/[templateId]/use/route.ts`
- **Description:** Cloned items receive new IDs, but arrow `startItemId`/`endItemId` values are not remapped. Image content keeps `/api/v1/uploads/{assetId}` pointing to an asset owned by the original canvas. Connections and comments are omitted. Duplicates also drop `workspaceId`.
- **Why it matters for production:** Arrows and images in duplicates/templates can point to the source, fail for public/template users, or break when the original canvas is deleted.
- **Recommended fix:** Clone in two passes inside a transaction: create target items, build old→new ID maps, rewrite typed content and connections, decide which metadata is copied, and copy/re-home upload objects with new `UploadAsset` rows.
- **Blocker before production:** Yes if duplicate/templates are launch features.
- **Related risks or dependencies:** Object-storage lifecycle is `SEC-03`; default template UI is `UI-09`.

### LOG-07 — Template canvases leak into normal canvas lists and “deletion” converts them into canvases

- **Severity:** Medium
- **Location:** `src/app/api/v1/canvases/route.ts`, `src/app/api/v1/templates/[templateId]/route.ts`
- **Description:** Canvas list/count queries do not exclude `isTemplate=true`, so saved templates appear on dashboard/workspace surfaces. Deleting a template only sets `isTemplate=false`, leaving it as a regular canvas.
- **Why it matters for production:** Counts, recency order, dashboard content, and user expectations diverge; “delete” does not delete.
- **Recommended fix:** Exclude templates from ordinary canvas queries by default. Define template deletion explicitly as hard delete, trash, or archive and name the UI accordingly.
- **Blocker before production:** No, but fix before broad template use.
- **Related risks or dependencies:** Migration/backfill may be needed for templates already converted by deletion.

### LOG-08 — Rich-text note HTML is stripped by server validation

- **Severity:** High
- **Location:** `src/lib/validation/canvas-item.ts` (`noteContentSchema`), `src/components/RichTextEditor.tsx`, note create/edit flows
- **Description:** The note schema transforms `text` with `sanitizePlainText`, removing markup produced by Tiptap. The landing page advertises rich text and the editor exposes formatting controls.
- **Why it matters for production:** Formatting disappears on save, so a visible core feature is functionally false and may cause content loss.
- **Recommended fix:** Define a constrained rich-text document format (preferably structured JSON, otherwise allowlisted HTML), sanitize it with one server/client policy, version the content schema, and migrate existing values.
- **Blocker before production:** Yes if rich text remains advertised/enabled; otherwise hide formatting until supported.
- **Related risks or dependencies:** Search/snippet extraction and export must understand the chosen representation.

### LOG-09 — Poll votes are non-atomic and client-authoritative

- **Severity:** High
- **Location:** `src/features/canvas/components/PollItem.tsx`, `src/lib/validation/canvas-item.ts`, `src/app/api/v1/canvas-items/[itemId]/route.ts`
- **Description:** A vote rewrites the complete poll content using a stale item version. Any editor can submit arbitrary voter ID arrays, add/delete other users’ votes, duplicate IDs, or inflate totals. Concurrent votes conflict rather than merge. Public output includes the raw voter-ID arrays.
- **Why it matters for production:** Poll results cannot be trusted, concurrent use loses votes, and internal user identifiers are unnecessarily disclosed.
- **Recommended fix:** Create an atomic vote endpoint keyed by authenticated user and option with transaction-level constraints. Return aggregate counts and the caller’s vote, not all voter IDs. Define which roles may vote.
- **Blocker before production:** Yes if polls are in launch scope; otherwise disable them.
- **Related risks or dependencies:** UI role defect `UI-04`; schema size limits `SEC-06`.

### LOG-10 — Version restore is slow and races with active collaborators

- **Severity:** Medium
- **Location:** `src/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route.ts`
- **Description:** Restore performs sequential update/create operations for every item and does not establish a canvas-level maintenance lock or notify connected clients. Concurrent REST writes can land around the restore, and other clients retain stale state.
- **Why it matters for production:** Large restores hold a transaction open for many round trips and can yield a mixed post-restore state under real collaboration.
- **Recommended fix:** Pause writes with a canvas restore revision/lock, use bulk SQL/upsert operations, commit one new canvas revision, broadcast a mandatory reload event, and set transaction/statement timeouts.
- **Blocker before production:** No for small single-user launch; yes before large collaborative restores.
- **Related risks or dependencies:** Known performance item `PERF-23`; depends on the synchronization design in `LOG-01`.

### LOG-11 — Panning and zooming are treated as content edits

- **Severity:** Medium
- **Location:** `src/features/canvas/hooks/use-canvas-data.ts`, `src/app/api/v1/canvases/[canvasId]/route.ts`
- **Description:** Every debounced owner viewport change PATCHes the shared Canvas row. The generic PATCH changes `updatedAt`, logs `CANVAS_UPDATED`, and invalidates lists.
- **Why it matters for production:** Merely navigating reorders dashboard recency, floods activity rows/logical notifications, and writes to PostgreSQL/Redis.
- **Recommended fix:** Keep personal viewport in `CanvasView`/local state, or add a dedicated endpoint that does not mutate content recency or activity. Define separately whether an owner can publish a default viewport.
- **Blocker before production:** No.
- **Related risks or dependencies:** Performance impact is `PERF-05`.

### LOG-12 — Multi-item operations are not atomic and have weak failure recovery

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx` bulk delete/align/distribute/template/AI handlers, canvas item hooks
- **Description:** Bulk operations launch many independent mutations with `Promise.all` or fire-and-forget calls. A mid-operation failure leaves partial alignment/deletion/creation; errors are often console-only. Several items are assigned the same z-index.
- **Why it matters for production:** Intermittent network/conflict failures produce layouts that cannot be reliably retried or undone.
- **Recommended fix:** Add idempotent batch endpoints with one authorization check, per-item OCC, transactional commit, and an explicit result. Use them from UI with one recoverable command.
- **Blocker before production:** No, except destructive bulk actions should be disabled until retry behavior is clear.
- **Related risks or dependencies:** Agent batch writes can provide a pattern but must preserve user attribution and policy.

### LOG-13 — AI/template placement is wrong at non-default zoom

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx`, serendipity/template/whisper handlers
- **Description:** Several screen-to-canvas placement formulas subtract pan but do not divide by zoom, unlike the correct AI placement path.
- **Why it matters for production:** At non-100% zoom, inserted content appears away from the viewport or overlaps unexpectedly.
- **Recommended fix:** Centralize one tested `screenToWorld` transform and use it for every creation source.
- **Blocker before production:** No.
- **Related risks or dependencies:** Include pan/zoom matrix tests at min/max zoom.

### LOG-14 — Collaborator activity is stored under the actor and invisible to owners

- **Severity:** Medium
- **Location:** `src/lib/activity.ts`, item/comment/share route handlers, `/api/v1/activities`
- **Description:** `logActivity` receives the actor’s user ID. Feed queries filter only that ID, so an owner cannot see actions performed on their canvas by collaborators.
- **Why it matters for production:** The implementation cannot support the product’s notification/audit promises or incident attribution from the owner’s perspective.
- **Recommended fix:** Separate immutable actor, subject canvas/owner, recipients, and audit retention. Produce events after commit and project them into user feeds asynchronously.
- **Blocker before production:** No.
- **Related risks or dependencies:** UI semantics are `UI-10`; agent `AgentAction` records are separate and should not be conflated.

### LOG-15 — Registration commits the account before email delivery succeeds

- **Severity:** High
- **Location:** `src/app/api/v1/auth/register/route.ts`, `src/app/api/v1/auth/send-verification/route.ts`
- **Description:** User/workspace/canvas/token creation commits, then the route awaits email delivery. If delivery fails, the request returns an error even though the account exists; retry returns conflict. Conversely, resend swallows delivery failures and reports success, and is inaccessible to the unverified user.
- **Why it matters for production:** A transient provider error creates stranded accounts and contradictory UI outcomes.
- **Recommended fix:** Commit an email-outbox record with registration, return the account-created/check-email state, deliver asynchronously with retries and observability, and expose a safe resend path.
- **Blocker before production:** Yes for public registration.
- **Related risks or dependencies:** Requires the UI changes in `UI-02`; do not store plaintext verification tokens in the outbox.

### LOG-16 — Search fallback can be forced into broad scans and can remain degraded forever

- **Severity:** Medium
- **Location:** `src/app/api/v1/search/route.ts`
- **Description:** `%` and `_` in the query are not escaped for ILIKE, so a two-character wildcard query can match nearly everything. Query/tag length and count are not bounded. A transient failure while detecting `searchVector` sets a process-global `ftsAvailable=false` permanently.
- **Why it matters for production:** Authenticated users can trigger expensive count/result scans; one startup-time database hiccup silently degrades that process until restart.
- **Recommended fix:** Set explicit query/tag limits, escape ILIKE metacharacters, prefer FTS-only semantics when available, retry capability detection with TTL, and enforce database statement timeouts.
- **Blocker before production:** No independently; combine with per-user abuse controls in `SEC-02`.
- **Related risks or dependencies:** Search UI inconsistencies are `UI-11`.

## Production Blockers

- [ ] `LOG-01`: implement credible cross-client item synchronization or remove “real-time collaboration” from launch scope.
- [ ] `LOG-02` and `LOG-03`: guarantee serialized autosave and correct rollback/recovery.
- [ ] `LOG-04`: make every item type persist geometry through one path.
- [ ] `LOG-05`: repair or disable undo/redo.
- [ ] `LOG-06`: repair or disable duplicate/template cloning for referenced items and uploads.
- [ ] `LOG-08`: support the rich-text format or remove rich-text controls/claims.
- [ ] `LOG-09`: implement atomic server-authoritative polling or disable polls.
- [ ] `LOG-15`: repair the registration/email-delivery lifecycle.

These blockers are in addition to security, deployment, and recovery blockers summarized in `production-readiness.md`.
