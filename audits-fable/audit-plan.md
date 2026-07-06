# Memoria — Production Readiness Audit Plan

**Date:** 2026-07-04
**Auditor:** Claude (production-readiness audit, read-only — no production code was modified)
**Scope:** Full repository at commit `4e5260a` on branch `claude/production-readiness-audit-2xn5bt`

---

## 1. What this project is

Memoria is a self-hostable visual note-organization app: a free-form Konva canvas holding
notes, bookmarks, images, drawings, shapes, polls, etc., with versioning, templates,
sharing, comments, real-time collaboration (Yjs over a custom WebSocket server), an AI
layer (OpenAI + BYOK model credentials), and an agent/control-plane API (`/api/agent/v1/*`, MCP).

## 2. Stack inventory (verified from code)

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 15.0.3 (App Router) + React 19 | Custom Node server (`server.ts`) hosting Next + WebSocket |
| Language | TypeScript 5, strict-ish | `type-check` in CI |
| UI | MUI 6 + Emotion (CSP nonce), sonner toasts, cmdk | Design tokens in `src/lib/theme.ts` |
| Canvas | Konva / react-konva, @use-gesture | SSR-disabled dynamic import |
| Server state | TanStack Query 5 | Optimistic updates + polling |
| Client state | Zustand 5 (`src/stores/canvasStore.ts`) | Persisted tool prefs |
| Realtime | Yjs 13 + `ws` + Redis pub/sub fan-out | `src/lib/collaboration/*` |
| DB | PostgreSQL via Prisma 6 | **No migrations exist** (see blockers) |
| Cache / RL | Redis (ioredis) — required in production | Middleware rate limiting is in-memory anyway |
| Auth | NextAuth v5 beta.25, credentials + JWT sessions, argon2 | Account lockout, password strength (zxcvbn) |
| Storage | S3-compatible (MinIO reference), local dev fallback | Upload quota via S3 listing |
| Email | console / SendGrid / Resend providers | SMTP intentionally disabled |
| AI | `openai` SDK (gpt-4o-mini), BYOK credentials (AES-256-GCM) | Simulated responses without key |
| Observability | pino, Sentry (client/server/edge), health endpoint | Vercel Analytics in layout |
| Testing | Vitest + happy-dom, Playwright, Percy config | Two e2e trees, one orphaned |
| Deploy | Docker Compose (app+postgres+redis+minio), leftover `vercel.json` | Custom server ⇒ Vercel not viable |

## 3. Core user flows identified

1. **Bootstrap / setup** — `/setup` + `POST /api/setup/initialize` (bootstrap token) → first owner, "Personal" workspace, "Inbox" canvas.
2. **Auth** — register → (optional) verify email → login (credentials) → JWT session; forgot/reset password; account lockout.
3. **Dashboard** — list canvases, activity feed, create/duplicate/delete canvas, workspaces, templates.
4. **Canvas editing** — create/move/resize/edit items, drawing, tags, search-in-canvas, undo/redo, alignment, version history / time machine, export, thumbnails.
5. **Sharing & collaboration** — email-based shares (VIEW/COMMENT/EDIT), public share token page `/share/[token]`, live presence/cursors/chat/reactions over WebSocket.
6. **Search** — global search page + command palette.
7. **API keys & extension clip** — personal API keys (`mk_`), `/api/v1/extensions/clip`.
8. **Agent surface** — agent profiles, integration tokens (`mat_`), agent canvas/item/knowledge/action routes, MCP transport, control center in settings.
9. **Ops** — setup scripts, doctor/smoke, backups scripts, health endpoint, cron bookmark refresh.

## 4. Audit method

1. Read all infrastructure entry points end-to-end: `server.ts`, `src/middleware.ts` + `src/middleware/*`, env validation, Prisma client, Redis clients.
2. Read the realtime stack completely (`websocket-server.ts`, `yjs-provider.ts`, `use-collaboration.ts`) — highest-risk stateful code.
3. Read auth end-to-end: NextAuth config, session cache, canvas ACL helpers, API-key auth, agent/integration token auth, bootstrap route.
4. Read representative + high-risk API routes: canvases, canvas-items (list/item), upload, share token, cron, AI, setup.
5. Read the frontend spine: layout/providers, AppShell, CanvasBoard + data/interaction hooks, TanStack mutation hooks, canvas store, auth forms, dashboard/notifications pages.
6. Read schema, CI workflow, Docker/compose, Playwright/Vitest configs, scripts.
7. Cross-check claims in README/ARCHITECTURE/docs against actual code.

Severity rubric: **Critical** = will break or compromise production for real users; **High** = serious correctness/security/perf risk under normal load; **Medium** = degrades quality or is fragile; **Low** = polish; **Nice-to-have** = product completeness.

## 5. Deliverables in this folder

| File | Contents |
|---|---|
| `audit-plan.md` | This plan + stack + flows |
| `ui-issues.md` | UI/UX findings + prioritized fix list |
| `logical-issues.md` | Logic/data/async findings + **Production Blockers** section |
| `security-issues.md` | Security-specific findings |
| `performance-issues.md` | Performance findings |
| `testing-gaps.md` | Test and CI coverage gaps |
| `deployment-risks.md` | Docker/CI/infra/deploy findings |
| `production-readiness.md` | Consolidated go/no-go checklist + recommended fix order |
| `nice-to-haves.md` | Product-completeness recommendations |

## 6. Top-line conclusion (details in the files)

The codebase is far more mature than a typical side project — env validation, RFC 7807
errors, idempotency keys, optimistic concurrency, SSRF protection, argon2, CSP nonces,
audit-ish models all exist. But it is **not production-ready today**. Five findings are
hard blockers, led by: **no Prisma migrations exist**, and the **auth rate limiter (5
requests / 15 min on all of `/api/auth/*`, keyed by an often-absent header) will lock
every real user out of session checks**. See `production-readiness.md` for the ordered
fix plan.
