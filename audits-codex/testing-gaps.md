# Testing and Release-Evidence Gaps

## Baseline observed on 26 July 2026

| Check | Result | Qualification |
|---|---:|---|
| Lint | Passed | Static lint only |
| Type checking | Passed | TypeScript compilation only |
| Unit/component suite | 217 tests in 28 files passed | Coverage: 8.81% statements/lines, 50.12% branches, 28.78% functions |
| Production build | Passed; 66 generated routes | Build logged an unreachable local PostgreSQL dependency but completed |
| Bundle check | Passed | Invalid evidence: all 182 chunks were categorized as `OTHER` |
| Browser visual audit | Not available | In-app browser reported no installed/available browser backend |
| Production dependency audit | Not obtained | Registry access was unavailable in the restricted audit environment |

## Findings

### TEST-01 — Automated coverage misses most production-critical surfaces

- **Severity:** High
- **Location:** Vitest suite and coverage configuration
- **Description:** The passing suite covers only 8.81% of statements/lines and 28.78% of functions. Most pages, API routes, canvas UI, collaboration, uploads, authentication orchestration, agent actions, and operational code have no executed coverage.
- **Why it matters for production:** A green suite provides little confidence in the exact areas carrying data-loss, authorization, and recovery risk.
- **Recommended fix:** Prioritize risk-based coverage rather than a cosmetic global target: autosave/OCC, role permissions, production registration, upload lifecycle, public links, backup/restore, WebSocket admission/fanout, and destructive account/canvas operations. Then ratchet per-package and changed-code thresholds.
- **Blocker before production:** Yes until the P0 paths have deterministic tests.
- **Related risks or dependencies:** Existing tests remain useful; do not dilute them with snapshot-only coverage.

### TEST-02 — Database behavior is not verified against real PostgreSQL transactions

- **Severity:** High
- **Location:** API/service tests that mock Prisma/database behavior
- **Description:** Critical tests substitute database calls rather than running migrations and exercising real constraints, isolation, cascades, raw SQL, indexes, and rollback behavior.
- **Why it matters for production:** Unique races, transaction ordering, SQL search escaping, cascade/object cleanup, and restore semantics can pass mocks but fail against PostgreSQL.
- **Recommended fix:** Add disposable PostgreSQL integration suites that apply migrations from zero, seed through public/service APIs, run concurrent transactions, and assert database state after failures. Keep fast mocks for unit boundaries.
- **Blocker before production:** Yes.
- **Related risks or dependencies:** CI needs a pinned PostgreSQL/pgvector service and schema-drift check.

### TEST-03 — End-to-end tests bypass the production registration contract

- **Severity:** High
- **Location:** Playwright smoke suite and test environment authentication settings
- **Description:** The browser suite contains only a few smoke journeys and runs the development server. Registration succeeds directly because production verification behavior is not enabled, so the email-verification dead end is invisible.
- **Why it matters for production:** The first real user journey can be broken even while every E2E check passes.
- **Recommended fix:** Boot the production build with production-equivalent auth policy, use a captured test mailbox, and cover registration, delayed/resend/expired verification, login, reset, account deletion, and logout/session invalidation.
- **Blocker before production:** Yes if registration is enabled.
- **Related risks or dependencies:** Requires email delivery to be transactional/retryable (`LOG-15`).

### TEST-04 — There are no two-user concurrency or multi-instance collaboration tests

- **Severity:** High
- **Location:** Canvas and WebSocket integration/E2E suites
- **Description:** Tests do not operate two authenticated browser contexts on the same canvas, create version conflicts, disconnect/reconnect, or route clients across two application instances.
- **Why it matters for production:** Missing item synchronization, partial Redis fanout, stale presence, lost autosave deltas, and role leakage are multi-client defects that single-user tests cannot observe.
- **Recommended fix:** Add deterministic two-client scenarios for edit visibility, simultaneous edits, delete/undo, read-only/comment roles, polls, reconnect, expired sessions, and instance loss. Assert both UI and database convergence.
- **Blocker before production:** Yes for collaboration claims or multi-replica deployment.
- **Related risks or dependencies:** Establish the intended synchronization contract before encoding tests.

### TEST-05 — Visual regression and accessibility coverage is optional and stale

- **Severity:** High
- **Location:** Percy/Playwright visual specs, route fixtures, accessibility automation
- **Description:** Visual tests can be skipped based on environment, contain stale auth paths and hard-coded fixtures, and there is no systematic axe/manual keyboard/screen-reader matrix. This audit could not compensate because the approved in-app browser runtime had no browser backend.
- **Why it matters for production:** Responsive breakage, inaccessible canvas workflows, focus traps, contrast regressions, and dark-theme inconsistencies are not release-gated.
- **Recommended fix:** Make stable visual/a11y suites mandatory for release branches, create deterministic fixtures, cover 320/375/768/1024/1440 widths and both themes, run axe, and schedule manual keyboard plus NVDA/VoiceOver checks for canvas alternatives.
- **Blocker before production:** Yes for public accessibility readiness; manual verification is required even after automation.
- **Related risks or dependencies:** Fix the accessible DOM canvas view (`UI-03`) before declaring conformance.

