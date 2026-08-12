# Testing Gaps and Verification Record

## Current verification results

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm lint` | Pass | Completed locally on 2026-08-08. |
| `pnpm type-check` | Pass | Completed locally on 2026-08-08. |
| `pnpm test -- --run` | Fail | 59 files / 414 tests executed; 6 files and 7 tests failed, primarily at the global 5-second timeout. |
| Focused `tests/api/auth-verification.test.ts` | Fail | 2 of 4 tests failed independently: the first dynamic route import timed out, then unfinished work contaminated the next test and doubled a token-create call. |
| Focused SSRF/health/canvas-accessibility tests | Pass | 3 files / 32 tests passed. |
| `pnpm audit --prod --audit-level=high` | Fail | 10 production-tree advisories: 5 high, 5 moderate. |
| `pnpm run check-bundle` | Pass | All four configured size budgets passed. |
| Production integration/E2E/build/smoke | Not run | The repository’s `IMP-038` release card is waiting on `DEC-014` for unrestricted Docker/esbuild verification. |
| Live browser/manual UI | Unavailable | The supported in-app browser reported no browser backend; no fresh screenshots or AT pass were possible. |

## TEST-01 — The default unit/API suite is not a reliable green gate

- **Severity:** High
- **Location:** `vitest.config.ts`; `tests/api/auth-verification.test.ts`; shared test setup/import graph
- **Description:** The full run failed 7 tests, dominated by 5-second timeouts. The auth-verification file also fails on its own because the first route import exceeds the timeout; its unresolved async work continues into the next test and changes mock call counts. This is test contamination, not evidence that production creates two tokens, but it makes the gate nondeterministic and masks real regressions.
- **Production impact:** A release cannot distinguish implementation failures from harness timing failures, and retries can create false confidence.
- **Recommended fix:** Isolate module imports/setup from timed assertions, ensure timed-out work is cancelled/settled, reset modules and mocks deterministically, and profile why route imports take roughly 10–20 seconds in this environment. Keep behavioral timeouts meaningful rather than globally raising them without diagnosis.
- **Production blocker:** Yes: the required test gate must be green once, then reproducibly green.
- **Related risks/dependencies:** None of the product findings should be dismissed as “tests are flaky”; add focused contract tests separately.

## TEST-02 — The final production-shaped release gate has no completed evidence

- **Severity:** High
- **Location:** `implementation/KANBAN.md`; `implementation/tasks/IMP-038.md`; `.github/workflows/ci.yml`; `tests/e2e/`
- **Description:** The only remaining implementation card is waiting for production browser journeys, real PostgreSQL integration, build, and operations smoke. The configured CI jobs are useful, but this audit has no current green run proving the exact candidate image against PostgreSQL, Redis, S3, email capture, migrations, the custom Node/WebSocket server, and protected operational endpoints.
- **Production impact:** Production-only auth, proxy, storage, transaction, cascade, migration, WebSocket, and worker failures can escape unit coverage.
- **Recommended fix:** Complete `DEC-014`/`IMP-038`, retain artifacts from the exact image digest, and require integration, E2E, build, image boot, migration, and smoke checks before release promotion.
- **Production blocker:** Yes.
- **Related risks/dependencies:** All deployment findings; `SEC-04` will currently fail the dependency job.

## TEST-03 — Client/server contracts are not tested at route composition boundaries

- **Severity:** High
- **Location:** `src/app/api/health/__tests__/route.test.ts`; `tests/integration/backend-contracts.test.ts:270-307`; `tests/unit/canvas-accessibility.test.tsx`; public-share/status/notification pages
- **Description:** Health tests intentionally assert that `/api/health` has no `checks`, but no test renders `StatusSummary` with that response. Public-share integration checks byte bounds but not that the browser follows continuation or reads nested canvas metadata. Accessibility tests render the panel in isolation and miss duplicate route composition. Notification API tests do not prove that the visible page consumes notifications.
- **Production impact:** Individually “passing” layers combine into broken production journeys (`UI-02`, `UI-04`, `LOG-01`–`LOG-03`).
- **Recommended fix:** Add typed contract fixtures and production browser tests that cross the actual route/component boundary. Assert complete item IDs across pages, real canvas title/viewport, unique accessible landmarks, notification unread/read behavior, and safe status failure rendering.
- **Production blocker:** Yes for the identified broken contracts.
- **Related risks/dependencies:** Prefer a shared runtime schema over duplicated TypeScript interfaces.

## TEST-04 — Coverage thresholds permit most application lines to remain untested

- **Severity:** Medium
- **Location:** `vitest.config.ts:53-58`
- **Description:** Global minimums are 8% lines, 8% statements, 28% functions, and 50% branches. Large route, UI, worker, and integration surfaces can change without meaningful coverage pressure.
- **Production impact:** The gate measures a small slice of behavior and does not protect core journeys proportionally to their risk.
- **Recommended fix:** Establish per-domain thresholds first for authentication, item persistence, sharing, notifications, outbox, setup, and operations; ratchet them upward as deterministic tests are added. Favor scenario coverage and mutation testing for authorization/validation over a single vanity percentage.
- **Production blocker:** No by itself.
- **Related risks/dependencies:** `TEST-01`, `TEST-03`.

## TEST-05 — Visual, mobile, service-worker, and assistive-technology coverage is outside the release gate

- **Severity:** Medium
- **Location:** `playwright.config.ts:4-8`; `package.json:32`; `.github/workflows/ci.yml`; `tests/e2e/visual/`; `public/sw.js`
- **Description:** Playwright’s default suite excludes `tests/e2e/visual/**`; CI does not invoke `test:visual`; configured projects are desktop engines only. There is no automated mobile/coarse-pointer matrix, axe gate, service-worker upgrade test, or retained manual keyboard/screen-reader acceptance record.
- **Production impact:** Responsive overflow, theme mismatch, duplicate accessibility regions, focus regressions, and cache-upgrade defects can ship unseen.
- **Recommended fix:** Add deterministic 320/375/768/1024/1440 viewports, both explicit themes with opposite OS preference, axe checks, service-worker install/upgrade cases, and a release checklist for keyboard plus NVDA/VoiceOver. Keep pixel tests limited to stable high-value pages.
- **Production blocker:** The manual/accessibility pass is required for launch; full visual regression automation can follow.
- **Related risks/dependencies:** `UI-04`–`UI-06`, `LOG-06`.

## TEST-06 — High-risk failure modes lack adversarial and clean-install tests

- **Severity:** High
- **Location:** setup/doctor scripts, SSRF tests, outbox tests, upload tests, Docker Compose configuration
- **Description:** Coverage does not simulate a clean self-host setup with template secrets, DNS answers changing between validation and connect, an email provider that never resolves, lease expiry mid-batch, oversized chunked JSON/multipart bodies, image decompression bombs, or a proxy chain using the reference Compose file.
- **Production impact:** Security and reliability assumptions remain unproved precisely at external/system boundaries.
- **Recommended fix:** Add hermetic tests for secret generation/rejection, connection-pinned DNS, abortable provider calls, lease renewal/loss, byte-limited streaming, hostile image metadata, and `docker compose config` assertions for every supported operator setting.
- **Production blocker:** Yes for the matching Critical/High findings.
- **Related risks/dependencies:** `SEC-01`–`SEC-03`, `PERF-06`, `DEP-01`.
