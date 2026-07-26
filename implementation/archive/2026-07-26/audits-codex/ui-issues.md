# UI and UX Audit

## Scope and evidence

This review covers every page route, the authenticated application shell, canvas controls and dialogs, public sharing, authentication, settings, and source-level responsive/accessibility behavior. The local application returned HTTP 200 and its server response was inspected. The in-app browser had no available browser backend, so desktop/mobile screenshots and hands-on assistive-technology checks could not be completed; items that require device confirmation are identified as such.

## Findings

### UI-01 — The entire application has an empty server-rendered body

- **Severity:** High
- **Location:** `src/lib/theme-context.tsx` (`ThemeModeProvider`), `src/app/providers.tsx`, all pages
- **Description:** `ThemeModeProvider` returns `null` until a client-side `useEffect` marks it mounted. Because this provider wraps the whole app, the HTML body contains only a hidden React boundary and scripts; page content exists only in the RSC payload until hydration.
- **Why it matters for production:** Users see a blank page on slow devices, during delayed/broken JavaScript, and when hydration fails. Public landing/help/legal pages lose meaningful no-JS output and become harder for crawlers and accessibility tooling to consume.
- **Recommended fix:** Server-render a deterministic initial theme. Use an inline pre-hydration color-mode script or MUI color-scheme support, then reconcile stored preference without suppressing all children.
- **Blocker before production:** Yes for a public launch; the entire UI currently depends on successful hydration before anything is visible.
- **Related risks or dependencies:** CSP nonce handling must remain intact. Re-test light/dark hydration, no-JS rendering, and slow-network first paint.

### UI-02 — Production registration leads users into an email-verification dead end

- **Severity:** High
- **Location:** `src/features/auth/components/RegisterForm.tsx`, `src/features/auth/components/LoginForm.tsx`, `src/app/auth/verify-email/page.tsx`, `src/app/api/v1/auth/send-verification/route.ts`
- **Description:** Registration ignores `verificationRequired`, tells users to sign in, and redirects to login. Production authentication rejects unverified users, but login reduces that state to “Invalid email or password.” The resend endpoint requires an authenticated session even though unverified users cannot obtain one. After verification, the page redirects an unauthenticated user to `/dashboard`, which redirects again to login.
- **Why it matters for production:** A normal first-time production user can neither understand the required step nor request another verification message. Email delay or loss strands the account permanently without operator intervention.
- **Recommended fix:** Show a dedicated “check your email” state after registration, provide a public enumeration-safe resend form with rate limits, expose a safe unverified-account error path, and redirect successful verification to login with a clear success message.
- **Blocker before production:** Yes if public registration is enabled.
- **Related risks or dependencies:** Coordinate with the email-delivery transaction issue `LOG-15` and production-auth E2E gap `TEST-03`.

### UI-03 — The advertised accessible canvas alternative is not an item list

- **Severity:** High
- **Location:** `src/features/canvas/components/CanvasBoard.tsx`, `src/features/canvas/components/CanvasOrganizerView.tsx`, `src/features/canvas/components/ReadonlyCanvasItemLayer.tsx`, `/share/[token]`
- **Description:** The canvas region tells users to switch to Organizer view for an accessible item list. Organizer actually renders agent-derived entities, suggestions, and change sets; an ordinary canvas with notes but no derived entities has no keyboard-readable item list. Shared users also receive owner-scoped agent API errors. Public-share pages have no alternate view at all.
- **Why it matters for production:** Konva canvas content is not represented as ordinary accessible DOM. Screen-reader and keyboard-only users cannot reliably discover or operate the product’s core content, and the help text points to a surface that does not solve the problem.
- **Recommended fix:** Add a real DOM-based canvas item list with headings, type, content summary, tags, selection, and permitted actions. Make it work for owner, collaborator, and public read-only scopes, then run automated and manual WCAG testing.
- **Blocker before production:** Yes for an accessibility-conscious public launch.
- **Related risks or dependencies:** Related to known work `UX-03`, `UX-06`, `TST-13`; distinct from the agent Organizer feature.

