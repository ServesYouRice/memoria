# Production Readiness — Go/No-Go Summary

**Verdict: NOT YET — but close.** Memoria has a genuinely strong engineering baseline. The gap between "impressive prototype" and "safe to launch" is a small number of concrete defects, most of them cheap to fix. This document is the consolidated launch checklist and recommended fix order across all audit files.

---

## 1. Overall assessment

**Strengths (verified):**
- Strict env validation with production invariants (Redis, S3, bootstrap token, distinct encryption key, email provider) — `src/lib/env.ts`.
- Argon2id for passwords *and* API keys; dummy-hash verification defeats user-enumeration timing; account lockout; `sessionVersion` revocation across HTTP and WebSocket.
- Nonce-based strict CSP with `strict-dynamic`, thorough security headers, CORS defaults to same-origin.
- SSRF-protected external fetching with DNS/IP checks, used for both unfurl and the bookmark cron.
- RFC 7807 problem responses, idempotency keys, optimistic concurrency (`version`), soft deletes, audit models.
- Realtime writes deliberately kept off the untrusted Yjs path — REST is the single write authority.
- Mature ops surface: `doctor`, `smoke`, health/metrics endpoints, Sentry, structured logs, backup/restore scripts, SBOM in CI, non-root container.

**The launch is gated by a handful of issues, not by systemic immaturity.**

## 2. Blocker register (must fix or explicitly risk-accept)

| ID | Blocker | Severity | Effort | File |
|---|---|---|---|---|
| L-1 / P-1 | Image **reads** throttled to 10/hour/IP (prefix collision) + silent client failure | Critical | XS (matcher) | logical, performance, ui |
| S-1 | All abuse controls trust raw socket IP → collapse behind any reverse proxy (the default topology) | High | M | security |
| UI-1 / L-11 | Register → verify → login funnel broken in production only; wrong error message, no resend path | High | S | ui, logical |
| S-2 | Open self-registration on internet-reachable self-host, no off switch | High | S | security |
| S-3 / L-3 | Email-only account lockout = targeted-lockout DoS; lockout fails open on Redis error | Med-High | S-M | security, logical |
| S-12 | Outbound webhook delivery not atomic (tracked SEC-12) | High | M | security |
| P-11 | Rate-limit store opens a second Redis connection (verified working, but fragile seam) | Low | S | performance |

**Minimum bar to launch:** L-1, UI-1, S-1, S-2 fixed; S-3 mitigated; S-12 fixed **or** agent external actions feature-gated off for v1.

## 3. Recommended fix order

**Phase 0 — one focused day (unblocks the worst, cheapest wins):**
1. L-1: exact-match the upload write path in `src/proxy.ts`; give `/api/v1/uploads/` its own read limit. Add the `ImageItem` error placeholder (UI-2).
2. UI-1/L-11: typed `email_not_verified` error + resend path; post-register "check your inbox" screen; surface email-send failure.
3. S-2: `REGISTRATION_MODE` env + register-route gate + hide register UI.

**Phase 1 — the trust-boundary week:**
4. S-1: trusted-proxy config in `server.ts`; key user-scoped endpoints by user ID; `doctor` warning. Then P-2 (stream + cache image reads) and UI-7 (client 429 handling) become effective.
5. S-3 + L-3: lockout keyed by email+IP with escalating delay + owner notification; fail closed on Redis error.
6. S-12: transactional outbox + retry worker, **or** feature-gate agent external actions for v1.

**Phase 2 — before scaling / marketing collaboration:**
7. P-3/L-4: cache `sessionVersion` (removes top per-request query).
8. P-4: delta polling for item sync.
9. S-4/S-5: realtime permission gate + connection budgets; S-6 token rotation; S-7 HSTS.
10. Testing: T-3 (proxy routing matrix), T-2 (production-mode auth e2e), T-1 (DB-backed destructive-flow integration), T-7 (boot the container in CI).

**Phase 3 — product completeness (see nice-to-haves.md):**
11. Share invitation lifecycle (PRODUCT-01), notifications, usage visibility, accessible canvas model (UX-03/06), the tracked PERF program.

## 4. Deployment risks (self-host target)

- **Reverse-proxy IP blindness (S-1)** — the dominant operational risk; the reference deployment terminates TLS somewhere.
- **`CRON_SECRET` unset** → scheduler container throws on boot (`scripts/scheduler.mjs:5-6`); `setup.mjs` generates it, but a hand-rolled `.env` will crash-loop the scheduler. Add to `doctor`.
- **`vercel.json` present** invites a serverless deploy where the WebSocket server and stateful assumptions silently break. Remove or clearly mark legacy.
- **Local-upload rejection in prod** is correctly enforced (`upload/route.ts`), good — but the S3 misconfiguration error is a 500, not a startup failure; `doctor`/`smoke` cover it, so ensure they run in the deploy pipeline.
- **Backup/restore never drilled** against a real target (tracked OPS-14) — do one timestamped drill before storing real user data.
- **Container built but never booted in CI** (T-7) — runtime-only regressions ship unseen.

## 5. Launch checklist (condensed)

- [ ] L-1 image-read limiter fix + placeholder
- [ ] UI-1 verification funnel + resend
- [ ] S-2 registration gating
- [ ] S-1 proxy-aware client IP + per-user keys
- [ ] S-3/L-3 lockout mitigation + fail-closed
- [ ] S-12 webhook outbox or feature-gate
- [ ] P-2 stream + cache image reads
- [ ] T-3 proxy routing tests; T-2 prod-mode auth e2e; T-7 container boot in CI
- [ ] One backup/restore drill (OPS-14)
- [ ] `doctor` warnings for proxy-trust, `CRON_SECRET`, CORS+credentials
- [ ] Remove/relabel `vercel.json`; delete dead `endpoint-limits.ts`
- [ ] Decide trash retention policy + label it
- [ ] Confirm HSTS at app or proxy (S-7)

## 6. What is explicitly NOT blocking

Large-canvas scalability (PERF-01…26), full canvas accessibility (UX-03/06), 2FA, share invitations, admin panel, import flows. These are real and tracked, but a scoped v1 (bounded canvas sizes, B2C or trusted-team audience, agent external actions gated off) can launch without them **once the Phase 0–1 blockers are cleared.**
