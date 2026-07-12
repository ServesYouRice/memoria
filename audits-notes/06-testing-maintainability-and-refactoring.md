# Testing, maintainability, and refactoring audit

## Test baseline

### TST-01 — Passing tests cover only 7.99% of statements/lines

**Severity:** High release-confidence blocker

`pnpm exec vitest run --coverage` completed successfully:

- 26 test files passed
- 207 tests passed
- 7.99% statements
- 51.85% branches
- 28.66% functions
- 7.99% lines

There is no threshold in `vitest.config.ts:23-35`, so CI remains green at effectively single-digit coverage. The report includes root configuration, generated `dist/server.mjs`, and `public/sw.js`, which makes the denominator noisy, but the core application is still overwhelmingly uncovered.

Set initial honest thresholds and ratchet them upward. More importantly, gate critical modules at much higher levels rather than chasing aggregate utility coverage.

### TST-02 — Critical paths have zero behavioral coverage

The coverage report showed 0% for the collaboration WebSocket/Yjs provider, service worker, AI services, most hooks/UI, account lockout, agent service core/query/auth, middleware CORS/rate limits, uploads, and most API routes. This directly explains why severe authorization, caching, race, and workflow defects reached the current tree.

First test targets should be:

1. Yjs two-tenant update/delete exploit and payload validation.
2. Suggestion claim/concurrent execution and external idempotency.
3. Service-worker cache allow/deny matrix and account switching.
4. Webhook redirects, DNS/IP rebinding defenses, response caps, and path-origin enforcement.
5. Session revocation, lockout concurrency, reset single-use, and account deletion across shared canvases.
6. Clean Docker setup/build/migrate/start/health/shutdown.

### TST-03 — Configured E2E tests use stale routes and fake authentication

Playwright is configured for `tests/e2e` only (`playwright.config.ts:4`) and discovers 333 browser-project cases. Significant portions target routes that do not exist, such as `/canvases` and `/auth/signup` (`tests/e2e/auth-flow.spec.ts`, `canvas-crud.spec.ts`, `canvas-items.spec.ts`). The actual product uses `/dashboard` and `/auth/register`.

Many suites “authenticate” by setting `next-auth.session-token=test-session-token`. That is not a valid signed Auth.js JWT and does not correspond to a database session. Protected behavior tested under it is not representative.

Replace this with Playwright setup projects/fixtures that create users through a test-only seed/API, perform real login, and save valid storage state. Keep route constants/page objects tied to actual app routes.

### TST-04 — Security and observability browser tests are orphaned

The root `e2e/` directory contains auth, canvas, observability, and security specs, but `playwright.config.ts` points only at `tests/e2e`. The CSP/header/rate-limit/security tests therefore never run. One observability test is explicitly `expect(true).toBe(true)`.

Consolidate to one E2E root, delete placeholders, and verify CI discovery output so critical suites cannot silently disappear.

### TST-05 — Many E2E cases can pass without testing the claimed behavior

Patterns such as `if (await element.isVisible()) { ...assert... }` skip the assertion when the feature is absent. `expect(count >= 0).toBeTruthy()` is always true. Some tests only wait for `networkidle` after a create and assert nothing. Two canvas concurrency cases call `test.skip()` as placeholders.

Fail when required preconditions/elements are absent; move optional feature tests behind explicit feature flags; assert database/API-visible outcomes, not merely absence of exceptions.

### TST-06 — E2E state/order is unsafe

`fullyParallel: true` is configured, while auth/sharing suites reuse module-level emails, canvas IDs, and share tokens and assume earlier tests created them. CI happens to set one worker, while local runs may parallelize these dependencies. The CI database is migrated but not deterministically seeded/cleaned per test.

Make tests isolated; use unique fixtures per test or explicit serial suites only where unavoidable; clean data by run ID; make retries safe.

### TST-07 — E2E infrastructure does not match production dependencies

GitHub E2E starts Postgres only (`.github/workflows/ci.yml:111-124`) but passes `REDIS_URL=redis://localhost:6379` and S3 settings without Redis/MinIO services. Rate-limit/cache/collaboration paths either fail open/log errors or remain untested. Upload/object lifecycle is absent.

Add healthy Redis and S3-compatible services, seed the bucket/policy, and include a multi-server collaboration job.

### TST-08 — Visual tests are normally all skipped