### UI-04 — Read-only roles still see and can trigger mutating interactions

- **Severity:** High
- **Location:** `src/features/canvas/components/CanvasItemLayer.tsx`, `PollItem.tsx`, `CanvasBoard.tsx`, `CommentsPanel.tsx`, `CanvasHeader.tsx`
- **Description:** Only note, bookmark, and image items receive `readOnly`. Shape, drawing, arrow, text, frame, embed, and poll items remain selectable/draggable; polls attempt item updates. The canvas interaction hook is not given `canEdit`, so a persisted drawing tool can still attempt creation. Signed-in VIEW users see a comment composer, and viewer-visible template/serendipity controls can initiate writes that the server later rejects.
- **Why it matters for production:** The server often prevents unauthorized persistence, but the UI shows optimistic or local changes that disappear, leaves rejected optimistic poll state in cache, and misrepresents role capabilities.
- **Recommended fix:** Make capability state an explicit required prop at the stage, item, dialog, and comments layers. Disable drag/edit/create affordances before interaction; keep COMMENT separate from EDIT; add role-matrix UI tests.
- **Blocker before production:** Yes for collaboration launch because read-only behavior is a primary sharing contract.
- **Related risks or dependencies:** Optimistic rollback defect `LOG-03`; missing movement persistence `LOG-04`; server authorization should remain the final boundary.

### UI-05 — The global `?` shortcut prevents users from typing question marks

- **Severity:** High
- **Location:** `src/components/GlobalShortcutsProvider.tsx`, `src/lib/hooks/use-keyboard-shortcuts.ts`
- **Description:** The global shortcut handler always intercepts `?`, calls `preventDefault`, and opens the shortcuts dialog. It does not ignore inputs, textareas, contenteditable elements, editors, or open dialogs.
- **Why it matters for production:** Users cannot type a question mark in search, comments, forms, or rich-text notes while the provider is mounted. This is a direct content-entry defect across the whole application.
- **Recommended fix:** Ignore keystrokes originating in editable controls unless the shortcut is explicitly allowed there; use `event.code`/modifier-aware matching; add focused-input keyboard tests.
- **Blocker before production:** Yes because it breaks ordinary text entry.
- **Related risks or dependencies:** Canvas-specific keyboard handling already has separate logic; consolidate shortcut policy to avoid future collisions.

### UI-06 — Canvas controls do not have a credible small-screen layout

- **Severity:** Medium
- **Location:** `src/features/canvas/components/CanvasHeader.tsx`, `MainToolbar.tsx`, `/share/[token]`
- **Description:** The canvas header exposes a dense row of name, search, zoom, layout, collaboration, AI, history, export, and mode controls. The main toolbar and public-share controls depend on horizontal space rather than prioritization or overflow grouping.
- **Why it matters for production:** On phones and narrow tablets, core controls will be compressed, clipped, or require horizontal discovery. Touch targets and canvas area compete for the viewport.
- **Recommended fix:** Define mobile/tablet breakpoints: keep name/status and one add action visible, move secondary actions to an overflow sheet, use a bottom tool dock, and test 320/375/768/1024 px widths with long canvas names and multiple collaborators.
- **Blocker before production:** No, but required before claiming mobile readiness.
- **Related risks or dependencies:** Runtime screenshots were unavailable in this audit; this source-level finding needs device confirmation.

### UI-07 — Save and conflict failures are not surfaced as durable user state

- **Severity:** High
- **Location:** `src/lib/hooks/use-autosave.ts`, `src/lib/hooks/use-canvas-items.ts`, note/bookmark/image item components
- **Description:** Autosave errors are generally logged or briefly reflected inside a component; there is no persistent canvas-level “unsaved,” “retrying,” or “conflict” state. Some operations have no toast at all. A failed optimistic update can continue to look saved.
- **Why it matters for production:** Users can close the page believing work is stored when it is not. Collaboration conflicts look like random reversion rather than a recoverable decision.
- **Recommended fix:** Introduce a canvas save-state model (`saved`, `saving`, `offline`, `failed`, `conflict`) with retry/reload actions and an unload warning only when unsaved deltas remain. Preserve failed deltas until acknowledged.
- **Blocker before production:** Yes together with the underlying autosave defect `LOG-02`.
- **Related risks or dependencies:** Requires a reliable serialized mutation queue and a structured version-conflict error contract.

