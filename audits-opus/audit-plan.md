# Audit Plan — Memoria

Date: 2026-08-08
Auditor role: senior engineer / product-minded reviewer / production-readiness
Scope: whole repository at commit `083d65e` (branch `main`)
Nature: **inspection only** — no production code was modified.

---

## 1. What this project is

Memoria is a stateful **Next.js 16 (App Router)** application for visual note
organization on an infinite canvas. It is *not* serverless-first: the production
runtime is a custom Node HTTP server (`server.ts`) that hosts both the Next.js
request handler and a `ws` WebSocket collaboration server in one process.

### Stack inventory

| Layer | Technology |
| --- | --- |
| Runtime | Node ≥22.14, custom server `server.ts` → `dist/server.mjs` |
| Framework | Next.js 16.2.12, React 19.2, App Router |
| Language | TypeScript 5.9, ESM (`"type": "module"`) |
| UI | MUI 9 + Emotion, Konva/react-konva (canvas), Tiptap 3 (rich text), cmdk, sonner |
| Client state | Zustand (`canvasStore`, `confirmStore`) + TanStack Query v5 (server state) |
| Server data | Prisma 7.9 + PostgreSQL (`@prisma/adapter-pg`), generated client committed at `src/generated/prisma` |
| Cache / shared state | Redis via ioredis (`REDIS_URL` mandatory in production) |
| Object storage | S3-compatible (`@aws-sdk/client-s3`), MinIO in the reference stack |
| Auth | Auth.js / NextAuth v5 beta, credentials provider, argon2id, JWT sessions, `sessionVersion` revocation |
| Validation | Zod 4 at every HTTP boundary |
| AI | OpenAI SDK (`gpt-4o-mini`), BYOK model credentials for the agent plane |
| Observability | pino, Sentry (`@sentry/nextjs`), `/api/metrics` (Prometheus text) |
| Tests | Vitest 4 (unit/integration), Playwright 1.62 (e2e), Percy (visual) |
| CI | GitHub Actions: lint, type-check, coverage, PG integration, build + bundle budget, pnpm audit, dependency review, container build + SBOM, e2e |
| Deploy | Docker multi-stage + docker-compose (app, postgres, redis, minio, migrate, outbox worker) |

### Size

- 426 first-party `.ts`/`.tsx` files, ~136k LOC (≈55k excluding `src/generated/prisma`)
- 73 API route files, 30 page routes, 61 test files
- 947-line Prisma schema, 16 migrations, ~50 models

---

## 2. Core user flows identified

These are the flows the audit was organized around:

| # | Flow | Entry points |
| --- | --- | --- |
| F1 | **First-run bootstrap** — operator creates the first owner, `Personal` workspace, `Inbox` canvas | `/setup`, `POST /api/setup/initialize` |
| F2 | **Register → verify email → sign in** | `/auth/register`, `/api/v1/auth/register`, `/auth/verify-email`, `/auth/login` |
| F3 | **Password recovery** | `/auth/forgot-password`, `/auth/reset-password` |
| F4 | **Dashboard → create / open / duplicate / bulk-delete canvases** | `/dashboard`, `/api/v1/canvases` |
| F5 | **Canvas editing** — create/move/resize/edit notes, bookmarks, images, drawings, shapes, arrows, text, frames, embeds; autosave with optimistic version control | `/canvas/[id]`, `/api/v1/canvas-items*` |
| F6 | **Real-time collaboration** — presence, cursors, cursor chat, reactions, committed-event replay | `ws /api/collaboration/:canvasId`, `/api/v1/canvases/:id/events` |
| F7 | **Sharing** — role-based email shares (VIEW/COMMENT/EDIT), invitations, public link | `/api/v1/canvases/:id/share`, `/api/v1/canvases/:id/public`, `/share/[token]` |
| F8 | **Comments** on items | `/api/v1/items/:id/comments` |
| F9 | **Version history / time machine / restore** | `/api/v1/canvases/:id/versions*` |
| F10 | **Uploads** — image upload, quota, private read proxy, lifecycle deletion | `/api/v1/upload`, `/api/v1/uploads/:assetId` |
| F11 | **Search** (global and in-canvas), tag filtering | `/search`, `/api/v1/search` |
| F12 | **Account** — profile, password change, data export, account deletion, API keys | `/settings`, `/api-keys`, `/api/v1/users/*` |
| F13 | **AI assists** — summarize, tags, generate, chat, serendipity | `/api/v1/ai/*` |
| F14 | **Agent control plane** — profiles, BYOK credentials, integrations, MCP, suggestions, change-set rollback | `/api/agent/v1/*`, settings → Agent Control Center |
| F15 | **Operations** — health, ready, metrics, outbox worker, retention, backup/restore | `/api/health`, `/api/ready`, `/api/metrics`, `/api/cron/*`, `scripts/*` |