Visual specs select `test.skip` unless `PERCY_TOKEN` exists and include stale `/auth/signup` routes. They are discovered by normal Playwright runs but do not provide visual evidence in the default CI workflow.

Either provision a protected visual job with current routes/baselines or replace it with deterministic local screenshot comparisons for core breakpoints/themes.

## Maintainability and refactoring findings

### MNT-01 — Core files combine too many responsibilities

Current high-risk hotspots (physical line counts from this audit):

| File | Lines | Responsibilities mixed together |
|---|---:|---|
| `src/lib/agents/service-core.ts` | ~1,360 | validation, authorization, transactions, suggestions, action audit, revert, webhooks |
| `src/features/canvas/components/CanvasBoard.tsx` | ~1,112 | data, rendering, input, history, AI, collaboration, dialogs, thumbnails |
| `src/lib/agents/mcp.ts` | ~761 | protocol catalog, schemas, policy, dispatch, execution |
| `src/lib/collaboration/websocket-server.ts` | ~703 | auth, upgrade, presence, Redis bus, Yjs, rate limiting, broadcast |
| `src/features/canvas/components/CanvasHeader.tsx` | ~624 | identity, navigation, presence, and nearly every feature control |
| `src/lib/hooks/use-canvas-items.ts` | ~560 | transport, auto-pagination, optimistic cache transforms, polling, mutations |

These are not merely style problems: the confirmed races, permission gaps, duplicate state, and untestable branches sit at their boundaries.

Refactor around explicit services/state machines:

- `CollaborationGateway` (upgrade auth/leases), `CollaborationProtocol` (schemas/limits), `YjsRepository` (canvas-scoped persistence), `PresenceBus`.
- `SuggestionClaimer`, `ActionExecutor`, `WebhookDeliveryJob`, `ActionAuditRepository`.
- `CanvasController` plus small controlled viewport/selection/history/collaboration hooks and isolated render layers.

### MNT-02 — A parallel unused canvas architecture is already present

The following appear to have no consumers beyond barrel exports/definitions:

- `src/features/canvas/components/Canvas.tsx`
- `use-canvas-ai-handlers.ts`
- `use-canvas-collaboration-ui.ts`
- `use-canvas-context-menu.ts`
- `use-canvas-dialogs.ts`
- `use-canvas-item-handlers.ts`
- `use-canvas-thumbnail.ts`
- most of `src/lib/canvas/*` (clipboard, connections, grid, history, position, selection, viewport, z-index)
- `src/lib/services/search.ts` and `templates.ts`
- `src/lib/auth/middleware.ts`

Meanwhile CanvasBoard reimplements many of these concerns inline. This creates false confidence (“implemented utility exists”) while the live path behaves differently.

Run an unused-export tool, verify dynamically loaded entries, then either migrate the live path to the tested utilities or delete the dead branch. Do not maintain both.

### MNT-03 — Test setup is fragmented

There are at least three setup files (`tests/setup.ts`, `src/__tests__/setup.ts`, `src/test/setup.ts`) plus `vitest.setup.ts`; Vitest loads only `tests/setup.ts`. Environment mocks and jest-dom setup therefore differ depending on where a test was copied from.

Create one documented setup per test environment, include it explicitly, and delete stale variants.

### MNT-04 — Operational code is excluded from normal static checks

`.eslintignore` excludes `scripts/*.mjs` and Prisma migrations. `tsconfig.json` excludes `tests` and `src/__tests__`, and relaxes unused checks. Multiple critical setup/doctor/build bugs live precisely in excluded scripts.

Add ESLint/type checking for scripts (or convert to checked TypeScript), SQL migration lint/schema verification, and a test tsconfig. Enable `noUnusedLocals`/`noUnusedParameters` after dead-code cleanup.

### MNT-05 — Boundary typing falls back to `any`

An `rg` audit found 126 `any` word matches; many are actual boundary types in WebSocket messages, route context/session, Prisma JSON, search responses, Canvas item events, optimistic cache shapes, and AI payloads. The most dangerous path (`handleMessage(message: any)`) is exactly where untrusted WebSocket data enters.

Use Zod-derived types at network/storage boundaries, `unknown` before parsing, typed React Query cache helpers, and discriminated event unions.

### MNT-06 — Error and route-handler patterns are inconsistent

