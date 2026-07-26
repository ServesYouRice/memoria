# Production Readiness Decision

## Recommendation: No-go for public production

The project builds and its current automated checks pass, but it is not ready for an open public launch. The blocking risks are user-data loss/inconsistent state, incomplete production registration, authorization-capability mismatch in the client, ineffective reverse-proxy throttling, unbounded resource use, incomplete uploaded-object deletion/recovery, and insufficient production-path test evidence.

A constrained internal pilot is possible only if it is intentionally single-instance and invite-only, strict canvas/upload quotas are applied, production registration is closed, and collaboration, public links, uploads, templates/duplicate, undo/redo, polls, rich-text claims, AI/agents, and other affected features are disabled until their blockers are cleared. Autosave integrity, release-image verification, and database recovery remain mandatory even for that pilot.

## Evidence summary

| Area | Evidence | Readiness conclusion |
|---|---|---|
| Static/build | Lint, typecheck, and Next production build passed | Necessary but not sufficient |
| Automated tests | 217 tests passed; 8.81% statement/line coverage | Critical paths are largely untested |
| Browser/UI | Source and server-response review completed; approved browser runtime unavailable | Responsive/visual/manual a11y sign-off missing |
| Collaboration | Presence/cursor sockets exist; durable item changes are not synchronized | Not production-ready for multi-user editing |
| Persistence | Autosave and optimistic rollback can strand or misrepresent changes | Data-integrity blocker |
| Security/abuse | Strong auth primitives and SSRF/CSP controls; proxy identity, quotas, WS admission, payload bounds need work | Public abuse/availability blocker |
| Recovery | PostgreSQL scripts exist; checksum enforcement is ineffective and uploads are omitted | Recovery blocker |
| Deployment | Container builds but is not boot-tested; migrations run at app startup | Release evidence incomplete |
| Dependencies | Lockfile exists; a fresh advisory scan was not available in this restricted audit | Release candidate still needs a successful scan |

## Launch blocker matrix

| Priority | Blocker | Finding references | Exit criterion |
|---:|---|---|---|
| P0 | Silent loss/stale optimistic state | `LOG-02`, `LOG-03`, `UI-07` | Serialized retryable mutation queue; cache convergence; failure/unload/conflict tests; truthful save UI |
| P0 | Item movement and undo/clone corrupt relationships | `LOG-04`–`LOG-06` | One persistence path per item; relationship/asset remapping; atomic operations; otherwise features disabled |
| P0 | Collaboration does not converge | `LOG-01`, `ARCH-01`, `PERF-09` | Two clients and supported replicas converge via committed versioned events; reconnect/lease tests pass |
| P0 | Production signup strands users | `UI-02`, `LOG-15`, `TEST-03` | Outbox-backed email, accessible resend, production-policy E2E including failure/expiry |
| P0 | Reverse-proxy throttles are global | `SEC-01`, `DEP-03` | Trusted-proxy spoof/multi-hop tests pass in real edge topology; per-account limits added |
| P0 | Resource creation and payloads are unbounded | `SEC-02`, `SEC-06`, `PERF-01`, `PERF-02` | Registration policy, atomic quotas, payload/aggregate limits, viewport pagination, abuse/load tests |
| P0 | Upload memory, lifecycle, deletion, and backup are unsafe | `SEC-03`, `SEC-08`, `PERF-04`, `DEP-02` | Streaming quarantine, durable cleanup/reconciliation, object-storage backup and verified restore |
| P0 | Backup restoration is not trustworthy | `DEP-01`, `TEST-09` | Authenticated checksum, SQL error-stop, clean full restore with integrity and RPO/RTO record |
| P0 | Release artifact/migrations are not proven | `TEST-07`, `TEST-10`, `DEP-04`, `DEP-06` | Exact image digest boots/smokes; clean and upgrade migrations pass; controlled migration job |
| P0 | Canvas accessibility path is absent | `UI-03`, `UI-04`, `TEST-05` | DOM item list and role-capability matrix pass keyboard, automated, and manual assistive-tech tests |
| P0 | Advertised item features have incorrect contracts | `LOG-08`, `LOG-09`, `UI-09` | Rich text/polls/templates repaired atomically and tested, or disabled and claims removed |
| P0 | Public WebSocket admission is weak | `SEC-04` | Scoped share/ticket admission, Origin/IP/canvas limits, abuse/reconnect tests |
| P0 | Release security evidence is incomplete | `SEC-10` | Fresh production-dependency scan/SBOM reviewed with time-bound exceptions |

