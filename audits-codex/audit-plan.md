# Memoria Production Audit Plan

## Purpose and constraints

This audit evaluates whether Memoria is ready to run as a production visual-notes product. It is an inspection-only review: no application source, tests, infrastructure, dependency declarations, or implementation backlog will be changed. All durable audit output is confined to `audits-codex/`.

## Initial system inventory

Memoria is a stateful Next.js 16 / React 19 application served by a custom Node runtime (`server.ts`). PostgreSQL/Prisma owns durable application data, Redis supplies shared cache, rate-limit, session, and collaboration support, S3-compatible storage owns uploads, Auth.js handles credentials sessions, and a WebSocket server carries ephemeral collaboration signals. The deployment target is a self-hosted container/VPS topology rather than a serverless runtime.

The principal user flows identified for review are:

1. first-run setup, registration, email verification, sign-in, password recovery, and sign-out;
2. dashboard, workspaces, canvas creation, templates, search, and trash recovery;
3. canvas editing, autosave, uploads, comments, version restore, export, and collaboration recovery;
4. direct sharing, public links, shared/public read-only access, and revocation;
5. profile, settings, notification preferences, API keys, and account deletion;
6. agent profiles, credentials, integration ingress, suggestions/actions, and auditability;
7. health, readiness, metrics, migrations, workers, backups, smoke checks, and failure recovery.

## Audit questions

### UI and product behavior

- Are all implemented capabilities reachable through clear navigation and complete routes?
- Do loading, empty, error, disabled, destructive, and recovery states communicate the truth?
- Do desktop, tablet, mobile, keyboard, screen-reader, reduced-motion, and coarse-pointer experiences remain usable?
- Are authentication, sharing, canvas editing, and account-lifecycle journeys understandable and recoverable?

### Logic, data, and integrations

- Do API boundaries enforce authentication, authorization, validation, bounded input/output, and safe error responses?
- Can concurrent edits, autosave, collaboration replay, retries, idempotency, outbox leases, cache invalidation, or cleanup jobs lose or corrupt durable state?
- Do storage, email, Redis, AI, webhook, and WebSocket failure modes fail safely and observably?
- Do schema constraints, transactions, cascades, and migrations support the assumptions made by application code?

### Security, performance, testing, and operations

- Are secrets, private uploads, sessions, API keys, SSRF boundaries, CSP/CORS, rate limits, and operational endpoints protected in production?
- Are database queries, payloads, client bundles, polling, rendering, and background work bounded under realistic load?
- Do tests exercise production-shaped PostgreSQL, Redis, object storage, email, WebSockets, and the custom Node runtime?
- Can operators deploy, migrate, monitor, back up, restore, roll back, and diagnose the supported topology?

## Method

1. Inventory routes, components, hooks, stores, API handlers, schema, migrations, runtime configuration, operational scripts, and tests.
2. Trace the core flows from UI entry point through client state, HTTP/WebSocket boundaries, persistence, and recovery behavior.
3. Search systematically for incomplete states, unsafe assumptions, unbounded work, swallowed failures, race-prone effects, missing authorization/validation, and operational gaps.
4. Run available baseline checks and focused tests. Keep environment limitations separate from verified failures.
5. Review existing browser/E2E artifacts and attempt a live rendered review through the supported browser connection.
6. Validate every candidate finding against its exact source and related tests so completed or intentionally gated work is not re-reported.
7. Write prioritized findings with severity, location, production impact, recommended fix, launch-blocker status, and dependencies.

## Planned deliverables

- `ui-issues.md`: UI/UX and accessibility findings, followed by ranked pre-production priorities.
- `logical-issues.md`: application/data/integration findings, followed by explicit production blockers.
- `nice-to-haves.md`: high-impact additions, product polish, developer experience, architecture recommendations, and roadmap ideas.
- `security-issues.md`: authentication, authorization, data exposure, abuse, and secret-handling findings.
- `performance-issues.md`: server, database, network, rendering, and bundle concerns.
- `maintainability-issues.md`: configuration drift, contract duplication, dead gated code, and high-complexity modules.
- `testing-gaps.md`: failed checks, missing production-shaped coverage, and verification limitations.
- `production-readiness.md`: release-gate synthesis and recommended remediation order.

## Verification record to collect

- repository status and scope of audit-only changes;
- `pnpm lint`, `pnpm type-check`, and the unit/API test suite;
- the blocked real-service integration, production E2E, build, and smoke gates;
- route and navigation inventory;
- retained Playwright/Percy coverage and artifacts;
- supported-browser availability for live desktop/mobile screenshot inspection.

## Execution record

The inspection phase completed on 2026-08-08 without modifying application source, tests, infrastructure, dependencies, or the implementation board.

- Passed: `pnpm lint`, `pnpm type-check`, `pnpm run check-bundle`.
- Passed focused checks: 32 SSRF, health-route, and canvas-accessibility tests across 3 files.
- Failed: the full unit/API run (7 failures across 6 files) and a focused auth-verification run (2 failures caused by import timeout/test contamination).
- Failed: `pnpm audit --prod --audit-level=high` with 5 high and 5 moderate production-tree advisories.
- Not executed: production build, real-PostgreSQL integration, production E2E, and operations smoke. The repository records that gate as `IMP-038`, waiting on `DEC-014`.
- UI limitation: the supported in-app browser had no available browser backend. Retained screenshots were treated as historical artifacts, not current visual acceptance evidence.

Final findings are split across the planned reports plus `deployment-risks.md`. The consolidated launch decision and remediation order are in `production-readiness.md`.
