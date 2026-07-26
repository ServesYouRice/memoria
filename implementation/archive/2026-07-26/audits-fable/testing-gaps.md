# Testing Gaps — Memoria

**Current state (verified):** 28 Vitest files (unit + mocked API tests under `tests/unit`, `tests/api`, `src/__tests__`, ~217 tests per the last recorded run), one real-auth Playwright smoke spec (`tests/e2e/smoke.spec.ts`, 4 scenarios), Percy visual config present. CI runs lint, type-check, coverage, prod dependency audit, dependency review, clean Docker build + SBOM, and the e2e job against real Postgres/Redis/MinIO services. That is a solid skeleton; the gaps below are where production defects would currently slip through — several findings in this audit are direct evidence (they are exactly the kind of bug the missing test layers would have caught).

---

## T-1 — No database-backed integration tests for destructive/stateful flows (tracked: TST-02/11)

- **Severity:** High
- **Missing coverage:** account deletion cascade, trash restore, version restore, template use, upload lifecycle (quota, delete ordering — see L-9), agent execution, webhook outbox (SEC-12), idempotency-key replay against a real DB, Prisma constraint behavior.
- **Why it matters:** These paths delete or rewrite user data inside transactions; mocked tests cannot catch FK-cascade mistakes, partial-restore behavior, or isolation bugs. The CI e2e job *already provisions* a real Postgres — adding a Vitest project that runs migrations against it is mostly wiring.
- **Recommendation:** Add a `tests/integration` Vitest project gated on `DATABASE_URL`, run in the existing e2e job before Playwright. Start with: account deletion leaves zero orphan rows; version restore is all-or-nothing; upload delete failure leaves consistent state.

## T-2 — E2E suite does not exercise the production-only auth behavior

- **Severity:** High
- **Evidence:** UI-1/L-11 (the broken register→verify→login funnel) is invisible to the current smoke test because the verification gate only exists under `NODE_ENV=production` (`src/lib/auth.ts:70`) and the e2e run signs in immediately after registering — which would *fail* in production mode.
- **Recommendation:** Run the Playwright suite against the production build (`pnpm build && pnpm start`) with a console/email-capture provider, and add scenarios: unverified login shows the correct message; verification link works; resend works; lockout after 5 failures shows the lockout message; password reset end-to-end. This single change makes CI test what users actually get.

## T-3 — No tests for the middleware/proxy routing table

- **Severity:** High
- **Evidence:** L-1 (the `/api/v1/upload` prefix capturing `/api/v1/uploads/*`) is a one-line routing bug in `src/proxy.ts` with catastrophic effect and zero coverage. The rate limiters themselves are tested (`tests/unit/rate-limit*.test.ts`) but the *mapping of paths to limiters* is not.
- **Recommendation:** Unit-test `proxy()` with a matrix of paths (`/api/v1/upload`, `/api/v1/uploads/abc`, `/api/agent/v1/...`, `/api/csp-report`, versioned/unversioned) asserting which limiter bucket each hits (inject a recording limiter) and which headers appear. Cheap, high-value regression net.

## T-4 — Collaboration server has no automated tests at all

- **Severity:** High
- **Evidence:** `src/lib/collaboration/websocket-server.ts` (830 lines: upgrade auth, cookie parsing, JWT decode with per-cookie salt, guest path, revalidation lease, rate limiting, Redis fanout) has no test file. Findings S-4 (missing role gate) and the comment/constant mismatch (UI-9) live here unobserved. Multi-instance behavior is tracked (TST-12) but even single-instance logic is untested.
- **Recommendation:** Spin the server on an ephemeral port in Vitest with a real `ws` client: assert 401 without cookie on private canvas, guest VIEW on public canvas, 403 after share revocation (heartbeat force-revalidation), rate-limit close at 601 messages, and — once S-4 is fixed — that VIEW users cannot broadcast `message`.

## T-5 — No accessibility automation (tracked: TST-14)

- **Severity:** Medium
- **Recommendation:** Add `@axe-core/playwright` checks to the existing smoke pages (login, register, dashboard, canvas chrome, share page). This will not validate the canvas itself (UX-03/06 needs the manual protocol) but locks in the accessible chrome and catches regressions like unlabeled icon buttons and missing `role="alert"` (UI-12).

## T-6 — No load/performance regression harness (tracked: PERF-26)

- **Severity:** Medium
- **Recommendation:** Even a scheduled (not per-PR) k6/autocannon script against the Compose stack measuring: canvas open with 500/2,000/10,000 items, image proxy throughput, 20-client WebSocket cursor storm, and dashboard payload size. Record numbers as artifacts; alert on >20 % regression. Without this, PERF-01…13 work has no acceptance measure.

## T-7 — Container is built but never booted in CI (tracked: TST-15)

- **Severity:** Medium
- **Evidence:** `ci.yml` `container-build` job builds the image and produces an SBOM but never runs it; the e2e job runs from source (`pnpm build`/dev server), not the image. Runtime-only failures (entrypoint migration step, `scripts/start-server.mjs` pathing, pruned prod deps missing a runtime module) ship undetected.
- **Recommendation:** Extend `container-build`: `docker compose up` the built image against the service containers, wait for `/api/health`, run `scripts/smoke.mjs`, tear down.

## T-8 — SSRF suite lacks the hostile-input matrix

- **Severity:** Medium
- **Evidence:** `tests/unit/request-boundary-security.test.ts` exists, but S-11's cases (decimal/octal IPv4 literals, `::ffff:10.x` mapped forms, rebinding across redirects) need explicit fixtures.
- **Recommendation:** Table-driven tests over `safeFetch`'s validators; a mock DNS layer for the rebinding case.

## T-9 — Schema-drift gate (tracked: OPS-21) and migration reversibility

- **Severity:** Medium
- **Recommendation:** CI step: `prisma migrate diff --from-migrations --to-schema-datamodel` must be empty. Also boot a DB from migrations alone (not `db push`) in the integration job (T-1 gives this for free).

## T-10 — No tests for client data-layer edge cases

- **Severity:** Low–Medium
- **Evidence:** `use-canvas-items.ts` pagination loop (L-6), 429 handling (UI-7), version-conflict refetch behavior (P-8) are untested; `src/__tests__` covers libs, not hooks.
- **Recommendation:** Testing-library + msw tests for: multi-page load, pagination-stall error, 429 with `Retry-After`, version-conflict path. These document intended behavior before the PERF-01 refactor churns this file.

---

## Suggested order

1. **T-3** proxy routing matrix (hours, prevents recurrence of the worst bug found).
2. **T-2** production-mode e2e for the auth funnel (catches UI-1 class).
3. **T-1** DB-backed integration for destructive flows.
4. **T-4** collaboration server suite.
5. **T-7** boot the container in CI.
6. **T-8/T-9** SSRF matrix + schema-drift gate.
7. **T-5/T-6/T-10** axe, load harness, hook tests.
