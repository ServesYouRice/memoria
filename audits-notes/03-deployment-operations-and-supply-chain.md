# Deployment, operations, and supply-chain audit

## Critical production blockers

### OPS-01 — The installed runtime dependency graph has critical advisories

**Severity:** Critical  
**Evidence:** live registry audit on 2026-07-12

`pnpm audit --prod --audit-level=moderate` reported **98 production findings: 5 critical, 33 high, 47 moderate, and 13 low**. The full graph reported 127 findings (8 critical).

Confirmed critical production advisories include:

| Package/path | Installed | Confirmed issue | Advisory / patched floor reported by audit |
|---|---:|---|---|
| Next.js | 15.0.3 | React Flight protocol RCE | [GHSA-9qr9-h5gf-34mp](https://github.com/advisories/GHSA-9qr9-h5gf-34mp); at least 15.0.5 for this advisory |
| Next.js | 15.0.3 | Middleware authorization bypass | [GHSA-f82v-jwr5-mffw](https://github.com/advisories/GHSA-f82v-jwr5-mffw); at least 15.2.3 for this advisory |
| jsPDF | 3.0.4 | Local file inclusion/path traversal | [GHSA-f8cm-6447-x5h2](https://github.com/advisories/GHSA-f8cm-6447-x5h2); at least 4.0.0 for this advisory |
| jsPDF | 3.0.4 | HTML injection in new-window paths | [GHSA-wfv2-pwc8-crg5](https://github.com/advisories/GHSA-wfv2-pwc8-crg5); at least 4.2.1 for this advisory |
| AWS SDK → fast-xml-parser | 5.2.5 parser | Entity-name regex injection/bypass | [GHSA-m7jm-9gc2-mpf2](https://github.com/advisories/GHSA-m7jm-9gc2-mpf2); parser at least 5.3.5 |

Other production chains include multiple Next.js DoS findings, DOMPurify bypasses, Undici header/cache issues, markdown-it complexity DoS, and OpenTelemetry baggage memory exhaustion. Development tooling includes a critical Happy DOM VM context escape (`happy-dom` 15.11.7; audit reported patched at 20.0.0).

Do not “fix” only to the minimum version shown for one advisory. Upgrade to a currently supported Next.js line and compatible React/MUI/Sentry stack, update jsPDF and AWS SDK/transitives, then rerun production and full audits. Triage reachability, but treat a clean approved audit as a release gate.

The GitHub workflow never runs `pnpm audit`, even though a local `ci` script contains it (`package.json:33-35`).

### OPS-02 — A clean self-host Docker build has no required build environment

**Severity:** Critical

The Dockerfile runs `pnpm build` at image-build time (`Dockerfile:14`). Compose's `environment:` block applies only to the running container, not `docker build`. Setup generates `.env.selfhost`, while the default build validator reads `.env` unless `MEMORIA_ENV_FILE` is set. No build arg or BuildKit secret mounts the generated file.

On a clean clone, build-time validation therefore has no database/auth/Redis/S3/bootstrap environment and fails. If a developer happens to have `.env`, the absence of `.dockerignore` causes `COPY . .` (`Dockerfile:10`) to copy it and other local artifacts into an image layer, potentially making the build pass while leaking secrets.

**Fix:** create a `.dockerignore`; use a multi-stage build; define non-secret build-time values explicitly; never bake runtime secrets; make build-time module evaluation not require runtime credentials; run a clean-context Docker build in CI.

### OPS-03 — Self-host setup preserves published placeholder secrets

**Severity:** Critical

`prepareEnv` first copies `.env.example`, then treats any non-empty value as an existing secret (`scripts/setup.mjs:28-35`). The template contains `devpassword`, a published auth secret, a published bootstrap token, and MinIO credentials (`.env.example:4-15`, `:56-61`). Random generation is therefore never reached on a fresh setup.

`.env.selfhost` is not covered by `.gitignore`, and there is no `.dockerignore`. The resulting production credentials can be committed and/or baked into the image.

**Fix:** recognize/reject placeholders, always generate secrets for new production installs, use separate templates for development and production, chmod/ACL the generated file, ignore `.env*` with an allowlist for the example, and add secret scanning.

### OPS-04 — Generated remote self-host URLs point to each visitor's localhost

**Severity:** Critical remote-deployment blocker

Setup hardcodes `AUTH_URL/NEXTAUTH_URL` to `http://localhost:3000` and `UPLOADS_PUBLIC_URL` to `http://localhost:9000/...` (`scripts/setup.mjs:36`, `:49-60`). On a VPS/domain deployment, share/reset/verification URLs and uploaded images point to the visitor's own machine. Cookies/callback validation and object URLs are wrong even if the containers are healthy.

Require an external HTTPS application origin and external/proxied object origin during setup; validate them; generate reverse-proxy/TLS guidance; never infer a production URL as localhost.

## High-priority deployment and operations findings

### OPS-05 — Self-host infrastructure wait checks container-only DNS from the host

For self-host mode, generated URLs use hosts `postgres` and `redis` (`scripts/setup.mjs:45-48`). The host-side setup process parses those values and calls `waitForPort` (`:70-76`). Those service names normally resolve only inside the Compose network, so setup can time out even though the published host ports are ready.

Use separate internal runtime URLs and host readiness targets, or run checks inside the Compose network.

### OPS-06 — Compose drops supported production variables

`docker compose --env-file` supplies substitution values; it does not automatically inject every value into the app. The explicit app environment omits at least:

- `MODEL_CREDENTIAL_ENCRYPTION_KEY`
- SendGrid/Resend keys and SMTP fields
- `CRON_SECRET`
- `OPENAI_API_KEY`
- upload scan settings
- Sentry variables
- CORS configuration

Operators can set these in `.env.selfhost` and still find the feature disabled/broken in the container. Maintain a single typed env manifest and pass every supported runtime variable intentionally (prefer secrets mechanisms over plain env files).

### OPS-07 — Migrations are not part of normal app startup/release

The Docker command starts only `scripts/start-server.mjs`; it does not run `prisma migrate deploy`. Setup runs the application before its later migration step, and a subsequent `stack:up --app` does not migrate. Rolling out a new image can serve code against an old schema.

Use an explicit one-shot migration job/release phase that must succeed before app readiness. Do not let every replica race migrations.

### OPS-08 — PID 1 does not forward shutdown signals or flush collaboration state

Docker PID 1 is `scripts/start-server.mjs`, which spawns `node dist/server.mjs` through a generic `run()` helper. `run()` waits for child close but installs no signal forwarding (`scripts/lib/runtime.mjs:98-121`). The server has no centralized HTTP/WebSocket graceful shutdown. `src/lib/db.ts:156-163` independently handles SIGTERM by disconnecting Prisma and immediately calling `process.exit(0)`. `flushDocument`/`closeDocument` have no callers.

Container shutdown can therefore discard up to the 30-second Yjs persistence interval, terminate active responses/sockets, and bypass orderly Redis/DB cleanup.

Make the actual server process PID 1 or forward signals; stop accepting traffic; close HTTP/WebSockets; flush Yjs documents; close Redis; disconnect Prisma; enforce a bounded timeout; test SIGTERM.

### OPS-09 — Reference services are exposed with weak/default authentication

Compose publishes Postgres 5432, unauthenticated Redis 6379, and MinIO 9000/9001 to all host interfaces (`docker-compose.yml:40-82`) while setup preserves weak published defaults. This materially expands exposure on a typical VPS.

Bind private services to the Compose network or `127.0.0.1`, require Redis auth/TLS where applicable, generate all credentials, firewall the host, and expose object storage only through the intended HTTPS proxy.

### OPS-10 — Doctor command exfiltrates credentials into logs

The recommended diagnostic records raw `DATABASE_URL`, `AUTH_URL`, and `AUTH_SECRET` (`scripts/doctor.mjs:34`, `:72`) and prints `result.detail` in JSON/human output (`:137-142`). Database/Redis URLs can also contain passwords.

Redact secrets and URL userinfo/query components at collection time; never place a raw secret in the result structure.

### OPS-11 — Recovery email is nonfunctional in the reference production stack

Setup forces `EMAIL_PROVIDER=console`; Compose omits production provider credentials. Password reset and verification appear successful but only print token-bearing email content to container logs. This is both an availability and security blocker (see `SEC-19`).

Require and verify a real provider before readiness, or explicitly disable account flows that depend on email.

### OPS-12 — No scheduler is supplied for the cron endpoint

The bookmark refresh route requires `CRON_SECRET`, but the example/setup/Compose path neither provisions that secret nor schedules the call. The feature is dead by default. There is likewise no durable agent-job worker despite `AgentJob` schema support.

Ship a scheduler/worker service with health and retries, or remove the operational claim until one exists.

### OPS-13 — Health and metrics can report false confidence

Health checks only Postgres and V8 heap (`src/app/api/health/route.ts:45-99`), with no timeout and no Redis, object storage, migrations, email, collaboration bus, or worker check. Compose defines no app healthcheck.

Metrics expose real process data but hardcode application counters/duration to zero (`src/app/api/metrics/route.ts:58-71`) under stale `canvascollect_*` names. WebSocket/document count helpers are never exported. A green dashboard can coexist with broken collaboration, uploads, email, and migrations.

Separate liveness/readiness, add bounded dependency probes, instrument real request/operation/socket/job metrics, and protect or network-restrict operational endpoints.

### OPS-14 — No backup/restore or retention workflow

The stack uses named volumes for Postgres/Redis/MinIO but contains no scheduled database dump, object backup, restore drill, retention policy, or migration rollback/runbook. Redis append-only data is not a backup. Private user content and upload objects can be lost independently.

Document RPO/RTO, automate encrypted off-host Postgres and object backups, test restore, and include schema/version compatibility.

## Additional operational findings

| ID | Severity | Finding | Evidence / action |
|---|---|---|---|
| OPS-15 | High | Environment validation has two divergent schemas and makes optional example keys mandatory whenever an env file exists. | `scripts/validate-env.mjs` and `src/lib/env.ts` differ. `dotenv-safe` runs before Zod and rejects absent optional keys. The supported build and Playwright web server both failed this way. Generate one schema/template and validate conditional requirements only. |
| OPS-16 | Medium | Production build depends on live Google Fonts. | `next/font` fetched Inter during build and failed under restricted network. Self-host the font asset for hermetic/offline builds. |
| OPS-17 | Medium | Reference Postgres image cannot satisfy the mandatory pgvector doctor check. | Compose uses `postgres:16-alpine`; doctor always executes `vector-check.mjs`, which requires the `vector` extension. Use a pgvector image/migration or make the check match actual feature use (embeddings are currently JSON). |
| OPS-18 | Medium | Prisma full-text preview configuration is stale. | `prisma validate` warns that `fullTextSearch` was renamed and `fullTextIndex` is deprecated. Remove/update preview flags and test generated client behavior. |
| OPS-19 | High | Docker image is single-stage, root, and contains build tooling/source/dev dependencies. | `Dockerfile:1-18` has no non-root user, production dependency prune, or runtime-only copy. Use pinned digest, multi-stage build, `pnpm deploy`/prod prune, and a non-root read-only runtime. |
| OPS-20 | Medium | Docker build context is uncontrolled. | No `.dockerignore`; local `.env`, `.git`, `.next`, `dist`, coverage, Playwright reports, pnpm store, and platform-specific `node_modules` may enter context/layers. Add a strict allowlist-style ignore file. |
| OPS-21 | Medium | New migrations are globally ignored. | `.gitignore:43` ignores `prisma/migrations`. Existing migrations are tracked only because they were force-added; future migrations can be silently omitted. Remove the rule and add a CI schema-diff/migration check. |
| OPS-22 | Low | A binary pnpm-store index is committed. | `.pnpm-store/v11/index.db` is tracked. Remove it from version control and ignore the store. |
| OPS-23 | Medium | Runtime/toolchain versions drift. | Docker uses Node 22, GitHub CI uses Node 20, local is Node 22, `packageManager` pins pnpm 8.15 while workflow declares pnpm 9. Test and pin one supported matrix. |
| OPS-24 | Medium | Sentry/OpenTelemetry build warning is ignored. | Successful Next build reports a dynamic `require` critical-dependency warning through Sentry's OpenTelemetry chain. Verify runtime instrumentation and source maps; upgrade/adjust bundling rather than normalizing the warning. |
| OPS-25 | Medium | Setup mutates infrastructure before validating external deployment choices. | It creates files/containers before obtaining a production domain, email provider, backup, TLS, or exposure policy. Make setup collect/validate configuration first and print a redacted plan. |
| OPS-26 | Medium | Public cache/upload names still use the old CanvasCollect brand. | Service worker, metrics, database/container names, and User-Agent strings mix CanvasCollect and Memoria. This complicates monitoring, cache invalidation, support, and migrations. Standardize names with explicit compatibility handling. |
| OPS-27 | Medium | `pnpm run check-bundle` is a false gate. | It searches Pages Router paths with `/` separators, misclassifies App Router/Windows artifacts, budgets no `OTHER` files, and exits 0 on analysis errors. It reported 1.6 MB as unbudgeted and “all within budget.” Parse Next manifests and fail closed. |
| OPS-28 | Medium | Bundle checking is not part of `pnpm build` or GitHub CI. | `scripts/build.mjs` runs env validation, Next build, and server build only. Add a corrected budget check to the release workflow. |

## Verified build behavior

- Application TypeScript/lint and Prisma schema validation pass.
- A direct production Next build passes when audit-only required variables are supplied and env-file loading is skipped.
- The supported `pnpm run build` fails with the present/documented env-file contract.
- The custom server bundles successfully to 37.2 KB when esbuild can access its binary.
- These results mean the application is compilable, but the documented local/self-host production workflow is not currently reproducible or safe.
