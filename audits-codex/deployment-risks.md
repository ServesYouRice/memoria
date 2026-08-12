# Deployment and Operations Risks

## DEP-01 — The reference Compose stack drops security-critical operator settings

- **Severity:** High
- **Location:** `.env.example:12-34`; `src/lib/env.ts:54-58`; `server.ts:25-29`; `docker-compose.yml:12-48`; `scripts/doctor.mjs:41-47`
- **Description:** The app service does not pass `REGISTRATION_MODE`, `TRUSTED_PROXY_CIDRS`, or `AUTH_RATE_LIMIT_MAX_REQUESTS` from the selected env file. The runtime image contains no `.env`, so these values fall back to open registration, untrusted forwarded addresses, and the default auth limit. Behind the required reverse proxy, all requests can therefore be keyed to the proxy peer address, allowing a handful of attempts to rate-limit every user. The apparent `PORT` override is also internally inconsistent: the app listens on `${PORT}` while Docker, health checks, and the scheduler target container port 3000.
- **Production impact:** Operator choices shown in the template/doctor do not control the running app. Registration can remain open after an operator sets it closed, and authentication rate limiting can become a global denial-of-service lever.
- **Recommended fix:** Pass every supported runtime control explicitly, use a fixed container port plus a separate host-port variable, and validate the rendered Compose configuration. Add an end-to-end proxy test that proves distinct client IP derivation and open/invite/closed registration behavior inside the container.
- **Production blocker:** Yes.
- **Related risks/dependencies:** `SEC-01`, `SEC-03`, `LOG-05`, `TEST-06`.

## DEP-02 — Self-host setup requires HTTPS but supplies no supported ingress path

- **Severity:** High
- **Location:** `scripts/setup.mjs:35-43,178-226`; `docker-compose.yml:47-54`; `README.md:30-64`; `server.ts`
- **Description:** `setup:selfhost` requires an HTTPS public URL, while Compose binds the app only to loopback HTTP. No Caddy/Nginx/Traefik example or runbook explains TLS termination, WebSocket upgrade, trusted proxy CIDRs, forwarded headers, body limits, timeouts, or which operational paths must remain private. Setup then prints the public URL as complete without configuring it.
- **Production impact:** A first-time operator cannot reach the promised public deployment from the provided stack alone and may expose the app with unsafe proxy defaults, broken WebSockets, collapsed rate limits, or public operations endpoints.
- **Recommended fix:** Ship one supported ingress topology (for example Caddy) with TLS, WebSocket upgrade, request-size/time limits, forwarded-header policy, and explicit route exposure. Document alternatives as adaptations, not equally supported paths. Verify the public HTTPS/WSS URL in setup before declaring success.
- **Production blocker:** Yes for the self-host distribution.
- **Related risks/dependencies:** `DEP-01`, `SEC-03`, `TEST-02`.

## DEP-03 — Backup objectives are documented but not scheduled or monitored

- **Severity:** High
- **Location:** `docs/operations/backup-recovery.md:3-29`; `docker-compose.yml:169-190`; backup/check/restore scripts
- **Description:** The runbook targets RPO 1 hour/RTO 4 hours and instructs the operator to run backups hourly plus freshness checks every 15 minutes. The reference stack contains an optional local recovery MinIO but no backup scheduler, freshness alert, off-host target enforcement, or current restore-drill evidence for the release candidate. The default HMAC/recovery credentials also remain template values (`SEC-01`).
- **Production impact:** The documented recovery objective is not an operational property of the deployment. Host loss can remove primary and local backup volumes together, and silent scheduler failure can exceed RPO indefinitely.
- **Recommended fix:** Add an explicit backup job/timer outside the app failure domain, require encrypted/versioned off-host storage, alert on failures and age, rotate the HMAC key, and run a clean isolated restore drill for the exact release. Preserve sanitized counts, hashes, RPO, and RTO as release evidence.
- **Production blocker:** Yes for production data.
- **Related risks/dependencies:** `SEC-01`, `TEST-02`.

## DEP-04 — Background delivery can hang longer than its lease

- **Severity:** High
- **Location:** `src/lib/outbox/worker.ts`; `src/lib/outbox/repository.ts`; email providers; `docker-compose.yml:88-119`
- **Description:** A 20-job batch receives a 60-second lease and runs sequentially. External email calls have no timeout or lease heartbeat. The single reference worker can stall forever or let unstarted jobs become reclaimable.
- **Production impact:** Verification and recovery emails, shares, thumbnails, and upload deletion can stop or duplicate. Queue age metrics exist, but the reference deployment includes no scraper/alert.
- **Recommended fix:** Implement the deadline, per-job lease, heartbeat, idempotency, and alerting changes in `PERF-06`; add graceful shutdown that stops claims and finishes/abandons owned jobs safely.
- **Production blocker:** Yes because email is required in production.
- **Related risks/dependencies:** `PERF-06`, `LOG-03`, `TEST-06`.

