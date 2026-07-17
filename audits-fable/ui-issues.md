# UI / UX Issues

Severity: Critical / High / Medium / Low. "Blocker" = should not launch without fixing.

> **Progress (2026-07-14):** U-2, U-3, U-5, U-6, U-10, and U-13 have been
> fixed on branch `claude/audits-fable-ui-issues-w577ob`. See the per-issue
> **Status** lines below.

---

## U-1. Native `confirm()` dialogs throughout the canvas experience

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx:841,1159`, `NoteItem.tsx:128`, `BookmarkItem.tsx:174`, `ImageItem.tsx:145`, `VersionHistoryDialog.tsx:64`
- **Problem:** Destructive actions (delete note/bookmark/image, restore version, autopilot reorganize) use browser-native `confirm()` while the rest of the app uses MUI dialogs (`use-delete-confirmation.ts` exists and is used elsewhere). Native dialogs block the main thread, ignore theming, can be suppressed by the browser ("prevent this page from creating dialogs"), and look broken next to the polished MUI shell.
- **Fix:** Replace all six call sites with the existing MUI confirmation dialog hook.
- **Blocker:** No.

## U-2. Permanently disabled Google/GitHub sign-in buttons on login and register

- **Severity:** Medium
- **Location:** `src/features/auth/components/LoginForm.tsx:167-197` ("or continue with" divider + two `disabled` buttons), same pattern in `RegisterForm.tsx`
- **Problem:** No OAuth providers are configured in `src/lib/auth.ts` (credentials only), yet both auth screens advertise Google/GitHub buttons that are permanently disabled. Users will assume the feature is broken.
- **Fix:** Remove the divider and buttons (or gate them on configured providers).
- **Blocker:** No, but it's the first screen every user sees — high polish value.
- **Status:** ✅ Fixed — removed the "or continue with" divider and the disabled Google/GitHub buttons (plus now-unused imports) from `LoginForm.tsx` and `RegisterForm.tsx`.

## U-3. Account-lockout feedback is swallowed — user sees "Invalid email or password"

- **Severity:** Medium-High
- **Location:** `src/lib/auth.ts:37-47` (authorize throws a descriptive lockout Error), `LoginForm.tsx:64-67` (any `result.error` → generic message)
- **Problem:** When an account is locked, NextAuth surfaces an error to the client, but the form maps every error to "Invalid email or password". A locked-out user will keep retrying (extending the lockout) with no idea why. The same generic mapping hides rate-limit 429s.
- **Fix:** Distinguish `CredentialsSignin` from custom error codes (NextAuth v5 supports typed errors) and show the lockout/retry-after message.
- **Blocker:** No.
- **Status:** ✅ Fixed — `authorize` now throws a typed `AccountLockedError extends CredentialsSignin` with `code = "account_locked"` (instead of a plain `Error`); `LoginForm` reads `result.code` and shows a distinct lockout message, still falling back to the generic message for real credential failures.

## U-4. Canvas is effectively desktop-only: no touch interaction wiring, hardcoded layout math

- **Severity:** High (if mobile/tablet is in scope)
- **Location:** `CanvasBoard.tsx:930-944` (Stage binds only `onMouseDown/Move/Up/Click`), `:349-359` (`window.innerHeight - 64` magic header offset), `use-canvas-interaction.ts`
- **Problem:** Konva stage handlers are mouse-only — no `onTouchStart/onTap` equivalents, so selecting, drawing, dragging-to-select, and context menus don't work on touch devices; only pinch-zoom (use-gesture) works. The stage sizes itself with `window.innerHeight - 64`, which breaks under mobile browser chrome / dynamic viewports and if the header wraps.
- **Fix:** Bind Konva's touch events (or pointer events), use a `ResizeObserver` on the container instead of window math, and test on iOS Safari. If mobile is out of scope for v1, add an explicit "best on desktop" notice instead of a silently dead canvas.
- **Blocker:** Yes if mobile users are expected; otherwise document the limitation.

## U-5. Canvas surface ignores dark mode

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx:898` (`bgcolor: "#f0f2f5"` hardcoded), item components (sticky-note colors, `GridOverlay` stroke colors)
- **Problem:** The app shell has full light/dark theming (`ThemeModeProvider`, tokens in `lib/theme.ts`), but the canvas area hardcodes a light gray background and light-tuned item styles — dark-mode users get a blinding white board inside a dark shell.
- **Fix:** Use `theme.palette.background` tokens for the stage container and derive grid/item chrome colors from the theme.
- **Blocker:** No.
- **Status:** ✅ Fixed — the stage container background is now theme-aware (`#f0f2f5` light / `#0d1526` dark) and `GridOverlay` accepts a `stroke` prop, which `CanvasBoard` sets per theme mode (`#e0e0e0` light / `#1e293b` dark). (Sticky-note/item palette theming not yet addressed.)

