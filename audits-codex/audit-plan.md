# Memoria Production Audit Plan

## Purpose and boundaries

This is an inspection-only production-readiness audit. No application code, configuration, migrations, dependencies, or tests will be changed. All audit output will remain under `audits-codex/`.

The audit will distinguish:

- a **confirmed issue**, supported by a current source location or verification result;
- a **known limitation**, already documented in `REMAINING-WORK.md` and re-verified against the current tree;
- a **verification gap**, where release evidence is missing but a defect was not reproduced; and
- a **future enhancement**, which is not required for a safe launch.

## Project orientation

Memoria is a stateful visual-note and collaboration product built on:

- Next.js 16.2 App Router, React 19, and TypeScript;
- Material UI/Emotion, TanStack Query, Zustand, Tiptap, Konva/react-konva, and Yjs;
- Auth.js/NextAuth credentials authentication with Argon2;
- Prisma 6 and PostgreSQL;
- Redis for production caching, distributed rate limiting, and collaboration fanout;
- S3-compatible private object storage for uploads;
- a custom Node server and `ws` WebSocket server for real-time collaboration;
- Vitest, Playwright, and optional Percy visual tests;
- Docker Compose/self-hosted container deployment, with Sentry and Prometheus-style metrics support.

The production runtime is intentionally stateful; a serverless-only deployment is not a supported primary architecture.

## Main routes and user flows to inspect

| Flow | Primary surfaces | Supporting boundaries |
|---|---|---|
| First-run initialization | `/setup` | `/api/setup/initialize`, environment/bootstrap validation |
| Account lifecycle | `/auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/settings` | Auth.js, verification/reset tokens, lockout, profile/password/account APIs, email providers |
| Canvas discovery and organization | `/dashboard`, `/workspaces`, `/shared`, `/templates`, `/search`, `/trash`, `/notifications` | canvas/workspace/template/search/trash/activity APIs and TanStack Query hooks |
| Canvas editing | `/canvas/[canvasId]` | canvas/item/version/connection/upload/unfurl APIs, Zustand, autosave, Konva, export and thumbnail generation |
| Collaboration and sharing | canvas share/comments UI, `/share/[token]` | share/comment APIs, custom WebSocket server, Redis pub/sub, authorization revalidation |
| User and developer controls | `/settings`, `/api-keys` | account export/deletion, API key routes, agent profiles/providers/integrations/actions |
| Public and operational surfaces | `/`, `/help`, `/status`, `/privacy`, `/terms`, `/offline`, `/api/health`, `/api/metrics` | CSP/CORS/security middleware, service worker, logging and deployment configuration |

## Audit workstreams

1. **UI and UX**
   - Inventory every page, navigable route, modal, drawer, menu, form, loading/empty/error state, and public-sharing surface.
   - Review responsive behavior, focus/keyboard behavior, accessible names and semantics, motion, contrast/theme consistency, destructive-action copy, and recovery paths.
   - Inspect desktop and mobile runtime rendering where the local environment permits it.

2. **Application logic and data integrity**
   - Trace the main query/mutation hooks through route handlers and Prisma writes.
   - Check authorization, validation, optimistic concurrency, idempotency, partial-failure handling, cache invalidation, pagination, async cleanup, race conditions, and cross-instance behavior.
   - Re-verify unresolved items from `REMAINING-WORK.md` without re-reporting fixed historical findings.

3. **Security and privacy**
   - Review auth/session handling, setup/bootstrap exposure, share tokens, API keys, uploads, SSRF controls, CSP/CORS, rate-limit failure modes, secrets/redaction, public operational endpoints, agent credentials, webhooks, and account deletion/export.

4. **Performance and scalability**
   - Inspect server/client bundle boundaries, full-canvas loading, thumbnail and upload pipelines, database query shape/indexes, collaboration fanout, caching, background work, large transactions, and user-controlled payload limits.

5. **Architecture and production operations**
   - Compare the documented runtime model with `server.ts`, Docker, Compose, environment validation, migrations, health/metrics, backup/restore, scheduled jobs, and CI.
   - Identify single-instance assumptions, deployment traps, rollback gaps, and observability blind spots.

6. **Testing and release evidence**
   - Run lint, TypeScript, unit/API coverage, and a production build.
   - Inspect unit, integration, E2E, visual, accessibility, multi-instance, service-worker, migration, and container test coverage.
   - Record unavailable verification separately from confirmed defects.

## Initial verification baseline

Fresh checks run on 2026-07-26:

- `pnpm run lint`: passed.
- `pnpm run type-check`: passed.
- `pnpm exec vitest run --coverage`: 28 files and 217 tests passed.
- Overall measured coverage: 8.81% statements/lines, 50.12% branches, and 28.78% functions.
- `pnpm run build`: passed and generated 66 routes, including 25 pages and 63 API route handlers in the source tree.
- The build logged an unavailable PostgreSQL connection while generating pages but still exited successfully; this requires production-readiness review rather than being treated as a failed build by itself.

## Severity and blocker rules

| Severity | Audit meaning |
|---|---|
| Critical | Direct path to broad compromise, unrecoverable data loss, or complete production outage under expected use. |
| High | Likely serious security/data/reliability failure, or a core flow that is unsafe or not credibly release-tested. |
| Medium | Material production defect or operational risk with a bounded impact or workaround. |
| Low | Localized usability, maintainability, consistency, or resilience problem. |
| Nice-to-have | Valuable polish, tooling, or roadmap improvement that is not required for a safe initial launch. |

An item is a **production blocker** only when the current launch would expose users or operators to an unacceptable security, data-loss, core-flow, or unrecoverable operational risk. Missing evidence can be a blocker when the unverified path is itself destructive or foundational.

## Planned deliverables

- `ui-issues.md`
- `logical-issues.md`
- `nice-to-haves.md`
- `security-issues.md`
- `performance-issues.md`
- `architecture-review.md`
- `testing-gaps.md`
- `production-readiness.md`
- `deployment-risks.md`

Each issue will include title, severity, location, description, production impact, recommended fix, blocker status, and related risks/dependencies. Findings will be ordered by severity and cross-referenced rather than copied verbatim between files.

