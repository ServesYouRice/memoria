# Logical and Integration Issues

## LOG-01 — Byte-bounded item responses can silently lose pagination progress

- **Severity:** High
- **Location:** `src/lib/api/bounded-response.ts:8-25`; `src/app/api/v1/canvas-items/route.ts:306-328`; `src/app/api/v1/share/[token]/route.ts:61-91`; `src/lib/hooks/use-canvas-items.ts:109-140`; `tests/integration/backend-contracts.test.ts:270-307`
- **Description:** API routes calculate `hasMore` from the full database page, then `boundedItemsResponse()` removes trailing items when JSON exceeds 512 KiB. It leaves the original `offset`, `limit`, and `hasMore` unchanged and only adds `truncatedByBytes`. Clients ignore that flag. When the queried database page reaches the logical end, `hasMore` can be false even though the byte-bounded response omitted items. Existing integration coverage explicitly creates this condition but asserts only byte size, not continuation correctness.
- **Production impact:** Durable items remain in PostgreSQL but disappear from the authenticated canvas and public share views without an error. Users may believe content was lost and can export, share, or edit an incomplete canvas.
- **Recommended fix:** Use a continuation cursor based on the last item actually serialized, or fetch/serialize incrementally until the byte budget and return an authoritative next cursor. Treat truncation as continuation, never completion. Make clients reject inconsistent pagination metadata and add a test that retrieves every large item exactly once across pages.
- **Production blocker:** Yes.
- **Related risks/dependencies:** `LOG-02`, `SEC-03`, `PERF-02`, `TEST-03`.

## LOG-02 — The public-share client and API disagree on shape and pagination

- **Severity:** High
- **Location:** `src/app/api/v1/share/[token]/route.ts:71-91`; `src/app/share/[token]/page.tsx:55-79,227,284-340`
- **Description:** The API returns canvas metadata under `data.canvas` and defaults to a 50-item page. The client stores the entire response as `canvas`, reads `data.zoomLevel`/`panX`/`panY` from the top level, and never requests subsequent pages or reacts to `hasMore`/`truncatedByBytes`. It therefore uses a generic title and default viewport and renders at most the first page, even without byte truncation.
- **Production impact:** A core sharing journey presents the wrong canvas identity/view and silently omits every item after the first 50. Recipients cannot tell that the view is incomplete.
- **Recommended fix:** Define one shared runtime-validated response contract, consume `data.canvas`, and implement cursor pagination or viewport loading. Surface a recoverable error if completeness cannot be guaranteed. Add a production browser test for a canvas with more than 50 items and a non-default viewport.
- **Production blocker:** Yes.
- **Related risks/dependencies:** `LOG-01`, `TEST-03`.

## LOG-03 — Notification persistence, preferences, and the notification UI are disconnected

- **Severity:** High
- **Location:** `src/app/api/v1/notifications/route.ts`; `src/app/api/v1/notifications/preferences/route.ts`; `src/app/notifications/NotificationsContent.tsx:20-56`; `src/components/layout/AppShell.tsx:170-180`; `src/app/api/v1/canvases/[canvasId]/share/route.ts:68-89`; `src/lib/email/outbox-handler.ts:54-89`
- **Description:** The `/notifications` page calls `useActivities()` and shows the current user’s own activity rows. No client calls the real notification list/read APIs, exposes preference controls, marks rows read, or displays the unread count on the bell. Share-invitation email delivery also ignores the recipient’s `CANVAS_SHARED.emailEnabled` preference, while the in-app notification does not carry an actionable invitation token/route.
- **Production impact:** Users miss stored share and decision notifications; unread state grows forever; the bell has no state; documented preferences cannot be used and are not consistently honored. The activity page copy also promises edits/comments “on your canvases,” but the API filters by actor `userId`, not canvas ownership, so collaborator actions are absent.
- **Recommended fix:** Build a typed notification hook and inbox around `/api/v1/notifications`, add unread badge and mark-read behavior, expose per-type preferences in Settings, and enforce each preference at dispatch time. Store a safe action target for invitations or provide an authenticated invitation listing endpoint. Rename the current surface to Activity if retained.
- **Production blocker:** Yes for a product that advertises in-app notifications and share invitations; otherwise remove the dead notification contract from the launch surface.
- **Related risks/dependencies:** `UI-03`, `DEP-04`, `TEST-03`.

