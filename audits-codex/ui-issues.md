# UI, UX, and Accessibility Issues

## Review limitation

The in-app browser had no available browser backend in this session, so a fresh interactive desktop/mobile/keyboard/screen-reader pass could not be captured. Retained screenshots were reviewed only as historical context. Findings below are source- and test-backed; responsive and assistive-technology acceptance still requires a live release-candidate pass.

## UI-01 — Dashboard exposes Duplicate actions whose backend is deliberately disabled

- **Severity:** High
- **Location:** `src/features/dashboard/components/DashboardContent.tsx:152-176,306-318,485-490`; `src/app/api/v1/canvases/[canvasId]/duplicate/route.ts`; `src/lib/templates/availability.ts`
- **Description:** Both bulk and per-canvas menus visibly offer Duplicate. The called API immediately returns the release-gated “Templates and canvas duplication are disabled” problem, while the UI reduces the failure to a generic toast. The templates route itself correctly returns `notFound()`, so the launch UI and API gate are inconsistent.
- **Production impact:** A prominent canvas-management action always fails. It damages trust and contradicts the completed launch-gating intent recorded in the implementation board.
- **Recommended fix:** Remove the entry points for this release or drive UI and API from one capability flag. If retained as disabled, explain why and when it is available rather than issuing a request.
- **Production blocker:** Yes; remove or make functional before launch.
- **Related risks/dependencies:** README also advertises templates even though the release gates them.

## UI-02 — The public status page crashes after reporting a false error state

- **Severity:** High
- **Location:** `src/components/StatusSummary.tsx:6-55`; `src/app/api/health/route.ts:3-8`; `src/app/status/page.tsx:7-17`; `src/app/api/health/__tests__/route.test.ts`
- **Description:** `StatusSummary` expects `{status: healthy|degraded|unhealthy, checks}`. `/api/health` intentionally returns only `{status: "ok"}`. The component initially renders “Overall status: ok” with error severity and then evaluates `Object.entries(undefined)`, causing a client error. The page copy promises readiness checks that the public endpoint intentionally withholds.
- **Production impact:** The status route linked from public navigation is broken during both healthy and unhealthy operation, weakening incident trust exactly when users need it.
- **Recommended fix:** Decide on one public contract. Either render liveness only and handle unknown fields safely, or expose a separately sanitized aggregate status without internal connection details. Runtime-validate the payload and test the route plus component together.
- **Production blocker:** Yes if `/status` remains linked and indexed.
- **Related risks/dependencies:** `DEP-05`, `TEST-03`.

## UI-03 — The notification surface presents the wrong data and no notification state

- **Severity:** High
- **Location:** `src/app/notifications/NotificationsContent.tsx:20-56,70-150`; `src/components/layout/AppShell.tsx:170-180`; notification APIs under `src/app/api/v1/notifications/`
- **Description:** The page is titled and narrated as Notifications but renders the user’s activity feed. The bell has no unread badge, persisted notifications cannot be marked read, preferences are absent from Settings, and share invitations are not actionable in-app.
- **Production impact:** Users cannot rely on Memoria to surface collaboration events and may miss access invitations or decisions.
- **Recommended fix:** Implement the real inbox contract described in `LOG-03`, including accessible unread semantics and actions, or rename/remove the surface until that contract exists.
- **Production blocker:** Yes for the current product promise.
- **Related risks/dependencies:** `LOG-03`.

## UI-04 — Canvas routes render the accessible item panel twice

- **Severity:** High
- **Location:** `src/features/canvas/components/CanvasBoard.tsx:1003-1028,1056-1066`; `src/app/share/[token]/page.tsx:284-302`; `src/features/canvas/components/CanvasAccessiblePanel.tsx:23-38`
- **Description:** Both the editable canvas and public share page mount two `CanvasAccessiblePanel` instances. The panel is visually clipped but intentionally remains in the accessibility tree, so screen readers receive duplicate skip links, regions, controls, and complete item lists.
- **Production impact:** Keyboard and screen-reader navigation is noisy and ambiguous, element IDs/landmarks may repeat, and the DOM cost of the full accessible list doubles. Existing component-isolation tests do not exercise route composition.
- **Recommended fix:** Render exactly one panel per canvas view and point the canvas description/skip target to it. Add route-level accessibility assertions for unique landmarks, names, and item occurrence counts.
- **Production blocker:** Yes for an accessibility-conscious launch.
- **Related risks/dependencies:** `PERF-02`, `TEST-03`, `TEST-05`.

