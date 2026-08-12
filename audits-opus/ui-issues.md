# UI & UX Issues

Scope: every page under `src/app`, the shared shell, canvas surfaces, forms,
dialogs, and state coverage (loading / empty / error). Inspection only.

Legend: **B** = blocker before production.

---

## UI-01 — Dashboard canvas thumbnails never render

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [DashboardContent.tsx:378](src/features/dashboard/components/DashboardContent.tsx#L378), [canvases/route.ts:50-63](src/app/api/v1/canvases/route.ts#L50-L63), [response-schemas.ts:32](src/lib/api/response-schemas.ts#L32) |
| **Blocker** | **B** |

**Problem.** The dashboard passes `thumbnail={canvas.thumbnail}` to `CanvasCard`.
The list endpoint's `select` returns `thumbnailKey` and `thumbnailRevision` — it
never returns a `thumbnail` field, and the response schema doesn't declare one.
`canvas.thumbnail` is therefore `undefined` on every card, so
[CanvasCard.tsx:82](src/features/dashboard/components/CanvasCard.tsx#L82)
always takes the placeholder branch.

**Why it matters.** The dashboard is the first authenticated screen. Every canvas
looks identical, so users navigate by name alone — and the whole thumbnail
pipeline (Konva `toDataURL` → `POST /thumbnail` → outbox job → object storage)
runs on every canvas edit producing artifacts nobody ever sees. It is wasted
work *and* a broken first impression.

**Fix.** Render from the real source: `<img src={`/api/v1/canvases/${id}/thumbnail`}>`
keyed on `thumbnailRevision` for cache-busting, with `onError` falling back to
the placeholder. The `TypeScript` type at
[use-canvases.ts:24](src/lib/hooks/use-canvases.ts#L24) still declares
`thumbnail?: string | null` — remove it so the compiler catches this class of
drift.

**Related.** `Canvas.thumbnail` (`@db.Text`, base64) at
[schema.prisma:100](prisma/schema.prisma#L100) now looks vestigial — thumbnails
live in object storage. See LOG-19.

---

## UI-02 — `/templates` is a dead route with a complete feature behind it

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [templates/page.tsx](src/app/templates/page.tsx) |
| **Blocker** | **B** (decide: ship or remove) |

**Problem.** The page is five lines and calls `notFound()`. Everything else for
the feature exists and is reachable only as dead code:
`src/app/templates/TemplatesContent.tsx`, `src/app/templates/loading.tsx`,
`src/lib/hooks/use-templates.ts`, `/api/v1/templates`,
`/api/v1/templates/[templateId]`, and the `isTemplate` / `templateCategory` /
`templateDescription` / `usageCount` columns on `Canvas`.

**Why it matters.** A hard 404 on a route the product implies exists. Meanwhile
the API surface is live and gated by `requireTemplatesEnabled` — an endpoint
shipping to production that no UI consumes is attack surface with no user value.

**Fix.** Pick one. Either finish the page and remove the gate, or delete
`TemplatesContent.tsx` + `loading.tsx` + `use-templates.ts` and keep the API
disabled. Do not ship the current half-state.

---

## UI-03 — Public share page shows the wrong title and ignores the saved viewport

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [share/[token]/page.tsx:70-75](src/app/share/[token]/page.tsx#L70-L75) vs [share/[token]/route.ts:79-88](src/app/api/v1/share/[token]/route.ts#L79-L88) |
| **Blocker** | **B** |

**Problem.** The page does:

```ts
setCanvas(data);
setItems(data.items || []);
setZoom(data.zoomLevel || 1);
setPosition({ x: data.panX || 0, y: data.panY || 0 });
```

The API returns `{ items, canvas: { id, name, owner, zoomLevel, panX, panY }, total, offset, limit, hasMore }`.
So `data.zoomLevel` and `data.panX` are always `undefined`, and `canvas.name` is
`undefined` because `canvas` was set to the *envelope*, not `data.canvas`.

**Consequences.**
- The header always reads the fallback `"Shared Canvas"` — never the real name
  (three call sites: lines 227, 285, 297).
- The owner's saved zoom/pan is discarded; every visitor lands at 100% / (0,0),
  which on a canvas laid out away from the origin shows an empty viewport.
- `canvas.owner` is fetched by the API and never displayed at all.

**Fix.** `const { canvas: meta, items } = data;` then read from `meta`. Add a
type for the response instead of `useState<any>` (line 42) — `any` is what let
this ship.

---

## UI-04 — Public shares silently show only the first 50 items

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [share/[token]/route.ts:16-17](src/app/api/v1/share/[token]/route.ts#L16-L17), [share/[token]/page.tsx:57](src/app/share/[token]/page.tsx#L57) |
| **Blocker** | **B** |

**Problem.** The query schema defaults `limit` to 50 (max 100). The page fetches
`/api/v1/share/${token}` with **no** query parameters and never reads `total` or
`hasMore` from the response. There is no pagination, no "load more", no notice.

**Why it matters.** A public link is the primary way this product gets shared
outward. Sharing a 200-item canvas silently shows a stranger 50 items with no
indication that three quarters of the board is missing. The viewer cannot tell
truncated from empty.

**Fix.** Either page through until `hasMore` is false (cap it), or drive the
fetch from the viewport bounds the API already supports (`minX/maxX/minY/maxY`)
and load on pan/zoom. At minimum surface `total` so truncation is visible.

**Related.** Distinct from LOG-01, which truncates the *authenticated* item list
by byte budget. Both must be fixed; they have different causes.

---

## UI-05 — In-canvas search makes most item types disappear

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [use-canvas-data.ts:238-262](src/features/canvas/hooks/use-canvas-data.ts#L238-L262) |
| **Blocker** | **B** |

**Problem.** The filter only knows how to match `NOTE`, `BOOKMARK`, and `IMAGE`.
Every other type falls through to `return false`:

```ts
return false;   // TEXT, SHAPE, ARROW, FRAME, EMBED, POLL, DRAWING
```

**Why it matters.** Typing in the canvas search box doesn't filter — it *deletes*
the visual structure of the board. Frames, arrows, and shapes are the scaffolding
that makes a canvas legible; they vanish the moment a user types one character,
and reappear only when the box is cleared. Users will read this as data loss.

**Fix.** Two changes: (1) match `TEXT` on its text content, which is trivially
available; (2) treat structural types (`FRAME`, `ARROW`, `SHAPE`, `DRAWING`) as
always-visible context rather than filterable content — dim non-matches instead
of unmounting them.

---

## UI-06 — The accessible item panel is rendered twice on public shares

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [share/[token]/page.tsx:283-300](src/app/share/[token]/page.tsx#L283-L300) |
| **Blocker** | No |

**Problem.** `<CanvasAccessiblePanel>` is mounted once before the canvas region
(with `resolveCanvasCapabilities("VIEW")`) and again *inside* it (with
`NO_CANVAS_CAPABILITIES`), over the same `items` array.

**Why it matters.** Screen-reader users hear the entire canvas inventory twice,
with no signal that it is a repeat. This defeats the purpose of the panel, which
exists as the accessible equivalent of the Konva stage. Any `id` attributes
inside the panel are now duplicated in the document.

**Fix.** Keep the inner one (the region it describes is the one labelled
`role="region"`), delete the outer.

---

## UI-07 — Dashboard canvas count reports loaded rows, not the real total

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [DashboardContent.tsx:222-227](src/features/dashboard/components/DashboardContent.tsx#L222-L227) |
| **Blocker** | No |

**Problem.** The subtitle renders `${canvases.length} canvas(es)`, where
`canvases` is `pages.flatMap(...)` — only what has been fetched so far. The API
already returns `pagination.total`.

**Why it matters.** A user with 80 canvases is told they have 20 until they
click "Load more". It also makes the "Select all" affordance misleading, since
it selects only loaded rows while reading as *all*.

**Fix.** Use `pagination.total` for the count. Label the bulk action
"Select all loaded" or fetch ids for a true select-all.

---

## UI-08 — Single-canvas destructive actions are missing; delete copy is wrong

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [DashboardContent.tsx:480-491](src/features/dashboard/components/DashboardContent.tsx#L480-L491), [498-505](src/features/dashboard/components/DashboardContent.tsx#L498-L505) |
| **Blocker** | No |

**Problem.** The per-card overflow menu contains exactly one item: Duplicate.
There is no rename, no delete, no share, no move-to-workspace. To delete one
canvas a user must enter selection mode, select it, and use the bulk toolbar.

Separately, the confirmation says *"This action cannot be undone"* — which is
true (see LOG-08: canvas delete is a hard cascade), but the app also ships a
`/trash` route, so users reasonably expect recoverability. The copy and the
product's own mental model disagree.

**Fix.** Add rename / share / delete to the card menu. Make the dialog state the
real consequence: *"Permanently deletes N canvases and all their items,
comments, and versions. This cannot be undone and they will not appear in
Trash."*

---

## UI-09 — Notification preferences have a model and an API but no UI

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | `NotificationPreference` ([schema.prisma:305](prisma/schema.prisma#L305)), `/api/v1/notifications/preferences`, [AppShell.tsx:170-181](src/components/layout/AppShell.tsx#L170-L181) |
| **Blocker** | No |

**Problem.** Two gaps in the same feature. (1) No screen anywhere reads or writes
notification preferences — grepping the `.tsx` tree for `notifications/preferences`
or `NotificationPreference` returns nothing. (2) The bell icon in the shell has
no unread badge, so there is no signal that anything is waiting.

**Why it matters.** Users receive notifications they cannot turn off, and get no
indication when they arrive. For anything email-backed this becomes a
deliverability and trust problem rather than a UI nit.

**Fix.** Add a preferences section to Settings bound to the existing endpoint,
and a count badge on the bell driven by an unread query.

---

## UI-10 — Landing page makes claims the product cannot support

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [app/page.tsx](src/app/page.tsx) — lines 27-31, 185, 314, 43-47 |
| **Blocker** | **B** (legal/trust) |

| Claim | Reality |
| --- | --- |
| "Create **unlimited** canvases" (L29) | `LAUNCH_LIMITS.canvasesPerUser = 200`, `itemsPerCanvas = 2000` ([launch-limits.ts](src/lib/policy/launch-limits.ts)) |
| "No credit card required • **Free forever**" (L185) | Self-hosted product with no billing system at all — the statement is meaningless and implies a hosted plan |
| "Join **thousands of users**" (L314) | Unverifiable; false for a new install |
| "**Enterprise-grade** security" (L43-47) | Overclaim for a pre-launch build with 8% line coverage (PROD-02) |
| "Export as PNG, PDF, or JSON" (L57) | Verify against `src/lib/export` before shipping the claim |

**Why it matters.** This is the only page an unauthenticated visitor sees. For a
self-hostable product these lines are simply untrue of the reader's own
deployment, and "free forever" plus "no credit card" is the kind of copy that
attracts consumer-protection attention if a paid tier ever appears.

**Fix.** Rewrite to what is provably true: "Up to 200 canvases", "Self-host it
yourself", drop the user count and the enterprise adjective.

---

## UI-11 — Two parallel search experiences, one unreachable

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [AppShell.tsx:162-169](src/components/layout/AppShell.tsx#L162-L169), [DashboardContent.tsx:519-531](src/features/dashboard/components/DashboardContent.tsx#L519-L531) |
| **Blocker** | No |

**Problem.** The shell's search icon does `router.push("/search")` — a full page
navigation. `GlobalSearchDialog` also exists but its `open` state is only ever
set from `CommandPalette`'s `onSearch`. So the dialog is reachable exclusively
via ⌘K → Search, and only on the dashboard.

**Why it matters.** Two different search interactions with different results
surfaces, and the faster one is effectively hidden. Users on `/settings` or
`/trash` get no ⌘K at all, since the listener is registered in `DashboardContent`
([L107-117](src/features/dashboard/components/DashboardContent.tsx#L107-L117))
rather than in the shell.

**Fix.** Move the ⌘K handler into `GlobalShortcutsProvider` (which already
exists and wraps every page), and make the shell's search icon open the dialog.
Keep `/search` as the deep-link/permalink target.

---

## UI-12 — Accessibility baseline gaps

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [AppShell.tsx](src/components/layout/AppShell.tsx), app-wide |
| **Blocker** | No |

Measured across `src/app`, `src/components`, `src/features`: 61 `aria-label`
occurrences but only **5** `role=` attributes.

- **No skip-to-content link.** Keyboard users tab through brand, four nav items,
  search, notifications, theme, and account on every page before reaching
  content.
- **No `aria-current="page"`** on nav items — `isActive()` drives colour only
  ([AppShell.tsx:79-81](src/components/layout/AppShell.tsx#L79-L81)), so the
  current page is conveyed by contrast alone.
- **Landmarks are thin.** `<main>` and `<footer>` are set, but the desktop nav
  cluster (L129-157) is a bare `<Box>` — only the mobile drawer gets
  `role="navigation"`.
- **Active-state colour contrast** relies on `alpha(primary.main, 0.08)` — verify
  against WCAG AA.

**Fix.** Add a visually-hidden skip link as the first focusable element;
`aria-current` on active nav; wrap the desktop nav in `<nav aria-label="Main">`.

---

## UI-13 — Activity feed is desktop-only

| | |
| --- | --- |
| **Severity** | Low |
| **Location** | [DashboardContent.tsx:429-440](src/features/dashboard/components/DashboardContent.tsx#L429-L440) |
| **Blocker** | No |

`display: { xs: "none", md: "block" }` removes the feed entirely below `md`.
Mobile users have no route to activity history at all — it isn't collapsed or
moved to a tab, it's gone. Give it a tab or an accordion below the grid.

---

## UI-14 — Canvas item operations fail silently

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [use-canvas-item-handlers.ts:82, 114, 162, 190](src/features/canvas/hooks/use-canvas-item-handlers.ts#L82) |
| **Blocker** | **B** |

**Problem.** Delete, bulk delete, duplicate, and paste all swallow failures into
`console.error` (or, for paste, a bare `catch {}`). The app has `sonner`
installed and toasts elsewhere — these paths just don't use it.

**Why it matters.** Optimistic updates mean the item visibly disappears on
delete. If the request then fails (409 version conflict, 403 after a share was
revoked, offline), the rollback restores it with no explanation — the item
"comes back from the dead". Users retry, and on a partial bulk delete
(`Promise.all`, L54-58) some items are gone and some aren't with zero feedback.

**Fix.** Surface `toast.error` with the server's `detail`. For bulk operations
use `Promise.allSettled` and report "Deleted 3 of 5 — 2 failed". Version
conflicts deserve a specific message and a refresh affordance.

---

## UI-15 — Minor route and state issues

| | | |
| --- | --- | --- |
| **UI-15a** | Low | `/profile` ([page.tsx](src/app/profile/page.tsx)) is a stub that redirects to `/settings`, yet ships its own `loading.tsx`. Either delete the route or give it real content. |
| **UI-15b** | Low | `handleCreateCanvas` fires on Enter ([DashboardContent.tsx:462-464](src/features/dashboard/components/DashboardContent.tsx#L462-L464)) with no `isPending` guard, while the button *is* guarded (L472). Holding Enter double-submits. |
| **UI-15c** | Low | `handleFitToScreen` ([share page L118-141](src/app/share/[token]/page.tsx#L118-L141)) divides by `contentWidth`/`contentHeight`, which are `0` for a single zero-size item → `Infinity` zoom. |
| **UI-15d** | Low | Presence colours rotate from a global `colorIndex` ([websocket-server.ts:177-186](src/lib/collaboration/websocket-server.ts#L177-L186)); with >8 concurrent users two collaborators share a cursor colour with no disambiguation. |
| **UI-15e** | Low | `handlePaste` inserts at `100 + Math.random() * 50` rather than at the cursor ([use-canvas-item-handlers.ts:153-154](src/features/canvas/hooks/use-canvas-item-handlers.ts#L153)). |

---

## Recommended UI Priorities Before Production

Ordered by user-visible damage per unit of fix effort.

| # | Finding | Why first |
| --- | --- | --- |
| 1 | **UI-05** search hides item types | Reads as data loss on the core surface; small, contained fix |
| 2 | **UI-04** public shares capped at 50 | Breaks the outward-facing flow that drives adoption |
| 3 | **UI-03** share page wrong name/viewport | Same flow, same file, fix together with UI-04 |
| 4 | **UI-14** silent canvas failures | Users cannot tell success from failure while editing |
| 5 | **UI-01** dashboard thumbnails | First authenticated screen; the backend work already runs |
| 6 | **UI-02** `/templates` 404 | Ship-or-delete decision; blocks a clean launch surface |
| 7 | **UI-10** untrue landing-page claims | Trust and legal exposure; pure copy edit |
| 8 | **UI-08** delete affordances + copy | Data-loss adjacent (pairs with LOG-08) |
| 9 | **UI-07** wrong canvas count | Cheap correctness win |
| 10 | **UI-12** a11y baseline | Skip link + `aria-current` are hours, not days |
| 11 | **UI-06** duplicate a11y panel | One-line deletion |
| 12 | **UI-09** notification preferences | Needs new UI; schedule after launch-blockers |
| 13 | **UI-11** unify search | Refactor, not a defect |
| 14 | **UI-13**, **UI-15a–e** | Polish |

**Blockers (7):** UI-01, UI-02, UI-03, UI-04, UI-05, UI-10, UI-14.
