# UI, UX, and accessibility audit

## Surface inventory

The project has route coverage for the primary product areas:

- Public: landing, login, registration, forgot/reset password, email verification, first-run setup, public canvas share.
- Authenticated: dashboard, canvas, shared-with-me, workspaces, templates, search, notifications, settings, API keys.
- `/profile` intentionally redirects to Settings; `/auth/signin` redirects to Login.

No broken in-app navigation target was found in the current source. The main issue is not missing route files; it is that several visible controls are incomplete, core canvas interaction state is inconsistent, permissions are not reflected in the UI, and the canvas has no equivalent keyboard/screen-reader interaction model.

## High-priority product and interaction findings

### UX-01 — Presentation Mode is a visible no-op

`CanvasBoard` hardcodes `isPresentationMode = false` and passes `onPresentationMode={() => {}}` (`src/features/canvas/components/CanvasBoard.tsx:778`, `:827`). CanvasHeader renders an enabled Presentation button whenever that callback exists. Clicking it has no effect.

Remove the control until implemented, or add a real stateful mode with escape behavior, hidden editing chrome, focus handling, and read-only semantics.

### UX-02 — Copy advertises a clipboard format that Paste ignores

Keyboard Copy serializes selected item data to the system clipboard, while the registered Paste callback is explicitly empty (`src/features/canvas/components/CanvasBoard.tsx:285-299`). The user gets no feedback and Ctrl/Cmd+V does nothing.

Implement validated clipboard import with new IDs/offset placement and permissions, or remove/intercept neither shortcut. Support multi-select and external text/URL paste intentionally.

### UX-03 — Undo/redo is narrow and internally broken for delete

Only delete paths call `addCommand` (`CanvasBoard.tsx:240`, `:275`); create, text edits, moves, resizes, alignment, autopilot, and metadata edits are not undoable. Delete undo creates a **new** item with a new ID, but redo calls delete on the old already-soft-deleted ID (`:215-279`), so redo cannot faithfully reapply the command. Comments/connections/attribution are not restored.

Define a server-supported reversible operation model or command patches with stable IDs. Until complete, label the control narrowly or hide it rather than imply general undo safety.

### UX-04 — Canvas pan/selection state is unreliable

The editable Stage is draggable with no controlled drag handlers, while selection begins on the same empty-stage mouse-down and uses stale React position. See `COR-04`. This produces temporary/jumping pan, offset selection/item placement, and inverted Space-to-pan behavior. Mouse-wheel zoom is absent from the main canvas even though the public viewer implements it.

This should be fixed before visual polish: core spatial interaction must be deterministic across mouse, trackpad, touch, rerender, and refetch.

### UX-05 — Shared-canvas controls do not reflect role

VIEW/COMMENT/EDIT users see the owner's full editing and management UI. Many actions optimistically change local state and only later fail at the API. This is confusing, noisy, and risky around destructive/version actions.

Use a single capability map to render owner/edit/comment/view modes; provide a clear role badge; explain disabled actions; ensure COMMENT can comment without edit chrome and VIEW is genuinely read-only.

### UX-06 — The canvas is inaccessible to keyboard and screen-reader users

Konva renders items into a `<canvas>` with no semantic DOM tree, focus order, accessible name/description, or keyboard selection/edit surface. Item components may have `onTap`, but the Stage has mouse-only selection/drawing handlers (`CanvasBoard.tsx:937-941`). The Organizer view is useful but is not presented as an accessibility alternative and does not make the manual canvas itself operable.

Provide an equivalent DOM outline/list with item type, content summary, position/group, selection, edit/delete/move actions, and focus synchronization. Add keyboard creation/navigation and announce selection/save/conflict states. Test with NVDA/JAWS/VoiceOver, keyboard-only use, and zoom/reflow.

### UX-07 — CanvasHeader cannot fit its feature set responsively

One MUI Toolbar contains back/name/view switch, undo/redo, share, presence, meeting timer, presentation, AI, serendipity, templates, autopilot, whisper, time machine, AR, filters, search, zoom, and a menu (`src/features/canvas/components/CanvasHeader.tsx:248-655`). There is no responsive collapse strategy or horizontal overflow treatment. Laptop zoom, localization, long names, and mobile widths will clip/crowd controls.

Keep only core actions visible, move secondary/experimental features into grouped menus, collapse name/presence responsively, and test 320/375/768/1024 px plus 200% browser zoom.

