# 07 — Test Harness Performance, Timeouts & Coverage Gaps

## Domain Overview & Architecture

Memoria uses **Vitest** (v4.1.10) with `happy-dom` for unit and API route tests, and **Playwright** for E2E tests.
Test execution performance and deterministic isolation are fundamental to maintaining a reliable CI/CD release gate.

```
Vitest Runner (vitest.config.ts)
   ├── Setup: tests/setup.ts (happy-dom environment)
   ├── Dependency Optimizer: @mui/icons-material pre-bundling
   ├── Coverage: V8 provider (Thresholds: 8% lines, 50% branches)
   └── Known Issues:
       ├── Dynamic Route Import Latency (10-20s on App Router imports)
       ├── 5-Second Global Timeout Abrupt Failures
       └── Uncancelled Async Work Contaminating Subsequent Tests
```

---

## Detailed Testing Gaps & Audit Findings

### GAP-HARNESS-01: Vitest 5-Second Timeouts & App Router Import Latency (`TEST-01`)
- **Severity**: **High**
- **Affected Files**: `vitest.config.ts`, `tests/api/auth-verification.test.ts`, `tests/api/templates.test.ts`
- **Defect Description**: The test runner configures a default 5-second timeout. When tests dynamically import Next.js App Router route modules (e.g. `await import("@/app/api/v1/auth/send-verification/route")`), Vitest traverses a deep module graph (Prisma, Auth.js, Sentry, Pino, Zod), taking 8-15 seconds on initial load and tripping the 5-second timeout.
- **Current Test Gap**: Tests fail not because of logic errors, but because initial bundle compilation exceeds the assertion timeout.
- **Invariant Requirement**:
  1. Optimize Vite resolve/alias bundling for server routes or configure warmed module pre-loading in `tests/setup.ts`.
  2. Separate module import time from assertion timeouts, or adjust hook timeouts (`hookTimeout: 30000`, `testTimeout: 10000`) for API route integration tests.

### GAP-HARNESS-02: Async Work Contamination & Shared Mock Leakage
- **Severity**: **High**
- **Affected Files**: `tests/api/auth-verification.test.ts`, `tests/setup.ts`
- **Defect Description**: When a test times out mid-execution, its unresolved async promises continue executing in the background. In `auth-verification.test.ts`, an uncancelled request completed during Test #2, doubling `tokenCreate` call counts and causing Test #2 to fail with `expected 1 call, received 2`.
- **Current Test Gap**: `beforeEach` calls `vi.clearAllMocks()`, but does not cancel active microtask queues or reset isolated module registries.
- **Invariant Requirement**: Tests must use `vi.resetModules()`, deterministic mock teardown, and explicit AbortController signals to guarantee zero cross-test interference.

### GAP-HARNESS-03: Low Global Coverage Thresholds (8% Floor) (`TEST-04`)
- **Severity**: **Medium**
- **Affected Files**: `vitest.config.ts:53-58`
- **Defect Description**: The global coverage threshold in `vitest.config.ts` is configured to `lines: 8, statements: 8, functions: 28, branches: 50`. These low floors were set to prevent failing on untested UI components, but they allow critical backend services (auth, collaboration, outbox, security) to regress without coverage alerts.
- **Current Test Gap**: No per-package or per-directory coverage thresholds exist.
- **Invariant Requirement**: Establish granular per-directory coverage thresholds:
  - `src/lib/auth/**`: >= 85% lines / 80% branches
  - `src/lib/collaboration/**`: >= 80% lines / 75% branches
  - `src/lib/security/**`: >= 90% lines / 85% branches
  - `src/lib/outbox/**`: >= 85% lines / 80% branches

### GAP-HARNESS-04: Unverified Release Gate & Docker Integration Evidence (`TEST-02`, `DEC-014`)
- **Severity**: **High**
- **Affected Files**: `scripts/smoke.mjs`, `scripts/run-e2e.mjs`, `implementation/tasks/IMP-038.md`
- **Defect Description**: The final candidate release gate requires running integration, migration, smoke, and E2E against a real containerized stack (PostgreSQL + Redis + MinIO + Node custom server). Currently, release promotion relies on partial local runs without retained container artifact evidence.
- **Current Test Gap**: No automated script checks the full production container image digest from build to migration to smoke probe.
- **Invariant Requirement**: Release pipeline must run `pnpm doctor && pnpm stack:up && pnpm db:migrate && pnpm smoke && pnpm test:e2e && pnpm stack:down` in a clean hermetic environment.

---

## Actionable Test Implementation Matrix

| Test ID | Scope | Target File | Test Strategy | Target Model |
| --- | --- | --- | --- | --- |
| `TEST-HARNESS-01` | Config / Perf | `vitest.config.ts`, `tests/setup.ts` | Pre-bundle heavy route dependencies; configure deterministic setup hooks | Opus (Advisor) + Sonnet (Exec) |
| `TEST-HARNESS-02` | Unit / Fix | `tests/api/auth-verification.test.ts` | Refactor to isolate imports and prevent unhandled promise mock leakage | Sonnet |
| `TEST-HARNESS-03` | Config | `vitest.config.ts` | Implement per-directory coverage watermarks and ratchet thresholds | Sonnet |
| `TEST-HARNESS-04` | Harness / Release | `scripts/verify-release-gate.mjs` | Automated script executing complete Docker image build, migrate, and smoke | Sonnet |

---

## Advisor-Executor Prompt Specification

```xml
<test_specification domain="harness_and_performance">
  <context>
    Vitest runner in vitest.config.ts suffers from module import latency and mock state contamination across tests.
  </context>
  <task>
    Diagnose module resolution bottlenecks in Vitest, optimize route imports, and enforce per-directory coverage thresholds.
  </task>
  <invariants>
    1. Running pnpm test tests/api/auth-verification.test.ts must pass deterministically under 3 seconds with zero timeouts.
    2. Shared mock states must be completely isolated between test cases.
    3. Coverage thresholds for auth, security, and outbox directories must be enforced at >= 80%.
  </invariants>
  <verification>
    pnpm test -- --run tests/api/auth-verification.test.ts
  </verification>
</test_specification>
```