## LOG-04 — Viewport state can leak from one canvas into another

- **Severity:** Medium
- **Location:** `src/features/canvas/hooks/use-canvas-data.ts:54,91-159`; `src/app/canvas/[canvasId]/page.tsx:34-37`
- **Description:** `viewportInitializedRef` is set once and never reset when `canvasId` changes. The dynamic page does not key `CanvasBoard`, so client navigation between canvas IDs may reuse the component. The new canvas then skips its own stored/default viewport, immediately writes the old position to the new local-storage key, and can persist that position to the new canvas after 750 ms. `localStorage.getItem` and `setItem` are also outside a protective try/catch.
- **Production impact:** Opening a canvas through client navigation can overwrite its owner-visible default viewport with the previous canvas’s position. Storage-disabled environments can turn a nonessential preference into a rendering failure.
- **Recommended fix:** Reset viewport initialization and state atomically on `canvasId`, or key the board by ID. Do not enable persistence until the matching canvas has hydrated; catch storage errors; save local state on an idle/throttled boundary and server state on pan/zoom completion.
- **Production blocker:** No, but fix before broad use because it mutates durable presentation state.
- **Related risks/dependencies:** `PERF-03`, `TEST-03`.

## LOG-05 — The advertised unfurling feature flag has no effect

- **Severity:** Medium
- **Location:** `.env.example:34`; `src/lib/env.ts:58`; `src/app/api/v1/unfurl/route.ts`; `src/app/api/cron/refresh-bookmarks/route.ts`
- **Description:** `FEATURE_BOOKMARK_UNFURLING` is parsed and documented, but it is not consulted by the unfurl API, refresh job, or UI. Operators cannot use the advertised switch to disable the externally connected SSRF-sensitive feature.
- **Production impact:** An operator may believe external requests are disabled while the app continues to fetch user-controlled URLs and refresh bookmarks.
- **Recommended fix:** Define a single feature-capability module used by the UI, durable route, and scheduler; fail closed when disabled; cover both interactive and background paths in a configuration test.
- **Production blocker:** Yes until `SEC-02` is fixed, unless the routes/jobs are disabled by another enforceable control.
- **Related risks/dependencies:** `SEC-02`, `DEP-01`.

## LOG-06 — The service worker deletes every non-current Cache Storage entry on the origin

- **Severity:** Low
- **Location:** `public/sw.js:12-35`
- **Description:** The activation filter selects every cache whose name differs from `memoria-public-v2`, rather than only obsolete Memoria cache names. On a shared origin it deletes cache namespaces owned by another application or tool.
- **Production impact:** A co-hosted application can unexpectedly lose offline/static caches when Memoria’s service worker activates.
- **Recommended fix:** Delete only names with a Memoria-owned prefix plus an explicit legacy allowlist. Add install/upgrade tests with unrelated cache names.
- **Production blocker:** No; a dedicated origin also mitigates it.
- **Related risks/dependencies:** `TEST-05`.

## Production Blockers

1. `LOG-01`: item-response truncation can falsely report completion and hide durable content.
2. `LOG-02`: public shares have a broken metadata contract and stop at the first page.
3. `LOG-03`: the shipped notification route is not a notification inbox and preferences are not honored end to end.
4. `LOG-05`: the external-fetch kill switch is ineffective while DNS rebinding remains possible.

`LOG-04` and `LOG-06` are important correctness fixes but are not independent launch blockers.
