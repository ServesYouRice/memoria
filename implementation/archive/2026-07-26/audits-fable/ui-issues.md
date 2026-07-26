# UI / UX Audit — Memoria

Findings are ordered by severity. Every UI claim below was verified against the source; file references are exact.

---

## UI-1 — Unverified users get "Invalid email or password" and are told to sign in right after registering

- **Severity:** High
- **Location:** `src/lib/auth.ts:71` (authorize), `src/features/auth/components/LoginForm.tsx:56-64`, `src/features/auth/components/RegisterForm.tsx`, `src/app/auth/login/page.tsx`
- **Problem:** In production, `authorize()` rejects unverified accounts by throwing a plain `Error("Verify your email before signing in.")` (`src/lib/auth.ts:71`). Because it is not a `CredentialsSignin` subclass with a `code` (unlike `AccountLockedError`), the client only sees a generic failure, and `LoginForm` maps everything except `account_locked` to **"Invalid email or password"**. Meanwhile the registration flow redirects to `/auth/login?registered=true` and shows **"Account created successfully! Please sign in."** — the register form contains no mention of email verification even though the API returns `verificationRequired: true`.
- **Why it matters:** Every new production user hits this wall: register → told to sign in → sign in fails with a wrong error message → no pointer to the verification email or a resend action. This is a first-session funnel killer and will generate support load immediately. It is invisible in development because the verification gate is production-only (`NODE_ENV === "production"` check at `src/lib/auth.ts:70`).
- **Recommended fix:**
  1. Add an `EmailNotVerifiedError extends CredentialsSignin { code = "email_not_verified" }` in `src/lib/auth.ts` and handle that code in `LoginForm` with a "Verify your email — resend link" action (a resend endpoint already exists at `/api/v1/auth/send-verification`).
  2. After registration, show a "Check your inbox to verify your email" screen instead of "Please sign in."
- **Blocker before production:** **Yes** — this breaks the sign-up funnel for every real user.
- **Related risks:** The dev/prod behavioral difference means no amount of local testing will catch it; add an e2e test that runs with the production verification gate on (see `testing-gaps.md` T-2).

## UI-2 — Images on canvas fail silently with no error state, placeholder, or retry

- **Severity:** High
- **Location:** `src/features/canvas/components/ImageItem.tsx:70-77`
- **Problem:** When an image fails to load, `img.onerror` only does `console.error(...)`. The Konva node renders nothing useful — no broken-image placeholder, no retry, no tooltip. Combined with logical issue L-1 (image reads are rate-limited to 10/hour/IP and served `no-store`), users on image-heavy canvases will see images silently vanish.
- **Why it matters:** Silent data "loss" is the worst kind of failure for a note-taking product — users can't distinguish "image deleted" from "image temporarily failed to load," which erodes trust.
- **Recommended fix:** Render an explicit error placeholder (icon + filename + "Retry" affordance) in `ImageItem` when load fails, and surface a toast when many images fail at once (indicative of rate limiting or storage outage).
- **Blocker before production:** Yes in combination with L-1; the placeholder itself is High but not independently blocking.

## UI-3 — Deep-link return-to is lost on login (no `callbackUrl` round-trip)

- **Severity:** Medium
- **Location:** `src/app/dashboard/page.tsx:16`, `src/app/canvas/[canvasId]/page.tsx`, `src/app/notifications/page.tsx`, `src/app/trash/page.tsx` (and all other protected pages), `src/features/auth/components/LoginForm.tsx:69-71`
- **Problem:** Every protected page does `redirect("/auth/login")` without a `callbackUrl`, and after successful sign-in `LoginForm` hard-codes `router.push("/dashboard")`. A user following a shared canvas link (`/canvas/abc`) who has to sign in lands on the dashboard, not the canvas they were invited to.
- **Why it matters:** Email-share collaboration is a core flow; the invitee's first experience is being dumped somewhere else and having to find the canvas manually (shared canvases live on a separate `/shared` page).
- **Recommended fix:** Redirect with `redirect(\`/auth/login?callbackUrl=${encodeURIComponent(pathname)}\`)` and honor a same-origin-validated `callbackUrl` in `LoginForm` after `result.ok`.
- **Blocker before production:** No, but strongly recommended before inviting external collaborators.

## UI-4 — No route-level `loading.tsx` anywhere and only a single root error boundary