## UI-05 — Share dialog controls are unlabeled and its invite row overflows narrow screens

- **Severity:** Medium
- **Location:** `src/features/canvas/components/ShareDialog.tsx:121-125,172-176,232,250-390`
- **Description:** Close, copy-link, and revoke icon buttons lack accessible names. The email field uses placeholder-only labeling and the role select has no label. The email/select/button row is a non-wrapping flex row with a 120 px select and 80 px button, which exceeds the usable width of common 320–375 px dialogs. Destructive link rotation/revocation uses `window.confirm` despite a reusable application confirmation dialog being available.
- **Production impact:** Screen-reader users cannot identify important controls, mobile users may see clipped controls, and destructive confirmation behavior is inconsistent and difficult to test.
- **Recommended fix:** Add programmatic labels and helper text, stack the row at `xs`, provide a full-screen/sheet treatment on small screens, and use the shared focus-managed confirmation dialog.
- **Production blocker:** No, but it is a pre-production accessibility priority.
- **Related risks/dependencies:** Live checks at 320, 375, 768, and 1024 px remain required.

## UI-06 — Rich-text and command-palette colors ignore the user-selected theme

- **Severity:** Medium
- **Location:** `src/app/tiptap.css:61-169`; `src/components/command-palette.css:12-131`; `src/lib/theme-preference.ts`
- **Description:** The application persists an explicit `data-theme` choice, but these styles switch using `prefers-color-scheme`. A user selecting light mode on a dark OS, or dark mode on a light OS, gets mismatched editor/palette backgrounds, borders, and text colors.
- **Production impact:** Theme choice is visibly inconsistent and can produce low-contrast or visually broken overlays in two central editing/navigation surfaces.
- **Recommended fix:** Scope styles to `html[data-theme="light|dark"]` or consume shared theme tokens. Add automated screenshots for both selected themes while the OS preference is intentionally opposite.
- **Production blocker:** No.
- **Related risks/dependencies:** `TEST-05`.

## UI-07 — Landing-page claims contradict product limits and available evidence

- **Severity:** Medium
- **Location:** `src/app/page.tsx:29,47,207,370`; `src/lib/policy/launch-limits.ts:1-10`; `README.md:3`
- **Description:** The page claims “unlimited canvases,” “Free forever,” “Join thousands of users,” and “Enterprise-grade security.” The enforced canvas limit is 200 per user, no pricing/operating commitment or user-count evidence is present, the dependency/security gate is red, and README still advertises release-gated templates.
- **Production impact:** Public copy creates avoidable legal, trust, and support risk and sets expectations the product cannot currently substantiate.
- **Recommended fix:** Use factual language: state the launch limits, self-hosted ownership model, implemented security controls, and current feature set. Reserve scale/social-proof claims for measured evidence.
- **Production blocker:** No, but correct before public marketing.
- **Related risks/dependencies:** `SEC-04`, `LOG-05`.

## Recommended UI Priorities Before Production

1. Remove the always-failing Duplicate actions (`UI-01`).
2. Repair the status-page contract and failure state (`UI-02`).
3. Connect the notification UI to persisted notifications and preferences (`UI-03`).
4. Reduce every canvas route to one accessible item panel (`UI-04`).
5. Complete the share-dialog labeling/mobile pass (`UI-05`).
6. Align all custom CSS with the selected theme (`UI-06`).
7. Replace unsupported launch claims with measured, truthful copy (`UI-07`).

The public-share completeness and metadata defects in `LOG-01`/`LOG-02` rank ahead of all cosmetic work because they make the visible canvas materially wrong.
