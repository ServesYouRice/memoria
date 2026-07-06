# Deployment & Infrastructure Risks

Severity: Critical / High / Medium / Low. "Blocker" = should not launch without fixing.

---

## D-1. Docker image builds but the container never runs migrations

- **Severity:** Critical
- **Location:** `Dockerfile`, `docker-compose.yml` (app service), README (`setup:selfhost` runs migrations, but plain `docker compose up` doesn't)
- **Problem:** `Dockerfile` runs `db:generate && build`, then `CMD node scripts/start-server.mjs` — it never runs `prisma migrate deploy`. `docker-compose.yml`'s app service likewise starts the server directly. So `docker compose up` against a fresh Postgres starts a server pointed at an **empty schema** (compounded by L-1: there are no migrations to run anyway). First request 500s.
- **Fix:** Add an entrypoint that runs `prisma migrate deploy` (with retry until DB ready) before `start-server`, or a one-shot `migrate` service that the app `depends_on`. Requires L-1 fixed first.
- **Blocker:** **Yes.**

## D-2. `Dockerfile` uses `pnpm` before enabling it reliably and won't produce a slim image

- **Severity:** Medium
- **Location:** `Dockerfile`
- **Problem:** `RUN corepack enable` then `pnpm install` — corepack may prompt/needs the pinned version (`packageManager: pnpm@8.15.0`) which isn't activated; CI uses pnpm 9 while the repo pins 8.15.0 and `engines` says `>=8` (version drift, see D-4). The image is a single stage: dev dependencies, source, and `.next` cache all ship in the final image (large, larger attack surface). No `.dockerignore` was found, so `.env`, `.git`, `node_modules`, and local `public/uploads` may be copied into the build context/image.
- **Fix:** Multi-stage build (builder → runner with only `.next/standalone` or the compiled server + prod deps); pin corepack to the packageManager version; add a `.dockerignore`.
- **Blocker:** No (but the missing `.dockerignore` can leak secrets — verify).

## D-3. Two conflicting deployment stories; `vercel.json` targets a model the app can't use

- **Severity:** Medium
- **Location:** `vercel.json` (functions + cron), README ("serverless-first is a non-goal", custom server is primary), `server.ts`
- **Problem:** `vercel.json` configures serverless functions (`maxDuration: 30`) and the bookmark cron. But the app **requires** a stateful custom Node server (`server.ts`) for WebSockets and in-memory Yjs docs — it cannot run on Vercel serverless. So the cron (the only trigger for `refresh-bookmarks`, L-6) is defined for a platform the app won't deploy to, i.e., **the cron never fires** on the self-host target. Leaving `vercel.json` invites someone to deploy to Vercel and get a broken (no-WS, ephemeral-memory) instance.
- **Fix:** Delete `vercel.json` (or clearly mark it unsupported) and provide a real scheduler for the cron in the compose stack.
- **Blocker:** No, but decide the single deployment target before launch.

## D-4. Node/pnpm version drift across configs

- **Severity:** Medium
- **Location:** `Dockerfile` (`node:22-alpine`), CI (`NODE_VERSION: 20`, Node 20), `package.json` engines (`node >=20`, `pnpm >=8`, `packageManager: pnpm@8.15.0`), CI `PNPM_VERSION: 9`
- **Problem:** The image builds on Node 22 + whatever pnpm corepack picks, CI builds on Node 20 + pnpm 9, the repo pins pnpm 8.15.0. "Works in CI" ≠ "works in the image". Native deps (`argon2`) are especially sensitive to Node major versions.
- **Fix:** Pin one Node major and one pnpm version everywhere (engines, CI, Dockerfile, corepack).
- **Blocker:** No, but a classic "works on my machine" source.

## D-5. No scheduler in the self-host stack (cron, idempotency cleanup, bookmark refresh all unscheduled)

- **Severity:** Medium
- **Location:** `docker-compose.yml` (no cron/scheduler service), `IdempotencyKey` cleanup comment (L-14), `refresh-bookmarks` route (L-6)
- **Problem:** Several time-based jobs are implemented as HTTP routes but nothing invokes them in the primary deployment: bookmark refresh, idempotency-key cleanup, (potential) session/token expiry cleanup. `PasswordResetToken`/`EmailVerificationToken` rows also accumulate with no purge.
- **Fix:** Add a scheduler (compose sidecar hitting the cron routes with `CRON_SECRET`, systemd timers, or in-process `setInterval` in `server.ts`), and add cleanup jobs for expired tokens + idempotency keys.
- **Blocker:** No.

## D-6. Health endpoint checks DB + memory but not Redis / storage; no readiness vs liveness split

- **Severity:** Low-Medium
- **Location:** `src/app/api/health/route.ts`
- **Problem:** Production *requires* Redis and S3, but `/api/health` only checks Postgres and process memory. An instance with a dead Redis (rate limiting, collaboration fan-out) or unreachable S3 (uploads) reports healthy and stays in the load-balancer rotation. There's no separate readiness probe (don't route traffic until migrations applied + deps reachable) vs liveness (restart if event loop dead).
- **Fix:** Add Redis + S3 checks; expose `/health/ready` (deps + migration status) and `/health/live`; wire Docker `healthcheck` for the app service (currently absent).
- **Blocker:** No.