- **Severity:** Medium
- **Location:** `src/app/` (only `src/app/error.tsx` and `src/app/not-found.tsx` exist; zero `loading.tsx`, no `global-error.tsx`, no nested `error.tsx`)
- **Problem:**
  - No `loading.tsx` for any route: server-rendered navigations (dashboard, canvas, settings, templates…) show a blank/frozen screen until the RSC payload arrives. Dashboard mitigates this with a manual `<Suspense fallback={<DashboardSkeleton/>}>`, but other pages don't.
  - A single root `error.tsx` means any client render error inside the canvas (Konva is a large, crash-prone surface) unmounts the entire app shell instead of failing within the canvas region.
  - No `global-error.tsx`: an error thrown in the root layout (theme/Emotion/providers) yields the unstyled Next.js default error page.
- **Why it matters:** Perceived performance and blast-radius containment. One bad canvas item type (malformed `content` JSON) shouldn't take out navigation.
- **Recommended fix:** Add `loading.tsx` skeletons for `dashboard`, `canvas/[canvasId]`, `settings`, `templates`, `shared`, `trash`; add `src/app/canvas/[canvasId]/error.tsx` with a "Reload canvas / Back to dashboard" recovery UI; add `global-error.tsx`.
- **Blocker before production:** No.

## UI-5 — Canvas is not accessible to keyboard/screen-reader users (known, still open)

- **Severity:** High (product risk), tracked
- **Location:** `src/features/canvas/components/CanvasBoard.tsx:1021-1022` (single `role="region"` with a label pointing at the Organizer view), `REMAINING-WORK.md` UX-03/06
- **Problem:** The Konva `<canvas>` surface exposes exactly one ARIA region whose label tells users to switch to the Organizer view. The organizer is read-only, so there is no non-pointer way to create/edit/move/delete items. Keyboard deletion and labels exist but the team's own audit concedes this is "not a full accessible alternative."
- **Why it matters:** If this product is sold to companies or the public sector, WCAG 2.1 AA / EN 301 549 / ADA exposure is real. Even ignoring compliance, laptop-trackpad-only manipulation of an infinite canvas is a usability tax.
- **Recommended fix:** Follow the plan already written in `REMAINING-WORK.md` (UX-03/06): design a keyboard interaction model (arrow-key nudge, Tab item traversal, Enter to edit) and make the Organizer capable of the core CRUD operations as the accessible alternative. Add `axe` automation (see `testing-gaps.md`).
- **Blocker before production:** Depends on target market; for B2C launch no, for B2B/gov yes.

## UI-6 — WebSocket chat/reactions are available to read-only viewers and anonymous guests

- **Severity:** Medium (UX + abuse; see also `security-issues.md` S-4)
- **Location:** `src/lib/collaboration/websocket-server.ts:672-694` (`handleMessage` `case "message"`) — no `accessLevel` check
- **Problem:** The server broadcasts `message` payloads (cursor chat, reactions) from any connected client, including `VIEW`-role users and cookie-less guests on public canvases. The UI presents share roles as VIEW/COMMENT/EDIT, so an owner who shares "view only" will be surprised that viewers (and anonymous strangers, for public canvases) can pop chat bubbles and reactions on their screen.
- **Why it matters:** Role semantics that don't match the visible permission picker undermine trust in the sharing model, and public canvases become a spam vector (8 KB payloads × 600 msgs/min × up to 100 connections).
- **Recommended fix:** Gate `message` handling on `accessLevel !== "VIEW"` (or introduce an explicit "can chat" capability shown in the share dialog), and drop guest chat entirely.
- **Blocker before production:** No, but fix before promoting public sharing.

## UI-7 — Rate-limit responses are not surfaced to users as actionable feedback

- **Severity:** Medium
- **Location:** `src/lib/api/fetch-client.ts` consumers; e.g. `src/lib/hooks/use-canvas-items.ts:104` (`throw new Error("Failed to fetch items")`), `ImageItem` (silent)
- **Problem:** Client fetch wrappers collapse 429s into generic "Failed to fetch items" errors. The API returns a proper RFC 7807 body with `resetAt`/`Retry-After`, but no UI uses it — users editing quickly (200 item ops/min is reachable when multi-selecting and dragging groups) just see failures with no "slow down / retrying in Ns" messaging or automatic backoff.
- **Why it matters:** Under real collaborative load, self-inflicted 429s will look like data loss (autosave failures).
- **Recommended fix:** Teach `apiFetch` to recognize 429, honor `Retry-After` with one automatic retry for idempotent requests, and show a toast ("Working too fast — retrying…"). Pair with the server-side re-keying in S-1.
- **Blocker before production:** No (but L-1/S-1 which trigger it are).

