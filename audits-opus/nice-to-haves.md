# Nice-to-Haves

Audited as a product a real person would adopt and keep using. Nothing here is a
defect — defects live in the other files. These are the gaps between "the
features work" and "this feels like a product someone maintains".

Severity here means **impact if absent**, not brokenness.

---

## High-impact nice-to-haves

Things whose absence users will actually notice and complain about.

### NTH-01 — Canvas trash / restore

| | |
| --- | --- |
| **Impact** | High |
| **Location** | `/trash` covers items only; canvas `DELETE` is a hard cascade |

`/trash` exists and `LAUNCH_LIMITS.trashRetentionDays = 30` is already defined,
so the concept and the retention job are in place — canvases just aren't in it.
Users will assume a product with a Trash page can undo a canvas deletion.

Ships alongside the LOG-08 fix; treat the soft delete as the blocker and the
Trash UI as the polish.

---

### NTH-02 — Onboarding for the empty state

| | |
| --- | --- |
| **Impact** | High |
| **Location** | [DashboardContent.tsx:346-369](src/features/dashboard/components/DashboardContent.tsx#L346-L369) |

The empty state is well built — icon, copy, primary action. But an infinite
canvas is a genuinely unfamiliar interface, and a new user landing on a blank
board has no idea that Space+drag pans, that double-click edits a note, or that
`?` opens shortcuts.

`/help` documents all of this, and `KeyboardShortcutsDialog` exists — but nothing
routes a first-time user to either.

**Suggestion.** A dismissible first-run overlay on the first canvas covering
three things only: add an item, pan/zoom, and `?` for everything else. Store
dismissal on the user record, not `localStorage`, so it survives devices.

---

### NTH-03 — Sharing feedback loop

| | |
| --- | --- |
| **Impact** | High |
| **Location** | `/api/v1/canvases/[canvasId]/share`, `CanvasShareInvitation` |

The backend is complete — roles, invitations, tokens, `ShareInvitationResponse`.
What's thin is the sharer's feedback: after sending an invitation there is no
pending/accepted/declined state visible on the canvas, no resend, no "copy link
instead", and no indication of whether the invite email actually sent (it goes
through the outbox, so failure is asynchronous and invisible to the sharer).

**Suggestion.** A collaborator list on the share dialog with per-person status,
resend, and role change. Surface outbox failures back to the sharer.

---

### NTH-04 — Per-user AI budget visibility

| | |
| --- | --- |
| **Impact** | High |
| **Location** | `/api/v1/ai/*`, `/api/v1/usage` |

SEC-08 covers the operator's uncapped cost exposure. The product side: users have
no idea whether AI is enabled, how much they've used, or why a call failed
(errors surface as generic 500s per SEC-08's secondary note).

A `/api/v1/usage` route already exists — surface it. "AI: 12 of 50 requests
today" in Settings turns an invisible limit into an understood one.

---

### NTH-05 — Notification preferences and unread state

| | |
| --- | --- |
| **Impact** | High |
| **Location** | UI-09 |

Covered as UI-09 since the model and API exist with no UI. Listed here because
the product consequence — users who cannot mute notifications eventually mute
the *sender*, i.e. mark your mail as spam — is a retention issue, not a UI nit.

---

## Product polish

### NTH-06 — Canvas card affordances

Rename, share, move-to-workspace, and delete from the dashboard card menu
(UI-08). Currently one action: Duplicate.

### NTH-07 — Search that reflects the product

Global search exists (`/search`, `GlobalSearchDialog`, full-text migration
`add_canvas_item_full_text_search`), but: no recent-searches, no result grouping
by canvas, no keyboard navigation of results, and two separate entry points
(UI-11). The full-text index is the expensive part and it's already built.

### NTH-08 — Presence that identifies people

Cursors carry a colour and a name, but colours repeat past 8 users (UI-15d) and
there is no avatar or hover identity. A follow-mode exists in `CanvasBoard` but
isn't discoverable in the UI.

### NTH-09 — Export completeness

The landing page promises PNG, PDF, and JSON. `jspdf` is a dependency and
`ExportDialog` exists — verify all three paths actually work, and add
import for the JSON format. Export without import is a one-way door that makes
users nervous about lock-in.

### NTH-10 — Bookmark unfurl transparency

`FEATURE_BOOKMARK_UNFURLING` gates SSRF-protected metadata fetching (well
tested — `ssrf-hostile.test.ts`). When it's off or a fetch fails, users see a
bare URL with no explanation. Show "Preview unavailable" and a manual
title/description entry path.

### NTH-11 — Mobile canvas story

`use-gesture` handles pinch-zoom and the toolbar collapses below `md`
(`CanvasSecondaryActions`), so mobile isn't ignored. But an infinite canvas with
drag-to-move items on a touch screen needs a deliberate decision: is mobile
view-only, or fully editable? Right now it's implicitly "editable but untested".
Pick one and make the UI say so.

### NTH-12 — Empty and error states across secondary pages

`EmptyState` is a good shared component. Confirm it's used on `/shared`,
`/trash`, `/workspaces`, `/notifications`, and `/search` — and that each has a
distinct error state, not just an absent list.

---

## Developer experience

### NTH-13 — Response contract types shared between server and client

The single highest-leverage DX change available here. UI-01, UI-03, and LOG-20
are all the same failure: the server returns one shape, the client reads
another, and `any` lets it compile.

`src/lib/api/response-schemas.ts` already defines Zod schemas for responses.
Export `z.infer<>` types from them and have the client hooks consume those types
instead of hand-written interfaces. Three shipped bugs in this audit would have
been compile errors.

### NTH-14 — Delete the duplicate auth module

LOG-13. Two modules exporting `requireAuth`/`requireCanvasOwnership` with
different error contracts, one of which converts any error containing "not found"
into a 404 with the raw message. Deleting `src/lib/auth/middleware.ts` removes a
whole class of future mistake.

### NTH-15 — Make `pnpm dev` failure modes obvious

`scripts/doctor.mjs` is excellent and checks the right things. Consider running a
fast subset automatically on `pnpm dev` startup so a developer with a stopped
Redis container gets a clear message instead of a runtime error deep in a
request.

### NTH-16 — Faster local test loop

PROD-02 (flaky pre-push). Beyond the timeout fix: `vitest --changed` in the hook
and the full suite in CI would cut the loop substantially. The
`@mui/icons-material` optimizer comment in `vitest.config.ts` suggests test
startup cost is already a known pain.

### NTH-17 — ADR index

Code comments reference ADR-0001 through ADR-0012 extensively, but the ADRs
themselves aren't in the repository (`docs/` holds branding and one operations
runbook). Either add them or drop the references — right now they're citations
to a document nobody can read.