---

## 3. Audit method

The audit proceeded in this order:

1. **Structure & stack** — `package.json`, `next.config.mjs`, `tsconfig`, `Dockerfile`,
   `docker-compose*.yml`, CI workflows, `prisma/schema.prisma`, `README`,
   `ARCHITECTURE.md`, `implementation/KANBAN.md`.
2. **Trust boundaries first** — `server.ts`, `src/proxy.ts`, `src/middleware/*`
   (CSP, CORS, security headers, rate limit), `src/lib/env.ts`, `src/lib/auth*`,
   `src/lib/api/{auth,route-handler,session-cache}.ts`.
3. **Write paths** — every mutation route was checked for: authentication,
   authorization (ownership *and* share role), Zod validation, transaction
   boundaries, optimistic-concurrency handling, cache invalidation, and audit
   logging.
4. **Read paths** — checked for over-fetching, field-level leakage (`select`
   vs. spread), pagination correctness, and N+1 patterns.
5. **Real-time** — `websocket-server.ts` and `use-collaboration.ts` were read end
   to end for admission control, re-authorization, back-pressure, rate limiting,
   fan-out correctness, and unbounded in-memory maps.
6. **Client state** — TanStack Query mutation lifecycles (`use-canvas-items.ts`),
   Zustand store, canvas hooks — looked for optimistic-update races, invalidation
   storms, stale-snapshot rollbacks, and duplicated sources of truth.
7. **UI/UX** — every page under `src/app`, the shared shell, forms, dialogs,
   empty/loading/error states, responsive behavior, and accessibility affordances.
   Cross-checked what the UI *claims* against what the API *returns*.
8. **Ops & tests** — CI jobs, coverage thresholds, Dockerfile, health/ready/metrics,
   backup/restore docs.

### Verification standard used

Every finding in these files was traced to specific lines of source. Where a
claim depends on a runtime value (a Zod default, a constant, a limit), that
value was looked up rather than assumed. Findings that could not be confirmed
from source alone are explicitly marked **"verify"** rather than asserted.

### Explicitly out of scope

- No code was executed: `pnpm test`, `pnpm build`, `pnpm smoke`, and `pnpm test:e2e`
  were **not run** (the repository's own `DEC-014` records that the unrestricted
  Docker/esbuild verification gate is still pending). No claim in this audit
  rests on a test result.
- No live environment, database, or deployed instance was inspected.
- `src/generated/prisma/**` (generated code) was not reviewed for defects.
- Penetration testing / dynamic scanning was not performed.

---

## 4. Output structure

| File | Contents |
| --- | --- |
| `audit-plan.md` | This document |
| `ui-issues.md` | Interface, UX, accessibility, responsive, state-coverage findings |
| `logical-issues.md` | Correctness, concurrency, async, state, data-integrity, API findings |
| `security-issues.md` | AuthN/AuthZ, data exposure, headers, abuse prevention |
| `performance-issues.md` | Hot paths, query cost, render cost, payload size, scalability |
| `production-readiness.md` | Testing gaps, deployment risks, observability, ops, go/no-go |
| `nice-to-haves.md` | Product completeness, polish, DX, architecture, roadmap |

Severity scale used throughout:

| Severity | Meaning |
| --- | --- |
| **Critical** | Data loss, account takeover, or total outage. Fix before any production traffic. |
| **High** | Users will hit this in normal use, or it exposes data / breaks a core promise. Fix before launch. |
| **Medium** | Real defect with a workaround or limited blast radius. Fix in the first weeks. |
| **Low** | Correctness or quality issue with minor user impact. |
| **Nice-to-have** | Not a defect; improves the product. |

Every finding carries an ID (`UI-nn`, `LOG-nn`, `SEC-nn`, `PERF-nn`, `PROD-nn`,
`NTH-nn`) so it can be referenced from the Kanban or a fix PR.

---

## 5. Headline result

The **backend security posture is unusually strong** for a project of this age:
strict env validation with production invariants, argon2id, session-version
revocation, per-route Zod validation, share-aware authorization helpers,
idempotency keys, a durable outbox, SSRF-protected unfurling, advisory locks
around canvas mutations, CSP nonce propagation, and a genuinely thorough CI
pipeline (SBOM, dependency review, container build, integration tests against
real PostgreSQL).

The **gap is between that backend and the product surface**. The most serious
findings are not missing security controls — they are places where the UI and
the API disagree, where a correct-looking API contract silently drops data, and
where real-time features degrade without telling anyone. Those are listed as
production blockers in `logical-issues.md` and `ui-issues.md`.
