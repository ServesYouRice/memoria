# Product and Engineering Nice-to-Haves

These recommendations are intentionally separated from launch blockers. “Nice-to-have” means the product can launch safely without it once the blocker reports are cleared.

## High-impact nice-to-haves

### NTH-01 — Invitation acceptance and pending-share workflow

- **Severity:** Nice-to-have
- **Location:** Sharing feature, `CanvasShare`, `ShareDialog.tsx`
- **Description:** Sharing immediately grants access to any future verified account with the matching email; there is no invite object, delivery, accept/decline, expiry, or reminder.
- **Why it matters for production:** Invitations are a trust and onboarding feature for collaboration, especially when the recipient is not registered.
- **Recommended fix:** Model invitations separately from active shares, email a single-use acceptance link, show pending/expired state, and let owners resend/revoke.
- **Blocker before production:** No.
- **Related risks or dependencies:** Email outbox work from `LOG-15`; known item `PRODUCT-01`.

### NTH-02 — Operator/admin console

- **Severity:** Nice-to-have
- **Location:** Product-wide operations
- **Description:** There is no admin role or UI for registration policy, users, storage usage, stuck jobs, email delivery, abuse, public links, or cleanup queues.
- **Why it matters for production:** Operators otherwise need direct database/log access for routine support and incident response.
- **Recommended fix:** Add a separately authorized operator surface with least-privilege actions, immutable audit records, and confirmation for destructive operations.
- **Blocker before production:** No for a small self-hosted instance.
- **Related risks or dependencies:** Do not overload the first bootstrap user without an explicit role model.

### NTH-03 — Complete portable export/import

- **Severity:** Nice-to-have
- **Location:** `/settings`, `/api/v1/users/account`, uploads/templates/versions/comments
- **Description:** The JSON export contains the advertised core canvas data but omits upload binaries and an import/restore path; it also omits useful history such as comments, versions, and agent-derived data.
- **Why it matters for production:** Real portability and self-service migration reduce lock-in and support burden.
- **Recommended fix:** Define a versioned archive manifest, include checksummed binary assets, stream the archive, and provide validated dry-run/import conflict handling.
- **Blocker before production:** No.
- **Related risks or dependencies:** First fix object lifecycle/backup issues in `SEC-03` and `DEP-02`.

### NTH-04 — Recipient-aware notifications and digests

- **Severity:** Nice-to-have
- **Location:** `/notifications`, comments, shares, mentions
- **Description:** There are no read/unread states, mention notifications, email digests, delivery preferences, or aggregation.
- **Why it matters for production:** Collaboration feels incomplete without a way to return to relevant changes.
- **Recommended fix:** Build a recipient event projection with deduplication, per-channel preferences, read cursors, and digest batching.
- **Blocker before production:** No.
- **Related risks or dependencies:** Root data-model issue `LOG-14`; avoid write amplification on item drag.

### NTH-05 — Guided first-run onboarding

- **Severity:** Nice-to-have
- **Location:** Registration completion, dashboard, first Inbox canvas
- **Description:** The first account receives an Inbox but no guided sample, checklist, or explanation of canvas navigation, sharing roles, organizer, and recovery.
- **Why it matters for production:** Infinite-canvas products have a discovery cost; a short progressive onboarding path improves activation.
- **Recommended fix:** Add dismissible, role-aware onboarding with one sample note and links to keyboard/accessibility help.
- **Blocker before production:** No.
- **Related risks or dependencies:** Do not add onboarding until the production registration path in `UI-02` is fixed.

## Product polish

### NTH-06 — Make the command palette truly global

- **Severity:** Nice-to-have
- **Location:** `CommandPalette.tsx`, `DashboardContent.tsx`, application shell
- **Description:** Settings advertises Ctrl/Cmd+K, but only Dashboard owns an opening handler; the palette’s internal handler intentionally does nothing.
- **Why it matters for production:** A global palette can simplify the increasingly dense navigation and canvas toolbar.
- **Recommended fix:** Mount it once in `AppShell`/global providers with route-aware commands and editable-control shortcut rules.
- **Blocker before production:** No.
- **Related risks or dependencies:** First fix shortcut interception `UI-05`.

### NTH-07 — Better empty states with contextual next actions