## D-7. Backups: scripts exist but nothing schedules or verifies them

- **Severity:** Medium
- **Location:** `scripts/backup-database.sh`, `scripts/restore-database.sh`, `docs/operations/*` (DATABASE_BACKUP_POLICY, RESTORE_PROCEDURES, BACKUP_SCHEDULE_REFERENCE)
- **Problem:** Backup/restore scripts and policy docs exist, which is excellent, but there's no scheduled backup in the stack, no off-host copy, no restore drill, and object storage (MinIO volume) has no backup story. Policy without automation is not a backup.
- **Fix:** Schedule backups (D-5 scheduler), ship them off-host, back up MinIO, and do one documented restore drill before launch.
- **Blocker:** No, but "no verified restore" is a real operational risk.

## D-8. Sentry configured but source maps / release wiring unverified; PII in events

- **Severity:** Low
- **Location:** `sentry.*.config.ts`, `instrumentation.ts`, env `SENTRY_DSN`/`SENTRY_AUTH_TOKEN`
- **Problem:** Sentry is wired for client/server/edge, but with the WS layer sending emails (L-11/S-3) and request logging including full URLs (`next.config.mjs:27-31` `fullUrl: true`) and user agents (`middleware.ts`), error/breadcrumb payloads may capture PII. Confirm `beforeSend` scrubbing and that releases + source maps upload in the build.
- **Fix:** Add PII scrubbing to `beforeSend`; verify source-map upload in the Docker build; set `tracesSampleRate` deliberately.
- **Blocker:** No.

## D-9. Secrets management for self-host is manual and easy to get wrong

- **Severity:** Low-Medium
- **Location:** `.env.example`, `docker-compose.yml`, `scripts/setup.mjs`
- **Problem:** Compose reads secrets from the host env with weak defaults for storage/DB (S-11). No secrets vault integration; `AUTH_SECRET` rotation breaks credential decryption (S-5). Published ports expose Postgres/Redis/MinIO to the host network by default.
- **Fix:** Document a hardening checklist; remove default exposure of data-store ports; provide `.env.selfhost` generation that fills every required secret; separate the credential-encryption key.
- **Blocker:** No.

---

## Deployment summary

The **one true blocker here is D-1/L-1**: with no migrations and no migrate step in the container, a clean deploy produces a non-functional instance. After that, the biggest risks are the **conflicting Vercel-vs-custom-server story (D-3)**, **version drift (D-4)**, **no scheduler for cron/cleanup/backups (D-5, D-7)**, and **health checks that ignore the required Redis/S3 dependencies (D-6)**. The operational docs and scripts are strong; the gap is automation and wiring, not knowledge.
