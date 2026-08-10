# Production Readiness — Testing, Deployment & Operations

Scope: test coverage, CI/CD, deployment topology, observability, runbooks,
and a go/no-go assessment. Inspection only — **no commands were executed**.
`pnpm test`, `pnpm build`, `pnpm smoke`, and `pnpm test:e2e` were not run as
part of this audit, so nothing below rests on a test result.

Legend: **B** = blocker before production.

---

## Part 1 — Testing Gaps

### PROD-01 — Line coverage is ~8%, and the threshold is set to match

| | |
| --- | --- |
| **Severity** | **High** |
| **Location** | [vitest.config.ts:47-58](vitest.config.ts#L47-L58) |
| **Blocker** | **B** (as a launch-risk decision, not a code fix) |

The repository's own comment is candid:

```ts
// TST-01: enforced non-regression floor. These numbers sit just below the
// current measured coverage (lines/statements ~8.4%, functions ~29%,
// branches ~51%); the global rate is diluted by the large, still-untested
// UI component tree.
thresholds: { lines: 8, statements: 8, functions: 28, branches: 50 },
```

414 tests across 59 files is not a small suite, and what *is* covered is chosen
well — `tests/unit/` targets exactly the right things: `ssrf-hostile`,
`rate-limit-redis`, `account-lockout-redis-failure`, `operations-security`,
`request-boundary-security`, `agent-crypto`, `outbox`, `committed-events`.
Security and infrastructure primitives are genuinely tested.

The gap is **behavioural** coverage of the paths users touch. Note that
essentially every blocker in this audit sits in untested code:

| Finding | Code area | Test coverage |
| --- | --- | --- |
| LOG-01 | `bounded-response.ts` | none found |
| LOG-02 | cursor throttling | none |
| LOG-05/06 | mutation lifecycle in `use-canvas-items.ts` | none |
| UI-01 | dashboard thumbnail wiring | none |
| UI-03/04 | share page data mapping | none |
| UI-05 | canvas search filter | none |
| PERF-01 | `boundedItemsResponse` | none |

That correlation is the actual finding: **the untested regions are where the
defects are.** Coverage percentage is a proxy; the specific gap is that no test
asserts an API response contract against what the UI actually reads.

**Fix — the highest-value tests to write first:**

1. `boundedItemsResponse`: a page truncated by bytes must still report
   `hasMore: true` (would have caught LOG-01 **and** PERF-01's shape).
2. Contract tests pinning each list/detail response shape, with the client
   consuming it — would have caught UI-01 and UI-03.
3. `useUpdateCanvasItem` under two concurrent mutations where the first fails
   (LOG-06).
4. Canvas search filter across **all** `ItemType` values (UI-05).
5. `authorize()` ordering: locked account + correct password must be rejected;
   unverified account must not be distinguishable pre-password (LOG-03, SEC-01).

Raise the thresholds as these land. Do not raise them ahead of real tests — the
current honest floor is better than a padded number.

---

### PROD-02 — The pre-push hook is flaky and runs the entire suite

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | `.husky/pre-push` |
| **Blocker** | No |

Observed directly during this audit: an initial `git push` failed the hook with
**7 failed tests across 6 files**. The identical suite then passed twice
(414/414). The failing run's own timing shows why — `import 89.80s`,
`environment 53.96s` against a 17.65s wall clock, versus `import 26.10s` on the
passing run. These were timeouts under CPU contention, not assertion failures.

**Why it matters.** A hook that fails randomly trains developers to reach for
`--no-verify`, which then bypasses the lint and test gate entirely — turning a
safety net into a liability.

**Fix.** Raise `testTimeout` for the hook run, or reduce hook scope to
lint + type-check + changed-file tests and leave the full suite to CI (which
already runs it on every push and PR).

---

### PROD-03 — E2E and integration verification has never been run unrestricted

| | |
| --- | --- |
| **Severity** | **High** |
| **Location** | [implementation/KANBAN.md](implementation/KANBAN.md) — `IMP-038` / `DEC-014` |
| **Blocker** | **B** |

The project's own board records this as the single open decision:

> `DEC-014` — Final production-gate execution. Recommended: *Grant or run
> unrestricted Docker/esbuild verification: `pnpm test:e2e`, real-PostgreSQL
> `pnpm test:integration`, `pnpm build`, and `pnpm smoke`.*

`IMP-038` ("Production browser journeys and operations smoke") sits in `WAITING`
behind it. So the full production path — container build, migrations against a
real database, live HTTP + WebSocket smoke — has not been executed end to end
in this environment.

CI *does* define these jobs (integration against `postgres:16`, container build,
e2e), which is a meaningful mitigation. But the gate the project itself defined
as the launch condition is still open.

**Fix.** Run it. This is the one item that cannot be substituted with more code
review, and until it passes no launch decision is well founded.

---

### PROD-04 — E2E specs exist but cover a narrow slice

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | `tests/e2e/` |
| **Blocker** | No |

Present: `smoke`, `auth-recovery`, `account-lifecycle`, `durable-canvas`,
`collaboration-recovery`, plus Percy visual specs for auth and canvas.

Missing journeys, each corresponding to a finding above:

- Public share link opened by a signed-out visitor (UI-03, UI-04).
- A canvas large enough to trigger byte truncation (LOG-01).
- Multi-user cursor presence sustained over 60+ seconds (LOG-02).
- Share role enforcement: VIEW cannot edit, COMMENT cannot move items.
- Upload → render → delete → asset lifecycle.
- Bulk canvas delete, including a partial failure.

---

## Part 2 — Deployment Risks

### PROD-05 — `/api/health` reports healthy regardless of dependency state

| | |
| --- | --- |
| **Severity** | **High** |
| **Location** | [api/health/route.ts](src/app/api/health/route.ts) |
| **Blocker** | **B** |

The entire handler:

```ts
export async function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
```

It checks nothing. Meanwhile [ARCHITECTURE.md](ARCHITECTURE.md) documents it as
*"`GET /api/health`: database and process health."* The documentation and the
implementation disagree.

**Failure scenario.** PostgreSQL becomes unreachable. `/api/health` returns 200.
A load balancer or `docker-compose` healthcheck keeps the container in rotation,
serving 500s to every user. The outage is invisible to exactly the system whose
job is to detect it.

The real check lives at `/api/ready` — which verifies database, Redis, object
storage, **and** migration completion — but it is gated behind
`hasInternalOperationsAccess`, so it returns 404 to an unauthenticated prober
(PROD-06).

**Fix.** Either make `/api/health` a genuine liveness probe (process is
responsive — currently true, so just correct the documentation), or add a
shallow dependency check. Be explicit about which endpoint is liveness and which
is readiness, and wire orchestrators to the right one.

---

### PROD-06 — Readiness probe requires a bearer token

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [api/ready/route.ts:8-10](src/app/api/ready/route.ts#L8-L10) |
| **Blocker** | No |

`/api/ready` returns 404 without `INTERNAL_OPERATIONS_TOKEN`. Not returning
infrastructure detail to the internet is the right instinct, but it means every
orchestrator probe must carry the token — Kubernetes `httpGet` probes support
headers, Docker Compose `healthcheck` needs the token embedded in the command,
and the token then appears in `docker inspect` output.

**Fix.** Return an unauthenticated boolean ready/not-ready (200/503) with **no**
body detail, and keep the itemised per-dependency breakdown behind the token.
Probes need the status code, not the diagnosis.

---

### PROD-07 — No container healthcheck or init process

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [Dockerfile](Dockerfile) |
| **Blocker** | No |

The runtime stage is otherwise well built — multi-stage, non-root `memoria`
user, `pnpm prune --prod`, pinned base image, no runtime secrets baked in. Gaps:

- **No `HEALTHCHECK`.** Nothing detects a wedged process.
- **No init process.** `CMD ["node", "scripts/start-server.mjs"]` runs Node as
  PID 1. `server.ts` does register `SIGTERM`/`SIGINT` handlers with a graceful
  shutdown and a 20 s deadline, so the critical case is handled — but zombie
  reaping is not. Add `--init` or `tini`.
- **`COPY . .` in the source stage** relies entirely on `.dockerignore`; verify
  it excludes `.env`, `.next`, `coverage`, `test-results`, `playwright-report`.

---

### PROD-08 — Single-process topology is a documented ceiling, not a scaling story

| | |
| --- | --- |
| **Severity** | Medium (informational) |
| **Location** | [ARCHITECTURE.md](ARCHITECTURE.md), [server.ts](server.ts) |
| **Blocker** | No |

The constraint is stated honestly — `AGENTS.md` says "Do not add replicas or move
to serverless until shared event, lease, and job semantics are implemented." The
risk is that the ceiling is not quantified anywhere:

- One Node process serves **all** HTTP and **all** WebSocket traffic.
  `MAX_CONNECTIONS_GLOBAL = 5000`, but no measurement supports that number.
- Any synchronous main-thread cost (PERF-01, PERF-03) blocks collaboration for
  every connected user.
- No load testing exists (see PERF measurement gap).
- LOG-16 means that if Redis is down at boot, a future multi-instance deployment
  would silently partition rather than fail.

**Fix.** Publish a supported-capacity figure backed by one load test, and alert
on approach to it. Document that vertical scaling is the only lever today.

---

### PROD-09 — Backup and restore are scripted but unverified here

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [docs/operations/backup-recovery.md](docs/operations/backup-recovery.md), `scripts/check-backup-freshness.sh`, `tests/unit/backup-recovery-scripts.test.ts` |
| **Blocker** | No |

Genuinely better than most projects at this stage: a runbook exists, a freshness
check exists, and there is a unit test for the scripts.

What is not evidenced: a **restore rehearsal**. The unit test exercises the
scripts, not a real `pg_restore` into an empty database followed by a working
application. Given LOG-08 (hard canvas deletion with no soft-delete), restore
from backup is the *only* recovery path for a user's most damaging mistake — so
its untested status is materially riskier here than usual.

**Fix.** Rehearse a full restore against the compose stack before launch and
record RTO/RPO in the runbook. Object storage needs its own backup story —
PostgreSQL dumps do not cover uploads.

---

## Part 3 — Observability

### PROD-10 — Metrics cover the process, not the product

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [api/metrics/route.ts](src/app/api/metrics/route.ts) |
| **Blocker** | No |

The file is upfront about it:

> "The app does not keep an in-process metrics registry yet, so this endpoint
> exposes only measurements collected by this process. Application counters are
> omitted until real request instrumentation is wired in."

Exposed: CPU, memory, uptime, outbox queue age, dead jobs. Not exposed and
needed to operate this system:

| Signal | Why | Related |
| --- | --- | --- |
| HTTP request count / latency / status by route | No way to see error rates | — |
| Rate-limit rejections (429s) by limiter | Cannot tell if limits are hurting users | PERF-06, SEC-07 |
| Active WebSocket connections + canvases | Only signal for the topology ceiling | PROD-08 |
| WS message-rate-limit drops | Would make LOG-02 visible | LOG-02 |
| `truncatedByBytes` occurrences | Would make LOG-01 visible | LOG-01 |
| AI tokens/cost by user | No overspend detection | SEC-08 |
| Login failures / lockouts | Attack detection | SEC-01, SEC-10 |

`getConnectionCount()` and `getActiveCanvasCount()` are already exported from
`websocket-server.ts` and simply aren't surfaced.

**Fix.** Wire the two existing WebSocket gauges in immediately — near-zero cost.
Add a counter registry and instrument the middleware for request metrics.
Sentry is configured for errors; metrics are the gap.

---

### PROD-11 — No alerting definitions

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | repository-wide |
| **Blocker** | No |

Metrics are exposed but no alert rules, thresholds, or on-call runbook exist.
Minimum set before launch: `/api/ready` failing, outbox queue age above
threshold, `DEAD` outbox jobs > 0, Redis unreachable (which per SEC-09 means
**all logins fail** — this needs its own alert), disk/storage capacity, and
error-rate spikes from Sentry.

---

## Part 4 — What is already production-grade

Recording these so the assessment is balanced and no one re-solves them:

- **CI is genuinely thorough** — lint, type-check, coverage, integration against
  real PostgreSQL, build with bundle budgets, `pnpm audit --prod`, dependency
  review with license denial, clean container build, CycloneDX SBOM, e2e.
  Better than most production systems.
- **Environment validation with production invariants** that fail startup rather
  than degrade silently ([lib/env.ts](src/lib/env.ts)).
- **Durable outbox** for side effects, with a dedicated worker, dead-letter
  status, and queue-age metrics.
- **Graceful shutdown** with connection draining and a hard deadline
  ([server.ts:60-84](server.ts#L60-L84)).
- **Structured logging** (pino) with request-id propagation through
  `AsyncLocalStorage` and redaction.
- **Migration completeness** is part of the readiness check.
- **Schema drift detection** (`pnpm check-schema-drift`) and a `doctor` command.
- **Idempotency keys** on mutation routes.
- **Advisory locks** around canvas mutations.

---

## Go / No-Go

**Recommendation: no-go until the blockers below are closed.**

Not because the foundation is weak — it is strong, and the operational tooling is
ahead of the product. The blockers are concentrated in a narrow band: the
application silently hides user data, the flagship real-time feature stops
working within seconds, destructive actions are unrecoverable, and the launch
gate the project defined for itself has never been run.

### Blockers

| ID | Title | Est. |
| --- | --- | --- |
| **LOG-01** | Item lists silently drop items | S |
| **LOG-02** | Live cursors die after seconds of movement | S |
| **LOG-03** + **SEC-01** | Lockout after password verify; unverified-email oracle | S |
| **LOG-08** | Unrecoverable bulk canvas delete | M |
| **SEC-03** | `shareToken` leaked to VIEW collaborators | S |
| **SEC-08** | AI endpoints have no cost ceiling *(or disable AI)* | M |
| **PERF-01** | `boundedItemsResponse` O(n²) | S |
| **UI-04** | Public shares capped at 50 items | S |
| **UI-05** | Search hides most item types | S |
| **UI-14** | Canvas operations fail silently | S |
| **PROD-03** | Run the `DEC-014` verification gate | — |
| **PROD-05** | `/api/health` checks nothing | S |

Most are small and localised. **LOG-01 + PERF-01 are the same function.
LOG-03 + SEC-01 are the same function. UI-03 + UI-04 are the same file.**

### Suggested sequence

1. **Correctness sprint** — LOG-01/PERF-01, LOG-03/SEC-01, SEC-03, UI-04/UI-03,
   UI-05, LOG-02, UI-14. Mostly small, mostly independent.
2. **Data safety** — LOG-08 soft delete (needs a migration; start it in parallel).
3. **Cost & abuse** — SEC-08, or ship with AI disabled behind a flag.
4. **Observability** — PROD-05, PROD-10's cheap gauges, PROD-11 alerts.
5. **Run the gate** — PROD-03, with new regression tests from step 1 included.
6. **Then launch**, with PERF-02/03/04 and the remaining Medium findings as the
   first post-launch sprint.

### Launch checklist

- [ ] All blockers above closed, each with a regression test
- [ ] `DEC-014` executed and passing: `pnpm test:e2e`, `pnpm test:integration`
      against real PostgreSQL, `pnpm build`, `pnpm smoke`
- [ ] Restore rehearsal completed; RTO/RPO recorded (PROD-09)
- [ ] Alert rules defined, including Redis-down → all-logins-fail (PROD-11)
- [ ] `UPLOAD_SCAN_REQUIRED=true` with a scanner deployed (SEC-11)
- [ ] `REGISTRATION_MODE` set deliberately — the default is `open` (SEC-08)
- [ ] `CORS_ALLOWED_ORIGINS` set explicitly (SEC-04)
- [ ] Analytics decision made and documented (SEC-13)
- [ ] Landing-page claims corrected (UI-10)
- [ ] Load test run; supported capacity published (PROD-08)