### TEST-06 — Service-worker and offline/update behavior is untested

- **Severity:** Medium
- **Location:** Service worker, cache/version update flow, offline UI
- **Description:** There are no automated checks for first install, stale asset eviction, navigation fallback, offline writes, recovery after a new deploy, or authentication changes while cached.
- **Why it matters for production:** A stale worker can pin broken assets or UI; offline editing can appear successful despite no durable queue.
- **Recommended fix:** Either remove/disable the worker until its contract is defined, or test install/activate/update/offline/reconnect with versioned caches and explicit no-store rules for private API data.
- **Blocker before production:** No if the service worker is disabled; yes if offline/PWA behavior is marketed.
- **Related risks or dependencies:** Do not cache personalized canvas/auth responses indiscriminately.

### TEST-07 — CI builds the container but never boots the release artifact

- **Severity:** High
- **Location:** CI container-build workflow, Docker entrypoint, health checks
- **Description:** CI produces a production image but does not start it, apply migrations in a clean environment, execute readiness probes, or run browser/API smoke tests against that image. Playwright uses the development server.
- **Why it matters for production:** Missing runtime files, entrypoint/migration failures, production-only environment invariants, CSP behavior, and health configuration can first appear during deployment.
- **Recommended fix:** Boot the exact candidate image with pinned PostgreSQL/Redis/MinIO, run migrations once, wait on readiness, execute production-auth API/browser smoke tests, and retain logs/metadata.
- **Blocker before production:** Yes.
- **Related risks or dependencies:** Use the same digest promoted to staging/production.

### TEST-08 — Bundle regression testing does not classify App Router routes

- **Severity:** Medium
- **Location:** Bundle check script and CI performance job
- **Description:** The checker passed while assigning every JavaScript chunk to `OTHER`; no intended landing, authentication, or canvas budget was actually evaluated.
- **Why it matters for production:** The release gate communicates confidence it did not measure.
- **Recommended fix:** Repair route mapping as described in `PERF-07`, fail when expected classifications are empty, and add a regression fixture for manifest format changes.
- **Blocker before production:** No, but remove the misleading green badge until repaired.
- **Related risks or dependencies:** Track route-level transfer and interaction metrics separately.

### TEST-09 — Backup restoration is not exercised automatically

- **Severity:** High
- **Location:** Backup/restore scripts and operations pipeline
- **Description:** No scheduled drill restores the latest database and object data into an isolated environment and verifies counts, checksums, referential integrity, and representative assets.
- **Why it matters for production:** A backup is only evidence of files being written; current script defects would remain unknown until an incident.
- **Recommended fix:** Run recurring restore drills from encrypted production-like backups, force SQL error-stop behavior, verify object hashes and application reads, measure RPO/RTO, and alert on drift.
- **Blocker before production:** Yes; one successful documented full restore is required before launch.
- **Related risks or dependencies:** Fix `DEP-01` and include S3/MinIO data (`DEP-02`) first.

### TEST-10 — Migration drift and downgrade/rollback behavior are not release-gated

- **Severity:** High
- **Location:** Prisma schema/migrations and CI release pipeline
- **Description:** CI does not prove that committed migrations reproduce the checked-in schema, migrate a populated prior-version database, or support the documented rollback strategy.
- **Why it matters for production:** Developer-generated schema state can diverge from deployable migrations, and a forward migration may make application rollback unsafe.
- **Recommended fix:** Add `prisma migrate diff`/status checks, migrate from a representative prior release, validate data invariants, and require an expand-contract or explicit forward-fix plan for irreversible changes.
- **Blocker before production:** Yes.
- **Related risks or dependencies:** Separate migration execution from application replica startup (`DEP-06`).

### TEST-11 — No load or resource-budget test represents real canvas usage

- **Severity:** Medium
- **Location:** Performance test suite and capacity plan
- **Description:** There are no repeatable budgets for canvas sizes, connections, concurrent uploads, public-link reads, search, versions, WebSockets, thumbnail work, or AI concurrency.
- **Why it matters for production:** Capacity, timeouts, and memory limits are guesses; resource-exhaustion paths can pass functional tests.
- **Recommended fix:** Define supported launch envelopes and run k6/Artillery-style API/WS tests plus browser traces. Gate p95 latency, error rate, heap, database connections, event-loop delay, and response bytes.
- **Blocker before production:** No for a deliberately small invite-only launch with strict quotas; yes for open registration.
- **Related risks or dependencies:** Implement hard payload/account limits before load testing.

## Minimum release test gate

- [ ] Risk-path unit tests for autosave, optimistic rollback, item permissions, validation, and auth verification.
- [ ] Real PostgreSQL integration tests from migrations, including concurrent writers.
- [ ] Two-user collaboration and read-only-role E2E tests.
- [ ] Candidate production image booted and smoked with production-equivalent policy.
- [ ] One successful database + object-storage restore drill.
- [ ] Mandatory responsive, dark/light, keyboard, and accessibility verification.
- [ ] Fresh dependency advisory report with reviewed exceptions.
