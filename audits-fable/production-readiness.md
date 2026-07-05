# Production Readiness — Consolidated Verdict & Fix Order

**Verdict: NOT production-ready.** Strong foundations, but there are hard blockers that make
a clean deploy non-functional and unsafe for multi-user internet exposure.

This file consolidates findings from `logical-issues.md`, `security-issues.md`,
`performance-issues.md`, `testing-gaps.md`, `deployment-risks.md`, and `ui-issues.md`.
IDs below reference those files (L = logical, S = security, P = performance, T = testing,
D = deployment, U = UI).

---

## Go / No-Go checklist

| Area | Status | Blocking findings |
|---|---|---|
| Database can be provisioned | ❌ No | L-1, D-1 (no migrations, no migrate step) |
| App usable under real traffic | ❌ No | L-2, L-3, S-2 (auth rate limit locks everyone out; limits in-memory/spoofable) |
| Data integrity (multi-user) | ❌ No | L-4 (REST vs Yjs dual write → data loss/resurrection) |
| Realtime safe & private | ❌ No | L-11, S-3 (unvalidated/unauthorized WS, email leak) |
| Sessions revocable | ⚠️ Weak | L-5 (JWT never revalidated) |
| Secrets at rest | ⚠️ Weak | S-5 (credential key falls back to AUTH_SECRET) |
| CORS correct | ⚠️ Weak | S-1 (wildcard/credentials handling) |
| Deploy artifact runs migrations | ❌ No | D-1 |
| Graceful shutdown (no data loss) | ❌ No | L-13 |
| Scheduled jobs / cron run | ❌ No | D-5, L-6 (cron only in unused vercel.json) |
| Backups scheduled & restore-tested | ⚠️ Docs only | D-7 |
| Health reflects real dependencies | ⚠️ Partial | D-6 (no Redis/S3 check) |
| Meaningful automated tests | ⚠️ Shallow | T-1, T-2, T-3 (mocked; DB schemaless in CI) |
| Mobile / touch | ⚠️ Depends | U-4 (canvas mouse-only) |

Legend: ❌ blocker · ⚠️ fix soon / risk-accept with eyes open · ✅ fine.

---

## What's genuinely good (don't regress these)

- Env validation with production-specific `superRefine` rules (`src/lib/env.ts`).
- argon2id password + API-key hashing; account lockout; zxcvbn strength.
- RFC 7807 error contract, API versioning, idempotency-key infrastructure.
- Optimistic concurrency via version + `updateMany` guard on items.
- SSRF-aware unfurling with DNS resolution checks and streaming size caps.
- Nonce-based strict CSP; AES-256-GCM credential encryption (GCM used correctly).
- Ownership/ACL helpers with a clean access hierarchy; soft deletes + audit fields.
- Thorough docs/ADRs and ops runbooks; setup/doctor/smoke scripts.

---

## Recommended fix order (dependency-aware)

### Phase 0 — Make a clean deploy possible (blockers; ~days)
1. **L-1 / D-1** — Baseline and commit Prisma migrations; fold in `fts-migration.sql`; add a container entrypoint (or one-shot service) that runs `prisma migrate deploy` before the server starts, with DB-ready retry. *Nothing else can be validated until this is done.*
2. **L-2 / L-3 / S-2** — Fix rate limiting: scope the strict auth limit to credential-mutating endpoints only (exempt `/api/auth/session|csrf|providers`); back the middleware limiter with Redis; stop keying on a spoofable/constant identifier. Add one middleware test (T-2) so this can't regress.
3. **D-3 / D-4** — Choose the single deployment target (custom Node server). Delete/annotate `vercel.json`; pin Node + pnpm versions across Dockerfile/CI/engines.

### Phase 1 — Data integrity & realtime safety (blockers; ~1–2 weeks)
4. **L-4** — Decide and implement the real-time model (Yjs-authoritative *or* REST-authoritative + WS relay). Remove the losing write path. This also resolves much of P-2/P-5.
5. **L-13** — Add SIGTERM graceful shutdown that flushes all dirty Yjs docs and drains WS connections.
6. **L-11 / S-3** — Zod-validate and authorize all WebSocket frames; enforce COMMENT+ for chat/reactions; remove emails from presence; cap payload size; sanitize any client-rendered strings.
7. **L-5** — Add session revalidation/version bump on password change and account deletion.

### Phase 2 — Security & operational hardening (~1 week)
8. **S-1** — Anchor CORS wildcard matching; refuse to start on credentials+wildcard.
9. **S-5** — Require a dedicated `MODEL_CREDENTIAL_ENCRYPTION_KEY` in production; document rotation.
10. **S-6 / S-7** — Constant-time bootstrap token compare; migrate/expire legacy plaintext API keys.
11. **D-6** — Health/readiness checks for Redis + S3; add Docker healthcheck; split live/ready.
12. **D-5 / L-6 / L-14** — Add a scheduler; fix the bookmark-refresh query (`deletedAt: null`, dedicated timestamp); schedule idempotency-key and token cleanup.
13. **D-7** — Schedule backups (DB + MinIO), off-host copies, and run one restore drill.

### Phase 3 — Correctness & UX polish (~1–2 weeks)
14. **L-7 / L-8 / L-9 / L-15** — Optimistic-update version bump + temp-id guards; cap/guard `listItems` paging; persist+restore viewport once; zod-parse list pagination params.
15. **U-4** — Mobile posture: wire Konva touch/pointer events + `ResizeObserver`, or explicitly gate mobile.
16. **U-12 / U-3 / U-2** — Global 401→login; surface lockout/rate-limit reasons; remove disabled OAuth buttons.
17. **U-1 / U-5 / U-7 / U-8 / U-9 / U-13** — Themed confirm dialogs; dark-mode canvas; finish or hide dead affordances; fix keyboard-while-typing.
18. **P-1 / P-3 / P-4** — Viewport-load items; move thumbnails to object storage and `select` them out of list payloads; break up `CanvasBoard` and memoize.

### Phase 4 — Test & scale confidence (ongoing)
19. **T-1 / T-2 / T-3** — Real-DB integration tests; middleware + collaboration + concurrency + upload-security coverage.
20. **T-5 / T-6 / T-4** — E2E against production build; consolidate e2e trees; coverage thresholds.
21. **T-7 / P-9** — Load/soak test (many WS clients, restart mid-session); explicit pool sizing / PgBouncer.

---

## One-paragraph summary for stakeholders

Memoria is a well-architected, security-conscious codebase that is closer to production than
most, but it cannot ship as-is. Today a fresh deployment comes up with an **empty database**
(no migrations exist and no deploy step creates the schema), and even if seeded, the **auth
rate limiter locks every user out within seconds** because it throttles NextAuth's own
session endpoints on a tiny, shared, spoofable budget. Beneath those, the app runs **two
competing write paths** (REST API and a server-side Yjs document that persists every 30s
without version checks), which will silently lose edits and resurrect deleted items under
normal collaboration, and the WebSocket layer accepts unvalidated, unauthorized messages
while broadcasting users' email addresses. None of these are architectural dead-ends — they
are fixable in a focused few weeks along the phased plan above — but they are firm blockers.
Fix Phase 0 and Phase 1 before any external exposure; treat Phases 2–4 as the path from
"launchable to a trusted pilot" to "production-grade at scale."