### UI-08 — Several dialogs discard user input or report success without confirming the action

- **Severity:** Medium
- **Location:** `CreatePollDialog.tsx`, `ExportDialog.tsx`, `ShareDialog.tsx`, `SaveAsTemplateDialog.tsx`, `SerendipityDialog.tsx`
- **Description:** Poll creation closes and resets immediately after starting a mutation; export failures only reach the console; share loading errors are console-only; clipboard copy can report success without awaiting rejection; some AI/template actions lack recoverable error state.
- **Why it matters for production:** Network and permission errors are routine. Silent failures force users to repeat work and undermine trust in sharing/export flows.
- **Recommended fix:** Await mutations before closing, keep input on failure, show RFC 7807 details safely, await clipboard operations, and standardize dialog pending/error/success behavior.
- **Blocker before production:** No, except where the dialog is the only path for a launch-critical feature.
- **Related risks or dependencies:** Partial-write behavior is covered by `LOG-12`.

### UI-09 — “Save as template” defaults to a payload the server rejects

- **Severity:** High
- **Location:** `src/features/canvas/components/SaveAsTemplateDialog.tsx`, `src/app/api/v1/templates/route.ts`, `src/app/templates/TemplatesContent.tsx`
- **Description:** The optional description defaults to an empty string, while the server schema treats a provided description as minimum length one. Saving with the untouched optional field therefore fails. Producer categories (`Planning`, `Design`, `Meeting`, etc.) do not match library filters (`Project Planning`, `Creative`, `Business`, etc.). Form defaults can also retain the initial “Untitled Canvas” value after the canvas name loads.
- **Why it matters for production:** A primary template action fails on its default path, and successfully saved templates cannot always be found through category filters.
- **Recommended fix:** Normalize blank optional fields to `undefined`/`null`, share one category enum between API and UI, and reset form defaults from the current canvas when the dialog opens.
- **Blocker before production:** Yes if templates are in launch scope; otherwise disable the feature until fixed.
- **Related risks or dependencies:** Template data-reference defects are in `LOG-06` and `LOG-07`.

### UI-10 — “Notifications” is an actor-only activity log, not notifications

- **Severity:** Medium
- **Location:** `/notifications`, `src/app/api/v1/activities/route.ts`, `src/lib/activity.ts`
- **Description:** Activity rows are stored and queried under the user who performed the action. An owner does not receive collaborator edits/comments, yet the page says “Recent activity across your canvases” and promises edits, shares, and comments. There is no recipient, read/unread, delivery, or preference model.
- **Why it matters for production:** Owners miss the events they expect to monitor, while the navigation badge-free “Notifications” label implies a communications feature that does not exist.
- **Recommended fix:** Either rename the current page to “Your activity,” or add recipient-scoped events, read state, preferences, and aggregation for owned/shared canvases.
- **Blocker before production:** No.
- **Related risks or dependencies:** Avoid storing one row per recipient synchronously on hot item-update paths; use an event/outbox design.

### UI-11 — Search counts, type filters, and tag claims are misleading

- **Severity:** Medium
- **Location:** `src/app/search/SearchContent.tsx`, `src/app/api/v1/search/route.ts`
- **Description:** The displayed count is only the currently loaded and client-filtered page, not `pagination.total`. Type filters are derived from loaded results, so types present on later pages are absent. Copy says query search includes tags, but tags are only an optional exact filter and the UI never sends them. Non-note/bookmark/image snippets often render “Untitled item.”
- **Why it matters for production:** Users can incorrectly conclude that results do not exist and cannot rely on the result count or advertised tag search.
- **Recommended fix:** Return server-side facets/counts, perform type/tag filtering server-side, show `total`, include tags in searchable text or change the copy, and add snippets for every item type.
- **Blocker before production:** No.
- **Related risks or dependencies:** Query abuse and fallback behavior are in `LOG-16` and `PERF-06`.