## Recommended remediation order

### Phase 1 — Freeze scope and protect data

1. Decide the launch topology and feature flags. Default to invite-only, single instance, and disable unsafe optional features.
2. Fix autosave serialization, optimistic rollback, version-conflict handling, and one movement persistence contract.
3. Disable undo/redo, clone/templates, rich text, and polls until each preserves identifiers, references, assets, and concurrency correctly.
4. Establish hard per-item, per-canvas, per-user, upload, and AI budgets.

### Phase 2 — Repair security and external side effects

5. Correct trusted-proxy client identity and add account/tenant throttling and registration policy.
6. Add a transactional outbox for verification email, object cleanup, and external actions.
7. Stream/quarantine assets, make deletion retryable/reconcilable, and secure public WebSocket admission.

### Phase 3 — Make collaboration and access contracts real

8. Publish committed versioned item events and reconcile client caches; implement full Redis fanout/leases before multiple replicas.
9. Centralize role capabilities at every UI interaction and add a real DOM canvas item view.
10. Fix onboarding, shortcut interception, save/conflict UI, server-rendered first paint, and narrow-screen tool layout.

### Phase 4 — Prove release and recovery

11. Add real-PostgreSQL, two-user, production-auth, upload, and destructive-operation tests.
12. Repair database checksum/error handling, back up objects, and complete a clean restore drill.
13. Boot and smoke the exact production image, verify migration upgrade/drift, and run the dependency/security gate.
14. Run responsive visual, keyboard, screen-reader, load, and failure-injection checks; record accepted launch limits.

### Phase 5 — Operate deliberately

15. Promote the tested digest through staging, with dashboards/alerts for latency, errors, DB/Redis/storage, queues, email, sockets, uploads, and AI spend.
16. Exercise rollback/forward-fix, secret rotation, and incident ownership runbooks before opening registration.

## Production acceptance checklist

- [ ] Every P0 matrix row has an owner, target release, test evidence, and explicit sign-off.
- [ ] No known path can display an unsaved optimistic result as durably saved.
- [ ] Role matrix is verified for owner, edit, comment, view, anonymous public, expired/revoked access.
- [ ] Supported canvas/item/upload limits are enforced and documented.
- [ ] Fresh dependency scan and SBOM are attached to the immutable candidate image.
- [ ] Production-equivalent auth/email and two-user collaboration tests pass.
- [ ] Keyboard, screen-reader, dark/light, and target viewport checks pass.
- [ ] Database plus object-storage restore succeeds within declared RPO/RTO.
- [ ] Proxy, rate limiting, metrics access, WebSocket admission, and alerting are verified at the real edge.
- [ ] Rollback/forward-fix and incident runbooks have named owners and a completed rehearsal.

## Audit limitations

- The in-app browser had no available browser backend, so no runtime screenshots, touch-device pass, or manual assistive-technology pass could be captured. Source-level UI findings must be complemented by those release checks.
- The local environment had no reachable PostgreSQL/Redis/S3 stack for destructive integration testing; Docker was unavailable. Findings are based on code, configuration, build behavior, and existing automated tests.
- Registry access for a current production dependency advisory scan was unavailable in the restricted environment. The absence of a result is not evidence of either safety or a known vulnerability.
- No production data, external services, deployment, or application code was changed during the audit.
