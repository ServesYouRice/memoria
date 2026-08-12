# Production Readiness Assessment

## Verdict

**Memoria is not ready for production launch as audited on 2026-08-08.**

The application has a strong foundation—durable PostgreSQL authority, explicit ownership checks, Zod validation, a private upload path, strict CSP/security headers, idempotency/mutation locks, a PostgreSQL outbox, protected operational routes, bounded launch counts, migration separation, recovery scripts, and a custom runtime that matches the WebSocket topology. Lint, type checking, focused security/health/accessibility tests, and configured bundle budgets pass.

Those controls do not offset the current launch blockers: fresh self-host installs accept repository-known operational/backup secrets; the reference container drops registration and trusted-proxy settings; public shares silently omit content and consume the wrong metadata shape; SSRF validation is vulnerable to DNS rebinding; durable request/content bytes are not bounded; the dependency audit is red; email/outbox work can hang beyond its lease; backups are not scheduled or proven for the candidate; and the final production-shaped test gate has no green evidence.

## Blocking findings

| Priority | Finding | Why it blocks launch | Exit evidence |
| --- | --- | --- | --- |
| P0 | `SEC-01` known setup secrets | Public defaults authorize operational mutations and invalidate backup-manifest trust. | Clean install generates unique secrets; template values are rejected; old installs have a rotation runbook. |
| P0 | `LOG-01`, `LOG-02` incomplete canvas responses | Authenticated/public views can silently hide durable items; public metadata/viewport is wrong. | Browser retrieves every ID exactly once beyond 50 items and across byte truncation; title/viewport match server data. |
| P0 | `DEP-01`, `DEP-02` self-host configuration/ingress | Registration mode and client IP controls do not reach the container, and no supported HTTPS/WSS path exists. | Rendered Compose plus live proxy tests prove registration modes, distinct IP rate limits, TLS, WebSockets, body caps, and private ops routes. |
| P0 | `SEC-02`, `LOG-05` external fetch safety | DNS rebinding can reach private services and the documented kill switch does nothing. | Connection-pinned DNS tests pass for unfurl and webhooks; feature-off blocks UI, API, and scheduler. |
| P0 | `SEC-03`, `PERF-01` unbounded payload/export work | A single authenticated request or large export can exhaust memory/storage. | Ingress and domain byte limits return bounded errors; large exports stream asynchronously within resource budgets. |
| P0 | `SEC-04` dependency advisories | The configured production dependency gate fails with 5 high advisories. | Production audit and built-image scan pass, or each exception has verified non-reachability and an expiry. |
| P0 | `PERF-06`, `DEP-04`, `DEP-06` email/outbox reliability | Production requires email, but sender delivery is unproved and a provider call can stall the queue beyond its lease. | Verified sender probe passes; timeout/heartbeat/idempotency tests pass; backlog/dead-letter alerts fire. |
| P0 | `DEP-03` recovery operations | Scripts exist, but no automated off-host backup/freshness alert or candidate restore evidence enforces RPO/RTO. | Hourly job and alerts are active; isolated restore of the candidate meets RPO 1h/RTO 4h with hashes and app checks. |
| P0 | `TEST-01`, `TEST-02` release gate | Unit/API tests are red/flaky and production integration/E2E/build/smoke are unexecuted. | The exact image digest reproducibly passes every required gate with retained artifacts. |

Before public launch, also resolve the broken status page (`UI-02`), always-failing Duplicate actions (`UI-01`), disconnected notification surface (`LOG-03`/`UI-03`), and duplicate accessible canvas panels (`UI-04`). These are high-severity product/accessibility failures even when they are not the root security or data-integrity blocker.

## Recommended remediation order

### Phase 1 — Contain security and configuration risk

1. Generate and validate every setup secret; rotate affected installations (`SEC-01`).
2. Make Compose honor registration, trusted proxy, auth-rate, and port settings; ship one tested HTTPS/WSS ingress (`DEP-01`, `DEP-02`).
3. Add hard body/content/image limits at ingress and domain boundaries (`SEC-03`, `SEC-05`).
4. Pin SSRF connections to vetted addresses and enforce the feature kill switch (`SEC-02`, `LOG-05`).
5. Upgrade/triage dependencies until the release audit is green (`SEC-04`).