## DEP-05 — Liveness is used where dependency readiness is required

- **Severity:** High
- **Location:** `docker-compose.yml:53-59,77-82`; `src/app/api/health/route.ts`; `src/app/api/ready/route.ts`; `scripts/lib/smoke.mjs`
- **Description:** Docker health checks only `/api/health`, which reports process liveness. `/api/ready` checks PostgreSQL, Redis, object storage, and migrations but requires the internal token. The scheduler starts and the container remains “healthy” during dependency failure.
- **Production impact:** Traffic and cron work continue against an instance unable to persist, coordinate, upload, or serve data; orchestration cannot distinguish restartable process failure from dependency unavailability.
- **Recommended fix:** Keep public liveness separate, but make the internal container/orchestrator readiness probe call the authenticated readiness contract without exposing it publicly. Decide which dependency failures remove traffic and which degrade features, and test both startup and runtime transitions.
- **Production blocker:** Yes for a production orchestrated deployment.
- **Related risks/dependencies:** `UI-02`, `SEC-01`, `TEST-02`.

## DEP-06 — Setup neither configures nor proves a deliverable email sender

- **Severity:** High
- **Location:** `.env.example:40-52`; `scripts/setup.mjs:35-54,99-111,199-219`; `src/lib/email/providers/sendgrid.ts:89-94`; `src/lib/email/providers/resend.ts:75-77`
- **Description:** Self-host setup requires a SendGrid/Resend key but retains `EMAIL_FROM=noreply@memoria.local`, does not ask for a verified sender/domain, and does not send a delivery probe. Provider `verify()` methods only check that a key string exists. The final local smoke also cannot authenticate operations unless the token happens to exist in the parent process, because setup does not pass the generated env-file value to `runSmokeChecks`.
- **Production impact:** Setup can fail late or claim a usable stack while registration verification, password recovery, and invitations are undeliverable.
- **Recommended fix:** Require a syntactically valid operator-supplied sender, validate provider identity through an appropriate read-only API where possible, send/capture a controlled setup email, and pass the env-file operations token explicitly to smoke. Do not print “complete” until the test succeeds.
- **Production blocker:** Yes.
- **Related risks/dependencies:** `SEC-01`, `PERF-06`, `TEST-02`.

## DEP-07 — The production image uses a Current Node line while CI primarily uses another runtime

- **Severity:** Medium
- **Location:** `Dockerfile:1,34`; `.github/workflows/ci.yml:13`; `package.json:133`
- **Description:** CI’s Node jobs use 22.14.0, while the image is pinned to Node 26.5.0. On the audit date Node 26 is the Current line and is scheduled to enter LTS in October 2026; Node 24 is the latest LTS line. The image is exact-version pinned but not digest pinned.
- **Production impact:** Runtime-specific regressions can escape non-container jobs, and the production base is not yet on an LTS support line.
- **Recommended fix:** Launch on a tested LTS line (currently Node 24) or explicitly wait for Node 26 LTS and rerun the full gate. Align CI/type definitions with the production runtime and pin published images by digest. See the [official Node release schedule](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule).
- **Production blocker:** No independently, but resolve before long-lived production support.
- **Related risks/dependencies:** `TEST-02`.

## DEP-08 — Observability is not wired into an actionable operating loop

- **Severity:** Medium
- **Location:** `src/app/api/metrics/route.ts`; `sentry.client.config.ts`; `docker-compose.yml`; operations docs
- **Description:** Protected process/outbox metrics and server Sentry hooks exist, but the stack has no scraper, dashboard, or alerts. `NEXT_PUBLIC_SENTRY_DSN` is not supplied at build time, so browser errors are not captured by the documented `SENTRY_DSN` setting. No alert ownership or thresholds are defined for readiness, dead jobs, queue age, backup age, error rate, or resource saturation.
- **Production impact:** Operators may discover failure only through user reports, and client-only failures such as the status/share contract defects remain invisible.
- **Recommended fix:** Provide a minimal Prometheus/Sentry operating profile or a documented external integration, define alert thresholds and owners, pass client DSN safely at build time if opted in, and attach request IDs/release versions to browser and server events.
- **Production blocker:** No after the critical flows have active manual monitoring; strongly recommended before scale.
- **Related risks/dependencies:** `UI-02`, `PERF-06`, `DEP-03`.

## Minimum production deployment checklist

- [ ] All example secrets are regenerated and known placeholders are rejected.
- [ ] Registration mode, trusted proxies, rate-limit settings, and host port are proven inside the running container.
- [ ] HTTPS/WSS ingress is documented and tested; operational endpoints are not publicly routable without authentication.
- [ ] Authenticated readiness controls traffic separately from liveness.
- [ ] Email delivery succeeds from a verified sender and the outbox recovers from provider failure.
- [ ] Hourly off-host backups, freshness alerts, and an isolated restore drill meet measured RPO/RTO.
- [ ] The exact image digest passes migrations, integration, E2E, smoke, dependency, and rollback checks.
