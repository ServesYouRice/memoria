# Memoria — Production Readiness Audit Plan

**Audit date:** 2026-07-18
**Branch:** `claude/production-readiness-audit-319ece`
**Scope:** Full-stack audit (UI/UX, application logic, security, performance, testing, deployment). Audit only — no production code was modified.

---

## 1. Stack Identification

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16.2 (App Router) + custom Node server (`server.ts`) | Stateful runtime; WebSocket upgrades handled in-process |
| Language | TypeScript (strict; `tsc --noEmit` in CI) | ~322 source files, ~49k LOC in `src/` |
| UI | React 19, Material UI 6, Emotion, Konva/react-konva (infinite canvas), TipTap, sonner (toasts) | |
| State | TanStack Query (server state), Zustand (`canvasStore`, ephemeral UI state) | |
| Backend | Next.js route handlers under `/api/v1/*` and `/api/agent/v1/*` | RFC 7807 problem JSON, idempotency keys, API version headers |
| DB | PostgreSQL via Prisma 6.19 (7 migrations, pgvector checked by `doctor`) | Optimistic concurrency (`version`) on canvas items; soft deletes |
| Cache/shared state | Redis via ioredis (rate limits, canvas cache, unfurl cache, lockout, collab pub/sub, upload quota locks) | Required in production; memory fallback in dev |
| Auth | Auth.js / NextAuth v5 beta (pinned `5.0.0-beta.31`), credentials + Argon2id, JWT sessions with `sessionVersion` revocation | Email verification, reset tokens, account lockout |
| Realtime | Custom `ws` server for presence/cursors/chat/reactions; Redis pub/sub fanout; Yjs writes intentionally disabled | Item writes go through validated HTTP only |
| Storage | S3-compatible (MinIO reference); local disk dev-only; private read proxy at `/api/v1/uploads/[assetId]` | |
| AI | OpenAI SDK; BYOK model credentials (encrypted); agent control plane + MCP transport at `/api/agent/v1/mcp` | |
| Email | SendGrid/Resend (prod), console (dev); SMTP disabled in this build | |
| Observability | Pino structured logging w/ request IDs, Sentry (client/edge/server), `/api/health`, `/api/metrics` (Prometheus), CSP reports | |
| Deployment | Docker Compose (app + postgres + redis + minio + scheduler), multi-stage Dockerfile, non-root user | `vercel.json` is legacy; self-host/VPS is the stated target |
| CI | GitHub Actions: lint, type-check, unit tests + coverage, prod dependency audit + licenses, dependency review, clean container build + SBOM, e2e with real Postgres/Redis/MinIO services | Husky + lint-staged locally |

## 2. Core User Flows (identified)

1. **Bootstrap (self-host first run):** `/setup` → `POST /api/setup/initialize` with `APP_BOOTSTRAP_TOKEN` → first owner user + "Personal" workspace + "Inbox" canvas.
2. **Auth:** register → email verification → login (lockout after 5 failures) → JWT session with `sessionVersion` revocation; forgot/reset password; change password (rotates session version).
3. **Canvas work:** dashboard → create/open canvas → create/edit/move/resize notes, bookmarks (unfurl), images (upload), drawings, shapes, polls → autosave with optimistic versioning → undo/redo → search/tags → versions (snapshot + restore) → trash → export (PDF/jspdf).
4. **Sharing & collaboration:** email-based shares (VIEW/COMMENT/EDIT), public share links (`/share/[token]`), live presence/cursors/chat/reactions via WebSocket, comments on items.
5. **Templates & workspaces:** template listing/use, workspace grouping.
6. **Agent flows (owner-managed):** agent profiles, BYOK credentials, integration tokens, MCP tools, suggestions → approval → execution → change-set rollback; read-only organizer view.
7. **Operations:** doctor/smoke scripts, backup/restore scripts, `/api/health`, `/api/metrics`, scheduler container for bookmark refresh.

## 3. Audit Method

1. Read all project documentation (`README.md`, `ARCHITECTURE.md`, `REMAINING-WORK.md`) and mapped the route tree (24 pages, ~60 API route groups).
2. Deep-read the trust boundary: `src/proxy.ts`, rate limiting, CORS, CSP, security headers, env validation, `server.ts`.
3. Deep-read auth: NextAuth config, lockout, change-password, registration, bootstrap, API keys.
4. Deep-read data access & authorization helpers (`src/lib/api/auth.ts`, route-handler/idempotency), sharing (email + public token), upload write/read paths, SSRF-protected unfurl, cron route + scheduler.
5. Deep-read the collaboration WebSocket server end-to-end (upgrade auth, revalidation lease, message handling, Redis fanout).
6. Reviewed the client data layer (`use-canvas-items`, polling) and key UI surfaces (CanvasBoard structure, ImageItem, login/register forms, dashboard, stub pages, error/loading boundaries).
7. Reviewed tests (`tests/`, `src/__tests__`), CI workflow, Dockerfile/Compose, and operational scripts.
8. Cross-checked findings against `REMAINING-WORK.md` to avoid re-reporting known items without adding value; where a known item is still a launch risk it is referenced by its existing ID.

## 4. Deliverables

| File | Contents |
|---|---|
| `ui-issues.md` | UI/UX findings + Recommended UI Priorities Before Production |
| `logical-issues.md` | Logic/data/async findings + Production Blockers section |
| `nice-to-haves.md` | Product/DX/architecture improvements, categorized |
| `security-issues.md` | Security-specific findings |
| `performance-issues.md` | Performance-specific findings |
| `production-readiness.md` | Go/no-go summary, launch checklist, fix order |
| `testing-gaps.md` | Test coverage gaps and recommended additions |

Severity scale: **Critical** (breaks core functionality or exposes data), **High** (must fix before or immediately at launch), **Medium** (fix soon after launch), **Low** (cosmetic/minor), **Nice-to-have**.

## 5. Overall Assessment (summary)

The codebase is unusually mature for a pre-1.0 product: strict env validation with production invariants, RFC 7807 errors, idempotency keys, optimistic concurrency, SSRF-protected fetching, Argon2id + lockout + session versioning, nonce CSP, structured logs, SBOM in CI. Most remaining risk is concentrated in:

1. **One critical routing/rate-limit collision** that breaks image loading on real canvases (see `logical-issues.md` L-1).
2. **Proxy/IP trust assumptions** that collapse all abuse controls behind any reverse proxy (see `security-issues.md` S-1).
3. **A production-only auth UX trap** around email verification (see `ui-issues.md` UI-1).
4. Known, documented scalability ceilings for large canvases (`REMAINING-WORK.md` PERF items).