- **Severity:** Nice-to-have
- **Location:** Search, shared canvases, templates, trash, organizer, notifications
- **Description:** Empty states exist, but several do not explain permissions, filters, or the most likely next action.
- **Why it matters for production:** Contextual empty states reduce support questions and make partially configured features feel intentional.
- **Recommended fix:** Distinguish “no data,” “no filter matches,” “not configured,” and “permission unavailable,” with one safe primary action.
- **Blocker before production:** No.
- **Related risks or dependencies:** Organizer’s missing item list is a blocker (`UI-03`), not polish.

### NTH-08 — User-controlled reduced motion and canvas comfort settings

- **Severity:** Nice-to-have
- **Location:** Theme/global styles, canvas interaction, landing animations
- **Description:** The UI uses floating/fade/pulse effects but does not expose a product preference beyond system reduced-motion behavior.
- **Why it matters for production:** Canvas motion and zoom can be uncomfortable for some users.
- **Recommended fix:** Respect `prefers-reduced-motion` everywhere and optionally expose reduced animation, zoom sensitivity, and wheel behavior.
- **Blocker before production:** No.
- **Related risks or dependencies:** Include in manual accessibility testing.

### NTH-09 — Personal vs synchronized meeting timer decision

- **Severity:** Nice-to-have
- **Location:** Canvas collaboration roadmap
- **Description:** The product has not defined whether meeting/session timers are personal UI state or shared canvas state.
- **Why it matters for production:** The choice affects authority, pause/resume semantics, reconnect, and multi-instance synchronization.
- **Recommended fix:** Start personal unless a clear facilitation use case requires owner-controlled synchronized state.
- **Blocker before production:** No.
- **Related risks or dependencies:** Known decision `UX-14`.

## Developer experience improvements

### NTH-10 — Decompose the largest mixed-responsibility modules

- **Severity:** Nice-to-have
- **Location:** `src/lib/agents/service-core.ts` (~1,400 lines), `CanvasBoard.tsx` (~1,300 lines), `CanvasOrganizerView.tsx`, `mcp.ts`, WebSocket server
- **Description:** Core policy, persistence, orchestration, and UI behavior are concentrated in very large files.
- **Why it matters for production:** Large blast radius and implicit coupling make fixes harder to review and regression-test.
- **Recommended fix:** Split by domain boundary (geometry/history/dialog orchestration, agent suggestion/change-set/webhook execution) while preserving public contracts and adding characterization tests first.
- **Blocker before production:** No.
- **Related risks or dependencies:** Known items `MNT-01`, `MNT-05`; avoid refactoring concurrently with blocker fixes unless required.

### NTH-11 — Generate typed API clients and shared schemas

- **Severity:** Nice-to-have
- **Location:** Fetch hooks and route handlers
- **Description:** Many clients use `any`, ad-hoc JSON parsing, string-matched errors, and duplicated enums/categories.
- **Why it matters for production:** Contract drift caused the template and conflict-handling defects found in this audit.
- **Recommended fix:** Export versioned Zod request/response schemas, generate/infer clients, and standardize RFC 7807 parsing.
- **Blocker before production:** No.
- **Related risks or dependencies:** Particularly useful for item content, template categories, access roles, and pagination.

### NTH-12 — Production-like local fixtures and one-command integration environment

- **Severity:** Nice-to-have
- **Location:** test/setup scripts, Playwright, Docker Compose
- **Description:** The setup tooling is strong, but there is no deterministic fixture for two users, shared canvases, every item type, large canvases, and agent workflows.
- **Why it matters for production:** Reproducing collaboration and role bugs is otherwise expensive.
- **Recommended fix:** Add idempotent test fixtures plus disposable Compose profiles for integration, multi-instance, and recovery drills.
- **Blocker before production:** No; the missing tests themselves are blockers where noted in `testing-gaps.md`.
- **Related risks or dependencies:** Never reuse these credentials/data in production.

### NTH-13 — Enforce code-quality rules for `any` and fire-and-forget promises

- **Severity:** Nice-to-have
- **Location:** ESLint/TypeScript configuration and canvas/agent code
- **Description:** The tree contains broad `any` casts and unawaited mutations that lint does not reject.
- **Why it matters for production:** These patterns obscure item-content invariants and error handling.
- **Recommended fix:** Enable targeted `no-explicit-any`, `no-floating-promises`, and exhaustive union checks incrementally on high-risk modules.
- **Blocker before production:** No.
- **Related risks or dependencies:** Known `MNT-06`; baseline current violations before making CI blocking.

