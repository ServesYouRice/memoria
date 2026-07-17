# Memoria deep audit

Audit date: 2026-07-12  
Audited commit: `e40dc83` (`main`)  
Verdict: **not production-ready**

Tracked findings: **178** across security/privacy (29), correctness/data integrity (32), deployment/operations (28), performance/scalability (26), UI/UX/accessibility (35), testing (16), and maintainability/refactoring (12).

This audit covers the application, API, database model, collaboration server, agent/webhook subsystem, self-hosting workflow, build and release tooling, performance, UI/UX, accessibility, tests, and current dependency advisories. The older `audits-fable/` material was used only as a lead list; every finding included here was rechecked against the current tree. In particular, the current project **does have three committed Prisma migrations**, so the older claim that migrations were absent is not repeated.

## Bottom line

The project has a credible product foundation and several good defensive building blocks, but it currently has multiple independent release stoppers:

1. A crafted Yjs update can overwrite, undelete, or delete an item in another user's canvas when the attacker knows the item ID.
2. Production dependencies have 98 known findings, including five critical findings; the installed Next.js has confirmed RCE and middleware authorization-bypass advisories.
3. The documented self-host path cannot build a clean Docker image with its generated environment, reuses published placeholder secrets, and emits visitor-localhost URLs on remote deployments.
4. The service worker caches authenticated API/page responses across sessions and accounts.
5. Upload storage has no authorization layer: the reference private bucket makes images fail, while making it public exposes private-canvas images permanently.
6. Outbound webhooks can follow an unvalidated redirect into an internal network, and an absolute action path can escape the configured integration origin.
7. Approved agent suggestions can be executed twice under concurrency, including duplicate external side effects.
8. The advertised real-time item collaboration and live cursors are not connected to the canvas UI.
9. A global client mutation retry can duplicate create operations because the clients do not send idempotency keys.
10. Unit tests pass, but statement coverage is 7.99%; collaboration, the service worker, most UI/hooks, and most production routes have no behavioral coverage. The configured E2E suite is not reliable release evidence.

Do not expose this build to untrusted users or production data before the critical and high findings are addressed and regression-tested.

## Audit documents

- [Security and privacy](./01-security-and-privacy.md)
- [Correctness and data integrity](./02-correctness-and-data-integrity.md)
- [Deployment, operations, and supply chain](./03-deployment-operations-and-supply-chain.md)
- [Performance and scalability](./04-performance-and-scalability.md)
- [UI, UX, and accessibility](./05-ui-ux-and-accessibility.md)
- [Testing, maintainability, and refactoring](./06-testing-maintainability-and-refactoring.md)

## Immediate release gates

| Priority | Finding | Required outcome |
|---|---|---|
| P0 | `SEC-01` cross-tenant Yjs mutation | Scope every read/write/delete to `canvasId`, authenticate attribution server-side, validate the item payload, and add an exploit regression test. |
| P0 | `OPS-01` vulnerable runtime graph | Upgrade Next.js and all critical/high runtime chains; rerun `pnpm audit --prod` until the approved release policy passes. |
| P0 | `OPS-02` / `OPS-03` broken and unsafe self-host path | Make a clean-clone Docker build deterministic, generate real secrets, keep them out of image layers and Git, and test the documented setup on a fresh host. |
| P0 | `SEC-08` service-worker data cache | Never Cache Storage-cache authenticated HTML or API responses; version caches by build and purge the unsafe cache on activation. |
| P0 | `SEC-09` upload authorization | Serve private objects through an authorized proxy or short-lived signed URLs; implement object lifecycle and deletion. |
| P0 | `SEC-10` / `SEC-11` webhook SSRF and origin escape | Revalidate every redirect, pin validated DNS/IPs, reject absolute action paths, and bound response reads. |
| P0 | `COR-01` duplicate agent execution | Atomically claim an approved suggestion before side effects and require downstream idempotency. |
| P1 | `COR-02` collaboration is not wired | Either bind the canvas item model to Yjs and make it the authority, or remove the claim/unsafe write path until a coherent model exists. |
| P1 | `SEC-16` rate-limit bypass | Use a trusted proxy-derived client identity and a bounded distributed limiter; add separate limits for agent, AI, CSP, setup, and WebSocket traffic. |
| P1 | `COR-03` duplicate client mutations | Default mutations to no retry or attach stable idempotency keys to every retryable create/side-effect endpoint. |
| P1 | `SEC-19` account-recovery token leakage | Disallow the console email provider in production, redact URL secrets, and make recovery delivery a startup/readiness requirement. |
| P1 | `TST-01` / `TST-03` insufficient release evidence | Add coverage gates and replace the stale E2E harness with real seeded sessions and current routes. |