Some routes use `withApiHandler`; others manually wrap `try/catch` and `errorResponse`; some throw `ApiError`, some return ad-hoc `{ error }`, and idempotent wrappers sometimes return error responses rather than throw. Client hooks consequently inspect `error`, `message`, or RFC-style `detail` inconsistently and often replace it with a generic toast.

Standardize one problem-details contract, one handler wrapper, typed error codes, and a client parser. Preserve correlation ID consistently (`x-request-id` vs `x-correlation-id` currently differs).

### MNT-07 — Documentation and code disagree

Examples:

- README/architecture imply working real-time items/live cursors; only presence/chat/reactions are wired.
- Accessibility guide begins with “FIXED” and lists Paste, Ctrl+N/B, +/- zoom, and reset shortcuts that are absent/broken.
- Setup claims secrets are generated but preserves placeholders.
- “Doctor” is recommended but leaks those secrets and fails the reference Postgres image's pgvector check.
- Metrics call zero placeholders a stable operational contract.

Make docs executable where possible: setup smoke tests, route/shortcut generation from source, and release checks that validate claims.

## Additional quality findings

| ID | Severity | Finding | Action |
|---|---|---|---|
| TST-09 | Medium | Unit test output includes full recovery URLs. | Use a capturing/redacting fake email provider in tests; assert tokens without printing them. |
| TST-10 | Medium | Coverage includes generated/root noise but excludes E2E value. | Scope unit coverage to owned source and report integration/E2E separately; do not use aggregate percentage as the only goal. |
| TST-11 | Medium | No database integration suite validates real constraints/transactions. | Run Postgres-backed tests for account deletion, restore, idempotency, suggestions, shares, and migrations. |
| TST-12 | Medium | No concurrency or multi-instance suite. | Exercise parallel login failures, duplicate mutation/replay, suggestion execution, REST/Yjs writes, Redis fan-out, revocation, and shutdown. |
| TST-13 | Medium | No service-worker test harness. | Unit-test request classification and browser-test install/update/offline/account-switch behavior. |
| TST-14 | Medium | No accessibility automation/manual protocol in CI. | Add axe for DOM screens plus documented manual canvas/keyboard/screen-reader checks; automation alone cannot validate canvas equivalence. |
| TST-15 | Medium | No clean-clone self-host smoke test. | CI should build Compose without local env/node_modules, migrate, bootstrap, upload/read, share, restart, SIGTERM, and restore backup. |
| TST-16 | Medium | No dependency update automation or lockfile policy gate. | Enable scheduled update PRs, audit/SBOM/license gates, and emergency framework security updates. |
| MNT-08 | Medium | `SavedView` and multiple legacy brand names remain. | Complete documented schema/data migration and remove deprecated model/code after compatibility window. |
| MNT-09 | Medium | Comments such as `FIXED: Issue #...` are used as assurance. | Replace historical claims with tests/ADRs; comments should explain invariants, not declare correctness. |
| MNT-10 | Low | Build and test warnings are normalized. | Fail/track unexpected Next/Sentry, Prisma preview, Vite CJS, and npm/pnpm warnings with owners and expiry. |
| MNT-11 | Medium | `package.json` version constraints allow broad drift while framework is hard-pinned old. | Adopt a deliberate update cadence and compatibility matrix; keep lockfile, manifest, CI, and Docker aligned. |
| MNT-12 | Medium | Existing audit material contains stale/false positives. | Keep this audit's stable IDs, add status/owner/fix PR fields, and revalidate findings rather than copying reports forward. |

## Recommended test pyramid for the next release

1. **Authorization/data integrity integration tests:** real Postgres, two users, shared/public canvases, concurrent calls.
2. **Protocol tests:** parsed WebSocket/MCP/webhook messages with byte limits, permissions, replay, and multi-instance Redis.
3. **Core browser flows:** real login storage state; dashboard create; canvas create/edit/move/conflict; role matrix; share revoke; upload; reset; account delete.
4. **Production workflow:** clean Docker build, migration, readiness, graceful shutdown, backup/restore.
5. **Nonfunctional gates:** dependency policy, bundle budgets from Next manifests, accessibility, and load tests.

The 207 passing unit tests are useful and should be preserved, especially password, schema, cache, and webhook-signature coverage. They are a starting point, not evidence that the current release is safe.