### UX-08 — AR repeatedly reacquires/stops the camera stream

`stopCamera` depends on `stream`; the open effect depends on `stopCamera` (`src/features/canvas/components/ARCanvasLayer.tsx:72-90`). Each successful `setStream` changes the callback, reruns the effect, starts another `getUserMedia`, then cleanup stops the prior stream. This can loop camera acquisition and flicker/fail.

Hold the stream in a ref, run acquisition only on `open` transition, stop exactly once on close/unmount, and test permission denial/device changes. Add accessible names to fullscreen/close controls.

## Visible incomplete features

| ID | Severity | Finding | Evidence / action |
|---|---|---|---|
| UX-09 | Medium | Drawing color swatch is a clickable `<div>` whose handler is an empty placeholder. | `DrawingToolbar.tsx:72-84`. Implement an accessible color input/menu or remove the affordance. |
| UX-10 | Medium | Embed items are placeholders, not embeds. | `EmbedItem.tsx:20-64` shows type and URL only. Rename to link preview or implement a sandboxed, allowlisted embed policy. |
| UX-11 | Medium | “Whisper Mode” is ordinary text quick-entry, not voice input. | `WhisperMode.tsx` displays a microphone icon but uses only a TextField. Rename it “Quick capture” or add explicit consented speech input and privacy controls. |
| UX-12 | Medium | Missing OpenAI key silently returns fake AI prose. | `src/lib/ai/service.ts:16-22` waits one second and labels a simulation as a generated result. Disable the feature with setup guidance in production; never save mock output as user content. |
| UX-13 | Medium | OAuth buttons are rendered permanently disabled. | Login/Register show Google and GitHub under “continue/sign up with.” Hide unavailable providers or make provider availability config-driven. |
| UX-14 | Medium | Meeting timer is local-only inside a collaborative header. | `MeetingTimer` has component-local state and no collaboration channel. Label it personal or synchronize an owner-controlled meeting state. |
| UX-15 | Medium | Autopilot can leave a partial layout. | It updates items sequentially; the first conflict/network error stops later updates, with no rollback. Use a batch endpoint/preview and report per-item failures. |

## Accessibility findings

### UX-16 — Several icon-only controls lack an accessible name

Concrete examples include AR fullscreen/close (`ARCanvasLayer.tsx:182-186`), CommentsPanel close/menu (`CommentsPanel.tsx:206`, `:258-263`), ShareDialog close/copy/revoke (`ShareDialog.tsx:234-236`, `:287`, `:344-348`), Whisper close/send, and MeetingTimer close/reset. Some CanvasHeader controls are wrapped in MUI Tooltips, but explicit `aria-label` remains safer and several controls are not wrapped.

Add stable accessible names and tests using `getByRole('button', { name: ... })`.

### UX-17 — Canvas rename is pointer-only text

The non-editing canvas name is a clickable Typography with no button role, tab stop, or keyboard handler (`CanvasHeader.tsx:309-325`). Make it a real Button or pair the heading with an accessible Edit button; gate it to owners.

### UX-18 — Drawing color is neither keyboard-operable nor semantic

The color control is a bare clickable div with no role/name/tabIndex (`DrawingToolbar.tsx:73-84`). A proper `<input type="color">` or menu button solves both the current no-op and accessibility issue.

### UX-19 — Native `confirm`/`prompt` disrupt focus and consistency

Destructive item/version/autopilot actions use browser confirm in CanvasBoard, NoteItem, BookmarkItem, ImageItem, and VersionHistoryDialog; RichTextEditor uses `window.prompt` for links. These dialogs are not themeable, have inconsistent copy, and make focus/error handling brittle.

Use the existing confirmation-dialog hook consistently, retain focus, describe irreversible effects, and show in-context validation.

### UX-20 — Quick overlays lack dialog semantics/focus containment

Whisper, drawing, chat, reaction, and floating toolbars are visually modal/temporary but generally remain plain fixed Boxes. Keyboard focus can remain behind them; screen readers are not told that a new interaction surface opened. Use Dialog/Popover semantics as appropriate and restore invoking focus on close.

### UX-21 — Dark mode stops at a hardcoded light canvas

The manual canvas background is always `#f0f2f5` (`CanvasBoard.tsx:893-904`), and many canvas item fills use fixed light colors. Theme toggle therefore yields a mixed, glare-heavy interface and may create contrast problems. Move canvas/item palettes into theme tokens and verify WCAG contrast in both modes.