## U-6. Error alert on canvas can't be dismissed; retry affordance is misleading

- **Severity:** Low
- **Location:** `CanvasBoard.tsx:864-882` (`<Alert onClose={() => {}}>`)
- **Problem:** The canvas-load-error alert renders a close (X) button whose handler is a no-op, so it can never be dismissed. `refreshMetadata` only refetches canvas metadata, not items, so "Retry" may not fix the actual failure.
- **Fix:** Wire `onClose` to clear `canvasLoadError`; make Retry refetch both canvas and items queries.
- **Blocker:** No.
- **Status:** ✅ Fixed — `useCanvasData` now exposes `clearCanvasLoadError` (wired to the Alert's `onClose`) and `refreshMetadata` refetches both the canvas and items queries.

## U-7. Copy works, paste does nothing

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx:285-298` (`onCopy` writes JSON to clipboard, `onPaste: () => {}`), context menu "Copy" (`handleCopyFromMenu:607-618`)
- **Problem:** Ctrl+C and the context-menu Copy write item JSON to the system clipboard, but Ctrl+V is an explicit no-op — the copy affordance is a dead end (`src/lib/canvas/clipboard.ts` exists but isn't wired here). Users will assume the app is broken.
- **Fix:** Implement paste from the clipboard payload (with offset positioning), or remove Copy until paste exists.
- **Blocker:** No.

## U-8. Undo/redo buttons over-promise

- **Severity:** Medium
- **Location:** `CanvasHeader` undo/redo props from `CanvasBoard.tsx:814-817`
- **Problem:** Header shows global undo/redo, but only keyboard deletions are recorded (see L-10). Moving, resizing, editing, creating, and menu-deleting are not undoable; redo after undo fails silently because recreated items get new IDs.
- **Fix:** Either wire all mutations through the command stack or hide the buttons.
- **Blocker:** No.

## U-9. Dead/placeholder feature buttons in the canvas header

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx:827-828` (`onPresentationMode: () => {}`, `isPresentationMode={false}`), Whisper/AR/Serendipity/Autopilot entries
- **Problem:** Presentation mode is a visible button wired to a no-op. AR mode (`ARCanvasLayer`), Whisper mode, Serendipity, and Autopilot are experimental features exposed as first-class header actions with no explanation, loading affordances, or flagging; Autopilot mutates dozens of items behind a native `confirm()`.
- **Fix:** Remove or feature-flag experimental actions; every remaining action needs a working handler, a loading state, and an MUI confirm.
- **Blocker:** No (but remove no-op buttons before launch).

## U-10. Dashboard `Suspense` has no fallback

- **Severity:** Low
- **Location:** `src/app/dashboard/page.tsx:21-23` (`<Suspense>` without `fallback`)
- **Problem:** While `DashboardContent` suspends (it uses suspense queries via `useCanvasItems` pattern), the page renders nothing below the AppShell — a blank flash instead of the skeletons used elsewhere (notifications page does this correctly).
- **Fix:** Provide a skeleton fallback consistent with `NotificationSkeleton`/`CanvasSkeleton`.
- **Blocker:** No.
- **Status:** ✅ Fixed — added `DashboardSkeleton` (page header + canvas card grid) and passed it as the `Suspense` `fallback` in `dashboard/page.tsx`.

## U-11. Anonymous/fallback identity leaks into collaboration UI

- **Severity:** Low-Medium
- **Location:** `CanvasBoard.tsx:400-406` (`name: session?.user?.name || "Anonymous"`, `email: "anon@example.com"`, `userId: "anon"`), `CursorChat` send path (`userColor: "#f00"` hardcoded at `:985`)
- **Problem:** Before session hydration (or for guests) the UI presents "Anonymous"/placeholder identities and a hardcoded red chat color that doesn't match the server-assigned presence color, so a user's cursor color and chat color disagree. Presence avatars also render collaborator emails (see L-11 privacy note).
- **Fix:** Wait for session hydration before connecting (fixes L-17 too); use the server-assigned color; show names, not emails.
- **Blocker:** No.

## U-12. Session-expiry and 401 handling: silent dead UI instead of redirect

- **Severity:** Medium
- **Location:** client fetchers in `src/lib/hooks/*` (e.g., `use-canvas-items.ts:90-179`) throw generic `Error('Failed to fetch items')` regardless of status; no global 401 → sign-in redirect
- **Problem:** When the JWT expires mid-session, every query/mutation starts failing with generic toasts/messages; TanStack retries 401s 3 times (default `retry: 3` in `providers.tsx:38`) before surfacing. The user is never sent to the login page.
- **Fix:** Central fetch wrapper: on 401 redirect to `/auth/login?callbackUrl=…`; skip retries for 4xx.
- **Blocker:** No, but very visible in long sessions.

## U-13. Keyboard shortcuts fire while typing / space-pan conflicts

- **Severity:** Medium
- **Location:** `CanvasBoard.tsx:421-433` (global window Space listener with no target check)
- **Problem:** The Space key handler flips pan mode even when focus is in a dialog text field, the canvas name input, or cursor chat — typing a space while a dialog is open toggles `isSpacePressed` and can change Stage draggability under the dialog. (The main shortcut hook takes `enabled: !isDrawing` but the space listener is separate and unconditional.)
- **Fix:** Ignore key events when `event.target` is an input/textarea/contentEditable; scope listeners to the stage container.
- **Blocker:** No.
- **Status:** ✅ Fixed — the Space listener now ignores events whose `target` is an `INPUT`/`TEXTAREA`/`contentEditable` element, so typing a space in a dialog or the canvas-name/cursor-chat inputs no longer toggles pan mode.

## U-14. Service worker caches authenticated pages at install and can serve stale shells

- **Severity:** Medium
- **Location:** `public/sw.js:6-11` (pre-caches `/`, `/dashboard`, `/templates` under a fixed `CACHE_NAME 'canvascollect-v1'`)
- **Problem:** `/dashboard` is an authenticated, personalized page; pre-caching it can flash another state or fail for logged-out users, and the fixed cache name means deploys keep serving the old app shell until the SW is manually bumped. Brand string is also stale ("canvascollect").
- **Fix:** Cache only static assets; use a build-hash cache name; add an update flow (skipWaiting + reload prompt). Or drop the PWA for v1.
- **Blocker:** No.

## U-15. List pages: verify empty/loading/error triads

- **Severity:** Low
- **Location:** `/shared`, `/search`, `/templates`, `/workspaces`, `/api-keys` content components
- **Observation:** Spot-checks (`NotificationsContent`) show good skeleton + `EmptyState` + error alert patterns. Not every page was read line-by-line; before launch, verify each of the five list pages handles: loading skeleton, error with retry, empty state with CTA, and pagination beyond 50 items (`DEFAULT_PAGE_LIMIT`) — the dashboard fetches with default limit and no visible pager was found in the code read.
- **Blocker:** No.

## U-16. Accessibility gaps on the canvas

- **Severity:** Medium (High if a11y is a requirement)
- **Location:** Konva `<Stage>` in `CanvasBoard.tsx` (no ARIA, no keyboard item navigation), color-only presence indicators, `docs/ACCESSIBILITY.md` promises more than the canvas delivers
- **Problem:** The canvas is a raw `<canvas>` with no accessible alternative: items can't be reached or activated by keyboard, screen readers see nothing, and collaborator identity is conveyed by color alone. The shell (AppShell, forms, dialogs) is in decent shape (labels, aria-labels present).
- **Fix (pragmatic v1):** Provide the existing Organizer view as the documented accessible alternative, add an SR-only item list, ensure all header actions are keyboard reachable with visible focus.
- **Blocker:** Depends on your compliance target (e.g., WCAG for customers).

## U-17. Thumbnail churn causes visible network noise and stale dashboard previews

- **Severity:** Low
- **Location:** `CanvasBoard.tsx:536-542` (3 s after any item change → `toDataURL` → PATCH), `Canvas.thumbnail` stored as base64 Text
- **Problem:** Every edit burst re-uploads a base64 JPEG thumbnail; dashboards elsewhere show whatever was last captured (can be a mid-drag frame). Also inflates the canvases list payload (see P-3).
- **Fix:** Debounce on idle (e.g., 30 s / on navigation away), and store thumbnails in object storage, not the DB row.
- **Blocker:** No.

---

## Recommended UI Priorities Before Production

1. **U-4** — Decide mobile posture: wire touch events + container-based sizing, or explicitly gate mobile. (Highest user-facing risk.)
2. **U-12** — Global 401 handling → login redirect; stop retrying 4xx.
3. **U-2** — Remove disabled OAuth buttons from login/register.
4. **U-3** — Surface lockout/rate-limit reasons on the login form.
5. **U-9 / U-8 / U-7** — Remove or finish dead affordances (presentation mode, paste, undo scope) — nothing erodes trust faster than buttons that do nothing.
6. **U-1** — Replace native `confirm()` with the MUI confirm dialog everywhere.
7. **U-5** — Theme the canvas surface for dark mode.
8. **U-13** — Fix keyboard handling while inputs are focused.
9. **U-10 / U-15** — Suspense fallback on dashboard; verify empty/error states on all list pages.
10. **U-14** — Fix or remove the service worker before first deploy (stale-shell bugs are miserable to debug post-launch).