### UI-12 — Dark mode is applied inconsistently

- **Severity:** Medium
- **Location:** `src/app/tiptap.css`, `src/components/command-palette.css`, `CanvasOrganizerView.tsx`, canvas item components
- **Description:** Some CSS follows `prefers-color-scheme` instead of the user-selected app theme, while Organizer and multiple Konva items use hard-coded light backgrounds and text colors.
- **Why it matters for production:** A stored light/dark preference can produce mixed-theme dialogs and illegible or glaring canvas content.
- **Recommended fix:** Drive CSS from an HTML data attribute/MUI color scheme, replace hard-coded surface colors with theme tokens, and snapshot every major page in both modes.
- **Blocker before production:** No.
- **Related risks or dependencies:** Fixing `UI-01` should establish the single source of truth for initial theme.

### UI-13 — Active navigation is visual-only on desktop

- **Severity:** Low
- **Location:** `src/components/layout/AppShell.tsx`
- **Description:** Desktop navigation buttons change color/background for the active route but do not expose `aria-current="page"`.
- **Why it matters for production:** Screen-reader users do not receive the same location context as sighted users.
- **Recommended fix:** Set `aria-current="page"` for the active link and verify drawer selection semantics.
- **Blocker before production:** No.
- **Related risks or dependencies:** Include in the accessibility regression suite proposed in `TEST-05`.

### UI-14 — The global error page falsely guarantees that work was saved

- **Severity:** Medium
- **Location:** `src/app/error.tsx`
- **Description:** The error copy says “your work has been saved” for every route and error, including failures caused by autosave, initialization, or storage.
- **Why it matters for production:** This is an unsafe assurance precisely when data durability is unknown.
- **Recommended fix:** Use neutral copy, show save status when it is actually known, and explain how to retry/export local recovery data where available.
- **Blocker before production:** No, but update before relying on the error page for data-loss recovery.
- **Related risks or dependencies:** `LOG-02` and `UI-07` must provide the underlying truth.

### UI-15 — Public-share controls need explicit accessibility and responsive treatment

- **Severity:** Medium
- **Location:** `src/app/share/[token]/PublicCanvasViewer.tsx`, `src/features/canvas/components/ShareDialog.tsx`
- **Description:** Public canvas controls are predominantly icon-based, the share dialog uses fixed horizontal form rows, and several copy/revoke/close actions rely on icon/tooltips rather than consistently explicit accessible labels. Public viewers have no list-mode or clear content-loading progress for large canvases.
- **Why it matters for production:** Public links are the product’s least-controlled device context and the most likely surface for anonymous/mobile/assistive-technology use.
- **Recommended fix:** Add explicit accessible names, responsive stacked form layout, focus restoration, a DOM list view, and progressive item loading with status announcements.
- **Blocker before production:** No independently; the missing accessible content path in `UI-03` is a blocker.
- **Related risks or dependencies:** Large public payloads are covered by `PERF-02`.

## Recommended UI Priorities Before Production

1. Fix the email-verification onboarding flow (`UI-02`).
2. Stop global shortcut interception inside editable controls (`UI-05`).
3. Make autosave truth and failure recovery visible (`UI-07`, dependent on `LOG-02`/`LOG-03`).
4. Enforce role capabilities consistently in every canvas surface (`UI-04`).
5. Ship a genuine accessible DOM representation for owned, shared, and public canvases (`UI-03`).
6. Restore meaningful server rendering while preserving theme correctness (`UI-01`).
7. Repair the default template flow (`UI-09`).
8. Standardize dialog failure handling (`UI-08`).
9. Redesign the canvas toolbar for narrow viewports and verify on devices (`UI-06`, `UI-15`).
10. Correct search/notification semantics and dark-mode inconsistencies (`UI-10`–`UI-12`).