## Verification snapshot

| Check | Result |
|---|---|
| `pnpm run lint` | Passed cleanly. |
| `pnpm run type-check` | Passed cleanly. |
| `pnpm exec prisma validate` | Passed; warned about renamed/deprecated PostgreSQL full-text preview flags. |
| `pnpm exec vitest run --coverage` | 26 files / 207 tests passed; 7.99% statement and line coverage. |
| `pnpm audit` | Failed release gate: 127 total findings (8 critical, 49 high, 57 moderate, 13 low). |
| `pnpm audit --prod` | Failed release gate: 98 runtime findings (5 critical, 33 high, 47 moderate, 13 low). |
| `pnpm run build` | Failed before compilation because the local `.env` does not repeat every key in `.env.example`. |
| Direct `next build` with only env-file loading skipped | Failed production env validation (`UPLOAD_STORAGE`, bootstrap token). |
| Direct `next build` with audit-only build variables | Passed; emitted the Sentry/OpenTelemetry dynamic-require warning. |
| `pnpm run build:server` | Passed outside the filesystem sandbox; output was 37.2 KB. |
| `pnpm run check-bundle` | Reported success, but the checker misclassifies App Router/Windows paths and leaves 1.6 MB of JS under an unbudgeted `OTHER` bucket. |
| Playwright discovery | 333 configured browser cases in `tests/e2e`; root `e2e/` security/observability tests are excluded. |
| Representative Playwright run | Could not start the web server because the same env-file contract rejected missing optional example keys. |

The production compiler initially also failed when it could not fetch Google Fonts. Once network access was allowed and the audit-only required variables were provided, the application compiled. This distinguishes a valid TypeScript/Next build from the broken documented environment and Docker workflows.

## Remediation sequence

### Wave 0: contain exposure

- Disable the collaboration binary update path and outbound webhook execution until `SEC-01`, `SEC-10`, `SEC-11`, and `COR-01` are fixed.
- Unregister/purge the current service worker cache.
- Do not enable public object access for private user uploads.
- Upgrade the critical runtime dependencies before any deployment.

### Wave 1: establish a safe production baseline

- Rebuild self-hosting around a multi-stage, non-root image with an explicit build-time environment contract and runtime secret injection.
- Add migrations to container startup/release orchestration, readiness checks for Postgres/Redis/object storage/email, graceful signal handling, and backups.
- Repair session revocation, recovery-email delivery, rate limiting, and account deletion.

### Wave 2: make the core product coherent

- Choose one item-write authority (REST optimistic concurrency or Yjs), then test multi-user, multi-instance, restore, reconnect, and revocation behavior.
- Remove global mutation retry, fix pan/zoom state, make controls permission-aware, and replace visible stubs or label them as unavailable.
- Stop loading duplicate full-canvas datasets and version snapshots at page open.

### Wave 3: make regressions difficult

- Raise coverage around authorization and data integrity first, not utility helpers.
- Rebuild E2E fixtures around seeded users and real Auth.js sessions.
- Add dependency, bundle, migration, Docker smoke, accessibility, and load-test gates to CI.

## Method and confidence

Findings marked critical/high are based on direct code paths, command output, or both. No destructive actions and no production-data exploit attempts were performed. UI findings are based on a complete route/component inventory and source-level interaction audit; a full authenticated visual walkthrough was not possible because the documented local server startup currently fails its environment contract. No application source was changed as part of this audit.