## Architecture or stack recommendations

### NTH-14 — Introduce a durable background-job/outbox layer

- **Severity:** Nice-to-have
- **Location:** Email, outbound webhooks, thumbnails, bookmark refresh, cleanup, export
- **Description:** Several slow/external side effects currently run inline or from one coarse scheduler loop.
- **Why it matters for production:** A durable job model gives retries, idempotency, visibility, and controlled concurrency.
- **Recommended fix:** Use a PostgreSQL outbox plus leased workers initially; add a queue product only if throughput warrants it.
- **Blocker before production:** The specific email/webhook durability gaps are blockers; a full generalized platform is not.
- **Related risks or dependencies:** `LOG-15`, `ARCH-01`, `DEP-06`.

### NTH-15 — Make tenant/resource policy a first-class domain concept

- **Severity:** Nice-to-have
- **Location:** Registration, canvas/item creation, AI, uploads, public sharing
- **Description:** Limits are scattered endpoint constants and IP middleware; there is no plan/tenant policy object.
- **Why it matters for production:** Self-hosted and managed deployments will need different registration, quota, retention, and AI policies.
- **Recommended fix:** Define operator-configurable policies with per-user counters and admin visibility.
- **Blocker before production:** No after the minimum abuse controls in `SEC-02` are implemented.
- **Related risks or dependencies:** Avoid reading mutable policy from environment on every request without validation/caching.

### NTH-16 — Reassess JSON embeddings before semantic scale-up

- **Severity:** Nice-to-have
- **Location:** Prisma `ItemEmbedding.vector Json`, agent knowledge/search architecture
- **Description:** The reference database image includes pgvector, but embeddings are stored as JSON and no vector index/search path is present.
- **Why it matters for production:** JSON vectors become expensive to scan and cannot use approximate-nearest-neighbor indexes.
- **Recommended fix:** When semantic search is real product scope, migrate to a typed vector column/index with model/dimension versioning and backfill controls.
- **Blocker before production:** No.
- **Related risks or dependencies:** Do not add vector infrastructure before ordinary FTS and content schema are stable.

## Future roadmap ideas

### NTH-17 — Team workspaces and role administration

- **Severity:** Nice-to-have
- **Location:** Workspace/share domain
- **Description:** Workspaces are personal folders; collaboration is per-canvas email sharing.
- **Why it matters for production:** Teams eventually need membership, roles, ownership transfer, offboarding, and shared templates.
- **Recommended fix:** Design organizations/workspace membership separately from current personal workspaces and migrate explicitly.
- **Blocker before production:** No.
- **Related risks or dependencies:** Requires a durable authorization matrix and audit trail.

### NTH-18 — Version diff and selective restore

- **Severity:** Nice-to-have
- **Location:** Version history/time machine
- **Description:** Versions are whole snapshots with whole-canvas restore; users cannot see what changed or restore one item.
- **Why it matters for production:** Diff previews make recovery safer and reduce accidental overwrite.
- **Recommended fix:** Compute item-level added/changed/deleted summaries and allow copy/restore of selected items after restore correctness is fixed.
- **Blocker before production:** No.
- **Related risks or dependencies:** `LOG-05`, `LOG-10`, `PERF-05`.

### NTH-19 — Explicit embed product decision

- **Severity:** Nice-to-have
- **Location:** `EmbedItem.tsx`, item schema, CSP
- **Description:** EMBED exists in the schema/renderer but is only a placeholder and has no creation flow; CSP forbids frames.
- **Why it matters for production:** A half-present item type adds maintenance and user expectation without product value.
- **Recommended fix:** Either remove/hide it for v1 or define supported providers, privacy consent, sandbox attributes, CSP allowlists, and fallbacks.
- **Blocker before production:** No while the UI does not expose it.
- **Related risks or dependencies:** Known decision `UX-10`.

### NTH-20 — AR mode validation and fallback strategy

- **Severity:** Nice-to-have
- **Location:** `ARCanvasLayer.tsx`
- **Description:** AR/camera/fullscreen behavior has not been verified across target devices and permission states.
- **Why it matters for production:** Mobile browser support and permission UX vary widely.
- **Recommended fix:** Treat AR as experimental, publish a support matrix, instrument failure reasons, and provide a non-camera fallback.
- **Blocker before production:** No if clearly labeled/disabled by default.
- **Related risks or dependencies:** Known item `UX-08`.
