# UI Audit & Modernization Plan

**Date:** 2026-07-02
**Branch:** `claude/ui-audit-modernization-q6ur27`
**Scope:** Full audit of the web UI, filling in missing pages for already-implemented backend features, and remaking the existing pages to current standards.

---

## 1. Audit findings

### 1.1 Current page inventory

| Route | State |
|---|---|
| `/` (landing) | Exists — heavy inline gradient styling, hard-coded hex colors |
| `/dashboard` | Exists — own gradient header, no shared nav |
| `/canvas/[canvasId]` | Exists — Konva editor (out of scope for restyle, see §4) |
| `/workspaces` | Exists — links to a dashboard filter that is not implemented |
| `/templates` | Exists — different (green) gradient header, no manage UI |
| `/notifications` | Exists — **no navigation/header at all**, dumps raw `JSON.stringify(metadata)` |
| `/settings` | Exists — monolithic page, uses `prompt()` for delete-account password |
| `/api-keys` | Exists — **no navigation/header at all** |
| `/profile` | Redirect to `/settings` only |
| `/setup`, `/share/[token]`, auth pages | Exist — functional, inconsistent styling |

### 1.2 Implemented features with missing/broken UI

1. **Shared-with-me canvases** — `/api/v1/shared-canvases` and the `useSharedCanvases()` hook exist but are used by **zero** components. Users have no way to see canvases shared with them.
2. **Search** — `/api/v1/search` exists and `GlobalSearchDialog` is only reachable from the dashboard. No dedicated `/search` page, no deep-linkable results.
3. **Workspace filtering** — workspace cards link to `/dashboard?workspace=<id>`, but the dashboard ignores the query param entirely. The workspaces feature is effectively a dead end.
4. **Template management** — the API supports updating/deleting your own templates (`PATCH/DELETE /api/v1/templates/[templateId]`), but the templates page only offers "Use Template".
5. **Notifications/activity rendering** — the activities API returns typed metadata, but the page prints raw JSON.

### 1.3 Systemic UI problems (why it feels outdated)

- **No app shell.** Every page rolls its own header (or none). Navigation is a scatter of buttons on the dashboard; several pages are unreachable except by typing the URL.
- **Inter font is referenced but never loaded.** The root layout sets `fontFamily: Inter` inline, but there is no `next/font` (or any other) font loading — users get the system fallback.
- **Split branding.** Root metadata/manifest say **Memoria**; every page title and the footer say **CanvasCollect**.
- **Theme vs. reality mismatch.** `src/lib/theme.ts` defines an "oceanic" palette (`#0288d1`), but nearly every page hard-codes a `#667eea → #764ba2` gradient (and templates uses a green one). The theme is decorative, not authoritative.
- **Deprecated MUI v6 APIs**: legacy `<Grid item xs=...>` everywhere, `InputProps`/`InputLabelProps` instead of `slotProps`, `onKeyPress` (deprecated in React).
- **Rough UX patterns**: `window.prompt()` for a password, `window.location.reload()` after bulk delete instead of query invalidation, raw `fetch` in `SettingsContent` bypassing the react-query layer, `sonner` installed but never mounted.
- **Accessibility**: `maximumScale: 1` in the viewport blocks pinch-zoom; gradient headers have no landmark structure; icon buttons missing labels in places.

---

## 2. Design decisions

- **Keep MUI v6** (deeply integrated with CSP nonce/Emotion setup) but make the theme the single source of truth: one brand identity (indigo→violet, matching the dominant existing gradient), design tokens in `theme.ts`, no page-level hard-coded hexes.
- **One brand name: "Memoria"** (matches `package.json` and the PWA manifest).
- **Introduce an `AppShell`** (`src/components/layout/AppShell.tsx`): sticky glass AppBar with nav (Dashboard, Workspaces, Templates, Search, Notifications), command-palette/search trigger, theme toggle, and a user avatar menu (Settings, API Keys, Sign out). Responsive drawer on mobile. All authenticated pages adopt it.
- **Toasts via `sonner`** (already a dependency): mount one `<Toaster>` in providers; replace hand-rolled Snackbar state.
- **Layouts**: CSS grid/`Stack` instead of deprecated legacy `Grid`; `slotProps` instead of deprecated `*Props`; `next/font` for Inter.
- **Empty/loading/error states** standardized per page (skeletons + friendly empty states, no raw "Loading..." text).

## 3. Work plan

### Phase 1 — Foundation
1. `next/font` Inter in root layout; remove inline font style; drop `maximumScale: 1`.
2. Theme refresh in `src/lib/theme.ts`: brand tokens (indigo/violet), consistent gradients exported from the theme, softer elevation, unchanged dark-slate backgrounds.
3. `AppShell` layout component + user menu + mobile drawer.
4. Mount `sonner` Toaster in `providers.tsx`.
5. Unify branding to Memoria (titles, footer, metadata).

### Phase 2 — Remake existing pages
1. **Landing** — rebuild with theme tokens, cleaner hero, feature grid, CTA, footer.
2. **Dashboard** — AppShell; honor `?workspace=` filter (with workspace chip/back-link); add **Shared with me** tab using `useSharedCanvases()`; replace `window.location.reload()` with query invalidation; toast feedback.
3. **Settings** — restructure into clear sections with modern cards; replace `prompt()` with a password field inside the delete dialog; toasts instead of Snackbar plumbing.
4. **Notifications** — AppShell; human-readable activity descriptions from metadata (no raw JSON); relative timestamps.
5. **API Keys** — AppShell; modern list with status chips; toast on copy/revoke.
6. **Templates** — AppShell; brand-consistent cards; owner actions (delete) for "My templates".
7. **Workspaces** — AppShell; cards link to the (now working) dashboard workspace filter.
8. **Auth pages** — shared split-panel auth layout (brand panel + form card); modernize form fields; keep all auth logic intact.

### Phase 3 — Missing pages
1. **`/search`** — dedicated, deep-linkable search page (`?q=`) over `/api/v1/search` with type filters and grouped results.
2. **`/shared`** — "Shared with me" page (first consumer of `useSharedCanvases`), also surfaced as a dashboard tab and nav item.
3. **Workspace filter view** — implemented inside the dashboard (`/dashboard?workspace=<id>`) rather than a separate detail page, so existing links start working.
4. **Template management** — owner controls on `/templates` (delete own template), avoiding a redundant standalone page.

### Phase 4 — Verification
1. `pnpm type-check`, `pnpm lint`, `pnpm test` (unit), build.
2. Fix regressions; keep API layer and auth flows untouched.
3. Commit incrementally and push to `claude/ui-audit-modernization-q6ur27`.

## 4. Explicitly out of scope

- The Konva canvas editor (`/canvas/[canvasId]`) internals — large, functional, and separately styled; only its surrounding chrome stays consistent.
- Backend/API changes, Prisma schema, auth logic.
- `/setup` and `/share/[token]` remain functional as-is (light branding touch only if trivial).