## UI-8 — Upload constraints are not communicated in the UI before failure

- **Severity:** Low
- **Location:** Upload path consumers of `POST /api/v1/upload` (`src/app/api/v1/upload/route.ts:23-27` — 5 MB, 500 files, 100 MB per user; middleware limit 10 uploads/hour per IP in `src/middleware/rate-limit.ts:100-104`)
- **Problem:** Limits (5 MB/file, 100 MB quota, 500 files, 10 uploads/hour) exist server-side only; there is no client-side pre-check or quota indicator, so users learn limits via error toasts after waiting for the upload.
- **Recommended fix:** Validate size/type client-side before POSTing; show remaining quota in settings/profile; make the 10/hour figure per-user rather than per-IP (see S-1) and raise it — 10/hour is very low for a visual board tool.
- **Blocker before production:** No.

## UI-9 — Stale comment in collaboration server contradicts actual chat rate limit

- **Severity:** Low (doc/UI truthfulness)
- **Location:** `src/lib/collaboration/websocket-server.ts:39-40` — comment says "6000 messages per minute" while `RATE_LIMIT_MAX = 600`.
- **Problem:** Misleading comment; anyone tuning cursor-update frequency against the documented number will build UI that gets connections closed (`close(1008)` on exceed — the client then loses presence entirely rather than being throttled).
- **Recommended fix:** Fix the comment; consider dropping excess cursor messages instead of closing the socket, which is a harsh failure mode for a jittery trackpad user.
- **Blocker before production:** No.

## UI-10 — Public share links resurrect with the same URL after being disabled

- **Severity:** Medium (UX expectation; see `security-issues.md` S-6)
- **Location:** `src/app/api/v1/canvases/[canvasId]/public/route.ts:96-101` (DELETE keeps `shareToken`), POST reuses `canvas.shareToken || nanoid(16)`
- **Problem:** Disabling public sharing keeps the token, and re-enabling reuses it. Users reasonably expect "turn off link → old link dead forever"; here anyone holding the old URL regains access the moment the owner re-enables sharing, with no UI indication that the link is the same.
- **Recommended fix:** Rotate the token on re-enable by default, with an explicit "keep existing link" option in the share dialog.
- **Blocker before production:** No, but document the behavior in the dialog immediately.

## UI-11 — Duplicate auth route `/auth/signin` exists alongside `/auth/login`

- **Severity:** Low
- **Location:** `src/app/auth/signin/page.tsx` (server redirect to `/auth/login`)
- **Problem:** Harmless legacy redirect, but it adds a route to maintain and can confuse deep-link analytics. Fine to keep; just ensure external docs use `/auth/login`.
- **Blocker before production:** No.

## UI-12 — Error messaging depends on MUI `Alert` announcements; verify screen-reader behavior of auth forms

- **Severity:** Low
- **Location:** `src/features/auth/components/LoginForm.tsx:95-108`
- **Problem:** Error/success alerts are visually inserted above the form; MUI `Alert` does not set `role="alert"`/`aria-live` by default in all render paths, so failed login may be silent to screen readers. The form uses `noValidate` (good, RHF-driven) with `helperText` errors, which are associated correctly — the top-level alert is the gap.
- **Recommended fix:** Add `role="alert"` to the error `Alert`s in Login/Register/Forgot/Reset forms.
- **Blocker before production:** No.

---

## Recommended UI Priorities Before Production

1. **Fix the registration → verification → login funnel (UI-1).** This is the single most user-visible defect; it affects 100 % of new production users.
2. **Ship the image-error placeholder + fix the underlying rate-limit collision (UI-2 + L-1).** Silent image failures on real canvases are effectively data-loss UX.
3. **Preserve deep links through login (UI-3).** Cheap fix, big win for the sharing flow.
4. **Add route loading skeletons and a canvas-scoped error boundary (UI-4).** Contain canvas crashes; make navigation feel intentional.
5. **Align WebSocket chat with the visible role model (UI-6).**
6. **Surface 429s gracefully in the client (UI-7).**
7. **Rotate public share tokens on re-enable, or label the behavior (UI-10).**
8. **Accessibility plan for the canvas (UI-5)** — start the UX-03/06 work; at minimum add axe CI and fix auth-form announcements (UI-12) now.