### Phase 2 — Restore data and workflow correctness

6. Replace offset/pre-truncation metadata with authoritative cursor/byte pagination (`LOG-01`).
7. Update the public share client to the shared contract and prove complete large canvases (`LOG-02`).
8. Reset viewport state on canvas changes and throttle storage persistence (`LOG-04`, `PERF-03`).
9. Remove release-gated Duplicate controls; repair status and notification surfaces; render one accessible panel (`UI-01`–`UI-04`, `LOG-03`).

### Phase 3 — Make operations survivable

10. Bound and renew background work, verify a real email sender, and alert on queues (`PERF-06`, `DEP-04`, `DEP-06`).
11. Schedule off-host backups/freshness checks and complete a restore drill (`DEP-03`).
12. Separate authenticated readiness from public liveness and wire monitoring/alerts (`DEP-05`, `DEP-08`).
13. Stream a complete, versioned account export (`PERF-01`).
14. Prove the 2,000-item canvas budget or reduce it; implement viewport culling (`PERF-02`).

### Phase 4 — Prove the release candidate

15. Stabilize the unit/API harness (`TEST-01`).
16. Add contract, adversarial, responsive, theme, accessibility, and service-worker tests (`TEST-03`–`TEST-06`).
17. Run the exact production image through real PostgreSQL/Redis/S3/email/WebSocket E2E, migrations, backup/restore, readiness, and rollback (`TEST-02`).
18. Correct public claims and record the manual keyboard/screen-reader/mobile acceptance pass (`UI-05`–`UI-07`).

## Release acceptance checklist

### Security and data integrity

- [ ] No example/known secret authenticates against a fresh or upgraded installation.
- [ ] DNS rebinding, private/reserved addresses, redirect changes, and mixed DNS answers are blocked at connection time.
- [ ] JSON, multipart, item structures, image decode cost, exports, snapshots, and per-user durable bytes are bounded.
- [ ] Production dependency and image scans are green or have approved, expiring exceptions.
- [ ] Public and authenticated item pagination returns complete, non-duplicated results under byte limits.

### Product and accessibility

- [ ] Public shares show the correct name, viewport, owner-safe metadata, and all supported items.
- [ ] Status, notifications, sharing, and gated actions communicate truthful states.
- [ ] One accessible item panel exists per canvas; keyboard and screen-reader journeys pass.
- [ ] 320/375/768/1024/1440 widths, coarse pointer, reduced motion, and both explicit themes pass.
- [ ] Marketing/help/privacy copy matches enforced limits and actual feature availability.

### Operations

- [ ] HTTPS/WSS ingress, trusted proxy chain, body limits, and rate-limit identity are proven in the reference topology.
- [ ] Readiness removes unhealthy instances from traffic while liveness remains diagnostic.
- [ ] Verified email delivery, provider timeout, outbox lease recovery, deduplication, and alerts pass.
- [ ] Off-host backups run hourly, freshness alerts run, and a clean restore meets measured RPO/RTO.
- [ ] Metrics, server/client error capture, request IDs, release versions, and alert ownership are configured.

### Verification

- [ ] `pnpm lint`
- [ ] `pnpm type-check`
- [ ] `pnpm test -- --run`
- [ ] `pnpm test:integration` against real PostgreSQL
- [ ] `pnpm audit --prod --audit-level=high`
- [ ] `pnpm build` and boot the exact image digest
- [ ] `pnpm test:e2e` through production HTTP/WSS/services
- [ ] `pnpm smoke` with authenticated readiness/metrics/outbox checks
- [ ] Backup/restore and rollback drills with retained evidence
- [ ] Manual mobile, keyboard, and screen-reader sign-off

## Audit limitations

- No production code, tests, dependency declarations, infrastructure, or implementation-board state was changed.
- The in-app browser had no available backend, so this is not a fresh visual/assistive-technology acceptance pass.
- Real-service integration, production E2E, build, and smoke were not run because the repository’s final gate remains waiting on `DEC-014`.
- Existing Playwright artifacts predate later completed implementation cards and were not treated as current failure evidence.
- Dependency advisory data reflects the package-manager audit performed on 2026-08-08; it should be refreshed at remediation/release time.
