# Testing Gaps

Severity: Critical / High / Medium / Low.

---

## Current state (verified)

- **Unit (Vitest + happy-dom):** `src/__tests__/*`, `src/lib/**/__tests__`, `src/stores/__tests__`, and a `tests/unit/*` tree — covers password, sanitization, rate-limit (memory + redis), email, search, csp, logger, canvas-item validation, agent MCP/webhooks/knowledge, versioning, canvasStore.
- **API-ish (Vitest):** `tests/api/*` (auth-helpers, canvas-items, items, templates) — heavily mocked (`grep` shows ~25 mock usages in canvas-items).
- **E2E (Playwright):** `tests/e2e/*` (auth, canvas-crud, note-crud, bookmark-crud, sharing, canvas-items) is the configured tree; **a second, orphaned `e2e/*` tree** (auth, canvas, security, observability) is NOT covered by `playwright.config.ts` (`testDir: ./tests/e2e`) and never runs.
- **Visual:** Percy config + `tests/e2e/visual/*` specs; `test:visual` script exists but isn't in CI.

## T-1. CI runs unit tests and e2e against a schema-less database

- **Severity:** High
- **Location:** `.github/workflows/ci.yml:107-165`
- **Problem:** The e2e job runs `pnpm db:migrate` (= `prisma migrate deploy`) against fresh Postgres, but **no migrations exist** (see L-1), so the DB has no tables. Either the e2e tests don't actually touch the DB (making them shallow) or they fail/were disabled. Unit tests mock Prisma, so they never exercise real queries. Net: the schema, the ACL queries, the optimistic-locking `updateMany`, and the Yjs persistence transaction are **untested end-to-end**.
- **Fix:** Land migrations (L-1); switch e2e to `migrate deploy` on real migrations or `prisma migrate reset --force` seeded state; add at least a few tests that hit a real DB.
- **Blocker:** Tied to L-1.

## T-2. No tests for the highest-risk subsystems

- **Severity:** High
- **Gaps:**
  - **WebSocket/Yjs collaboration** (`websocket-server.ts`, `yjs-provider.ts`) — no tests for auth on upgrade, ACL enforcement on updates, persistence correctness, or the REST-vs-Yjs conflict (L-4). This is the most complex, most dangerous code and has zero coverage.
  - **Middleware** (`src/middleware.ts`) — rate-limit scoping (the L-2 bug), CORS, CSP, version validation are untested; a single test would have caught the `/api/auth/session` lockout.
  - **Auth end-to-end** — lockout thresholds, session invalidation, JWT callback behavior.
  - **Optimistic concurrency** — the 409/version-mismatch path in `canvas-items/[itemId]` PATCH/DELETE.
  - **Upload** — magic-byte detection, quota, path traversal, malware-scan branches.
  - **Agent/integration token auth**, MCP route authorization by capability rung.
- **Fix:** Prioritize integration tests for collaboration and middleware; these are where correctness bugs hide.

## T-3. Mocked API tests give false confidence

- **Severity:** Medium
- **Location:** `tests/api/canvas-items.test.ts` (~25 mocks)
- **Problem:** With Prisma mocked, tests assert the handler calls the mock as expected — they can't catch schema drift, missing indexes, wrong `where` clauses (e.g., the cron's missing `deletedAt: null`, L-6), or the NaN-pagination 500 (L-15). They pass even if the query is semantically wrong.
- **Fix:** Add a real-DB integration layer (Testcontainers or the CI Postgres service) for a subset of critical routes.

## T-4. No coverage threshold enforced

- **Severity:** Low-Medium
- **Location:** `vitest.config.ts:22-33` (coverage reporters set, **no `thresholds`**), `package.json` `ci` script runs `test:coverage`
- **Problem:** Coverage is measured but not gated; it can silently trend to zero on new code.
- **Fix:** Set `coverage.thresholds` (even modest: lines 50%) and fail CI below it.

## T-5. Playwright webServer runs `npm run dev`, not a production build

- **Severity:** Medium
- **Location:** `playwright.config.ts:` `webServer.command: 'npm run dev'` (and it's `npm`, not `pnpm`, in a pnpm repo)
- **Problem:** E2E runs against `next dev` (different CSP `unsafe-eval`, different error overlays, no prod optimizations, dev-only code paths like local uploads and the setup dev-bypass). Production regressions in the built app won't be caught. Mixing `npm` and `pnpm` can also produce a divergent lockfile/install.
- **Fix:** Run e2e against `pnpm build && pnpm start`; use `pnpm` consistently.

## T-6. Orphaned test tree and visual tests not wired to CI

- **Severity:** Low
- **Location:** root `e2e/*`, `tests/e2e/visual/*`, `percy.yml`
- **Problem:** The root `e2e/` specs (including `security.spec.ts`, `observability.spec.ts`) never execute. Visual regression (`test:visual`) isn't in the CI pipeline, so design regressions aren't caught despite Percy being configured.
- **Fix:** Delete or fold the root `e2e/` tree into `tests/e2e`; add Percy to CI (or remove it to reduce confusion).

## T-7. No load/soak testing for the stateful server

- **Severity:** Medium (given the architecture)
- **Problem:** This is a stateful WS server with in-memory doc caches, in-memory rate limiting, and per-canvas timers. There's no load test to reveal the memory leaks (L-3, L-12), connection-exhaustion (P-9), or the 30 s-flush data loss on restart (L-13).
- **Fix:** Add a basic k6/artillery scenario: many canvases, many WS clients, restart mid-session, assert no data loss and bounded memory.

---

## Recommended testing priorities

1. Land migrations, then make CI exercise a **real** database (unblocks meaningful e2e).
2. Middleware unit tests (would have caught L-2 immediately).
3. Integration tests for WebSocket auth/ACL and Yjs persistence (L-4, L-11).
4. Optimistic-concurrency and upload-security route tests against a real DB.
5. Switch Playwright to the production build; consolidate the two e2e trees.
6. Add a coverage threshold and a minimal load test.