### UX-22 — Fixed viewport/header assumptions hurt mobile and zoom

CanvasBoard uses `height: 100vh`, `window.innerWidth`, and `window.innerHeight - 64` (`CanvasBoard.tsx:346-355`, `:781-789`). This ignores mobile dynamic viewport units, safe-area insets, alternate toolbar height, error banners, and browser zoom. Measure the actual container with ResizeObserver and use `100dvh`/safe-area-aware layout.

### UX-23 — Reduced-motion behavior is not defined

The product uses MUI transitions, animated overlays, SpeedDial, cursor/reaction motion, and AR without a visible reduced-motion policy. Honor `prefers-reduced-motion`, disable nonessential movement, and test focus/reading order when animation is removed.

## Error, feedback, and navigation findings

| ID | Severity | Finding | Evidence / action |
|---|---|---|---|
| UX-24 | High | Item-load failure can look like an empty canvas. | `useCanvasData` captures canvas metadata error but destructures only `data` from `useCanvasItems`; item error is not surfaced. Aggregate both and never present failed data as empty content. |
| UX-25 | Medium | Canvas error Retry refetches metadata only and close does nothing. | `CanvasBoard.tsx:865-881`; `onClose={() => {}}`. Retry all failed resources; remove the close affordance or implement dismissal. |
| UX-26 | Medium | Login hides lockout/retry guidance behind “Invalid email or password.” | `LoginForm.tsx:59-65`. Preserve anti-enumeration, but show a generic rate-limit/temporary-lock message and retry time for 429/lock responses. |
| UX-27 | Medium | Search opens the canvas but not the matching item. | GlobalSearchDialog/SearchContent route only to `/canvas/{id}`. Add an item query/fragment, center/select it after load, and preserve keyboard focus. |
| UX-28 | Medium | Search silently ignores non-OK responses in the dialog. | GlobalSearchDialog leaves prior/empty results without user error. Show a retryable status and cancel stale requests. |
| UX-29 | Medium | No pagination/load-more is exposed for canvases, comments, templates, or activities. | APIs return bounded pages/metadata, but screens stop at the first page. Add accessible incremental loading and totals. |
| UX-30 | Medium | Public share panning is uncontrolled. | The read-only Stage is `draggable={true}` without a drag state handler (`src/app/share/[token]/page.tsx:287-299`); a rerender/zoom can snap it back. Use controlled pan as in the repaired editor. |
| UX-31 | Medium | Public share has no `noindex`/privacy metadata. | The route is a client page with no robots metadata. Secret/public links can be indexed if discovered. Add a server layout/page metadata wrapper with `noindex,nofollow` by default. |
| UX-32 | Medium | Public API overreturns internal item fields. | `/api/v1/share/[token]` returns full Prisma item rows. Select only render-safe fields; omit creator/updater IDs, deletion/audit fields, and internal versions unless needed. |
| UX-33 | Medium | Dashboard and Search Suspense boundaries have no fallback. | Their pages render `<Suspense>` without `fallback`, producing avoidable blank transitions. Supply skeletons that preserve layout. |
| UX-34 | Low | Browser clipboard failure is not handled. | API key/share/canvas copy assumes `navigator.clipboard` succeeds. Catch permission/insecure-context errors and offer a selected text fallback. |
| UX-35 | Medium | Soft delete has no trash/recovery surface. | Deleted records/versions exist, but users cannot inspect retention or restore individual items. Add Trash with owner-only access, retention date, restore, and permanent delete. |

## Production page gaps

These are product-readiness gaps rather than necessarily code defects:

- No offline/fallback page despite registering a PWA service worker.
- No privacy/terms/data-export explanation alongside analytics, camera, AI, uploads, and account deletion.
- No onboarding/status page that verifies email, object storage, AI, or integration setup.
- No invite-acceptance or notification workflow for email-based shares; access appears only after the recipient already has/uses that email account.
- No support/help surface for shortcuts, sharing roles, data retention, or experimental features inside the application.

## What is already solid

- Authenticated non-canvas pages share a coherent responsive AppShell with a mobile drawer and named primary controls.
- Most forms use labels, validation, sensible loading states, and MUI primitives.
- Empty states, skeletons, theme tokens, and route-level error/not-found pages are present.
- Organizer view is a promising basis for an accessible alternative once it is linked to focus/selection and permission semantics.