### NTH-18 — Reconsider committing the generated Prisma client

`src/generated/prisma` is ~80k lines, roughly 60% of the repository's LOC. It
inflates diffs, review surface, and clone size. If it's committed for build
determinism, note that in `AGENTS.md`; otherwise gitignore it and rely on
`pnpm db:generate` (which CI already runs).

---

## Architecture & stack recommendations

### NTH-19 — Pin `next-auth` off the beta track before launch

`next-auth@5.0.0-beta.32` is pinned exactly, and the README explains why
(upstream still ships the Next.js package on beta). That's the right handling of
a constraint you don't control — but authentication is the least comfortable
place to depend on a beta. Track the stable release and treat upgrading as a
launch-adjacent task with its own test pass.

### NTH-20 — Decide between polling and WebSocket committed events

LOG-15. Two real-time mechanisms run concurrently. Committing to the WebSocket
stream and reducing polling to a slow safety net removes an entire class of
divergence bug and a meaningful share of the request volume behind PERF-04/05/06.

### NTH-21 — Plan the multi-instance path deliberately

`AGENTS.md` correctly defers replicas until shared event, lease, and job
semantics exist. When that's revisited, the specific blockers are already
visible: LOG-16 (Redis subscriber resolved once at import), LOG-11 (remote
presence entries never expire, producing ghost users), and outbox worker leasing.
Write these into the future-expansion notes so the next person doesn't rediscover
them.

### NTH-22 — Extract the collaboration server

`websocket-server.ts` is 1039 lines holding admission control, authorization,
rate limiting, Redis fanout, presence, and broadcast. It's coherent, but it's
also the component that most wants independent scaling and the one where a
main-thread stall (PERF-01) hurts most. If load testing (PROD-08) shows the
single process is the ceiling, splitting this out is the natural first move.

### NTH-23 — Consider a background job for canvas thumbnails

PERF-03. Client-side `stage.toDataURL()` on the interaction path is expensive and
taints on cross-origin images (caught only by `console.error`). Server-side
rendering of thumbnails in the outbox worker would be more reliable and remove
the cost from the user's main thread entirely.

---

## Future roadmap ideas

Beyond launch, in rough order of "makes this feel like a real product".

| Idea | Why |
| --- | --- |
| **Canvas templates** | The feature is 90% built and dark behind a 404 (UI-02). Finishing it is the cheapest new capability available. |
| **Import** (JSON, Markdown, Miro/FigJam) | Export exists; import is what lets people migrate *to* you. |
| **Offline editing** | `/offline` and a service worker exist but documents are network-only by design. A local-first queue would fit the canvas model well. |
| **Comment mentions + threads** | `Comment` and `Notification` models exist; `@mention` is the natural next step. |
| **Canvas-level permissions beyond four roles** | Per-item locking, frame-level permissions. |
| **Version diffing** | Snapshots exist and time-machine works; showing *what changed* between versions is the payoff. |
| **Public canvas embedding** | `EmbedItem` deliberately doesn't execute third-party content; the inverse — embedding a read-only Memoria canvas elsewhere — is a growth lever. |
| **Agent plane exposure** | Substantial infrastructure (MCP, BYOK, change-set rollback, suggestions) exists but is owner-only and conservative. Worth its own security review before widening. |
| **Workspace sharing** | Sharing is canvas-scoped; teams will ask for workspace-level membership. |
| **Audit log UI** | `AuditLog` and `Activity` models exist with no admin surface. |

---

## Missing admin tooling

Called out separately because a self-hosted product needs an operator story and
there is currently no admin surface at all:

- **No user administration.** No way to list users, disable an account, force a
  password reset, or bump `sessionVersion` to revoke sessions — despite the
  revocation mechanism existing and working.
- **No instance overview.** Active users, canvas count, storage consumed,
  outbox health. `/api/metrics` has some of it; nothing renders it.
- **No invite management UI.** `RegistrationInvite` exists and
  `REGISTRATION_MODE=invite` is supported, but invites can only be created
  through the database or a script.
- **No quota visibility.** `LAUNCH_LIMITS` caps canvases, items, uploads, and
  bytes per user. Users hit these with an error and no forewarning; operators
  can't see who's near a limit. `scripts/report-limit-violations.ts` exists —
  surface it.

For a v1 self-host release, the minimum is a documented CLI path for each of
these. A UI can wait; undocumented database surgery cannot.
