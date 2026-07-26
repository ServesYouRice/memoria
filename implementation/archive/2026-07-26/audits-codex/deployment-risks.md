# Deployment, Recovery, and Operations Risks

## Findings

### DEP-01 — Database backups are restored without dependable checksum or SQL-failure enforcement

- **Severity:** High
- **Location:** Database backup and restore scripts
- **Description:** Backup metadata records a checksum but the corresponding `.sha256` artifact is not uploaded. Restore looks for a checksum beside a newly named local backup, does not find it, warns, and continues. The `psql` restore invocation does not enforce `ON_ERROR_STOP`.
- **Why it matters for production:** Corrupt, truncated, or tampered backups can be accepted, and SQL errors can produce a partial database while the script appears successful.
- **Recommended fix:** Upload a checksum/manifest atomically with each backup, sign or authenticate it, verify before decompression, run `psql --set ON_ERROR_STOP=on` in a clean target, and fail on any warning/integrity mismatch. Add manifest versioning and retention tests.
- **Blocker before production:** Yes.
- **Related risks or dependencies:** Prove the corrected path with a full restore drill (`TEST-09`).

### DEP-02 — Disaster recovery omits uploaded object data

- **Severity:** High
- **Location:** Backup scope, S3/MinIO upload storage, restore runbook
- **Description:** The documented/scripts backup path covers PostgreSQL but not uploaded image objects. Local Compose stores MinIO data in a volume without a matching verified backup/restore workflow.
- **Why it matters for production:** Restoring the database alone recreates asset rows/URLs that point to missing images, so canvases remain materially incomplete.
- **Recommended fix:** Include versioned object-storage replication or inventory-based backup in the recovery design, use immutability/retention where appropriate, record database/object consistency markers, and verify representative object hashes after restore.
- **Blocker before production:** Yes if uploads are enabled.
- **Related risks or dependencies:** Object lifecycle reconciliation (`SEC-03`) must distinguish live, pending, deleted, and retained objects.

### DEP-03 — The documented proxy topology conflicts with application client-IP assumptions

- **Severity:** High
- **Location:** Compose host binding, edge proxy configuration, `server.ts`
- **Description:** The application is designed to sit behind a local reverse proxy, but its client-IP logic treats the proxy peer as the client and discards forwarded identity.
- **Why it matters for production:** It turns security throttles into a shared global bucket and creates an immediate availability risk.
- **Recommended fix:** Implement and document a trusted-proxy contract, include reference edge configuration, and test spoofing plus multi-hop cases before deployment.
- **Blocker before production:** Yes.
- **Related risks or dependencies:** Detailed security impact is in `SEC-01`.

### DEP-04 — The production container is built but not exercised before promotion

- **Severity:** High
- **Location:** CI release workflow and production image
- **Description:** The image build is a compile/package check only; no pipeline boots the artifact with its real entrypoint, migrations, secrets contract, dependencies, health probes, and CSP/auth behavior.
- **Why it matters for production:** Release-only failures remain deployment-time surprises, and rollback becomes the first end-to-end test.
- **Recommended fix:** Add an ephemeral staging job that boots the immutable candidate digest, performs migrations as a separate step, runs readiness/API/browser smoke tests, and promotes that same digest.
- **Blocker before production:** Yes.
- **Related risks or dependencies:** See `TEST-07`; do not rebuild between test and production.

### DEP-05 — Infrastructure images are mutable and workloads have no explicit resource envelope

- **Severity:** Medium
- **Location:** Docker Compose service images and runtime resource configuration
- **Description:** Tags such as `redis:7-alpine` and `pgvector/pgvector:pg16` can resolve to different contents over time. Application/dependency services lack documented CPU, memory, file descriptor, connection, and disk-watermark budgets.
- **Why it matters for production:** Identical deployment commands can produce different software, while unbounded upload/render/query pressure can destabilize the host rather than degrade predictably.
- **Recommended fix:** Pin images by reviewed digest, automate controlled updates, set resource reservations/limits and database/Redis connection ceilings, monitor volume capacity, and define behavior at each limit.
- **Blocker before production:** No for a controlled pilot, but pin exact release artifacts and set memory/disk alerts before public launch.
- **Related risks or dependencies:** Size limits and load tests determine sensible values (`SEC-06`, `TEST-11`).

### DEP-06 — Every application startup attempts database migration

- **Severity:** Medium
- **Location:** Container entrypoint/start command (`pnpm db:migrate` before server start)
- **Description:** Schema migration is coupled to starting each application replica. Concurrent rollout replicas can contend, and a long/failed migration blocks all new instances without an explicit pre-deploy checkpoint.
- **Why it matters for production:** Application scaling and schema ownership become entangled; rollback can start older code against a partially or irreversibly migrated schema.
- **Recommended fix:** Run migrations once as an audited pre-deploy job, use backward-compatible expand/contract changes, gate application rollout on success, and document forward-fix/rollback decisions.
- **Blocker before production:** No for a single manually controlled instance, but required before automated or multi-replica rollout.
- **Related risks or dependencies:** Add migration drift/prior-version testing (`TEST-10`).

### DEP-07 — Background scheduling and retry state are not highly available

- **Severity:** Medium
- **Location:** In-process scheduler, bookmark retries, cleanup/idempotency jobs
- **Description:** Scheduled work runs inside application processes with mixed locking/persistence guarantees. Some retry timing is process memory, so restart loses it; multi-instance execution depends on every job correctly implementing distributed ownership.
- **Why it matters for production:** Work can be skipped, duplicated, or delayed during deploys and crashes, with limited operator visibility.
- **Recommended fix:** Inventory every scheduled task, store attempts/next-run/status durably, claim work with leases, make handlers idempotent, expose queue age/failure metrics, and provide replay/dead-letter controls.
- **Blocker before production:** No for non-critical enrichment jobs; yes before relying on jobs for deletion, email, billing, or external actions.
- **Related risks or dependencies:** A durable job/outbox architecture is recommended in `ARCH-02`.

### DEP-08 — There is no proven rollback, staging, or disaster-recovery runbook

- **Severity:** High
- **Location:** Release and operations documentation
- **Description:** The repository does not provide a tested sequence for staging promotion, failed deploy rollback, incompatible migration handling, region/host loss, secret rotation, or recovery ownership and communication.
- **Why it matters for production:** During an incident, operators must invent high-risk actions under time pressure, and recovery time/objectives remain aspirational.
- **Recommended fix:** Define release ownership, immutable artifacts, preflight/abort signals, backup checkpoints, rollback/forward-fix matrices, secret rotation, RPO/RTO, recovery drills, and incident communication. Exercise it before launch.
- **Blocker before production:** Yes.
- **Related risks or dependencies:** The runbook cannot be approved until backups/restores are correct (`DEP-01`, `DEP-02`).

### DEP-09 — Health semantics mix liveness and dependency readiness

- **Severity:** Medium
- **Location:** `/api/health`, container/edge health configuration
- **Description:** A detailed health result includes dependencies and process memory, but there is no clearly separated minimal liveness probe and traffic readiness contract. Docker health status alone does not provide a restart/recovery policy.
- **Why it matters for production:** A transient database outage may cause unnecessary process churn, while a live but unready instance may continue receiving traffic depending on the orchestrator.
- **Recommended fix:** Separate `/livez` (event loop/process alive) from internal `/readyz` (required dependencies and migration state), configure load-balancer removal/retry behavior, and alert on sustained—not momentary—degradation.
- **Blocker before production:** No for a single supervised instance; required for orchestrated multi-instance operation.
- **Related risks or dependencies:** Restrict detailed health/metrics exposure (`SEC-07`).

## Required pre-launch operations checklist

- [ ] Trusted proxy and client-IP behavior verified in the real edge topology.
- [ ] Candidate image booted and smoked; the exact digest is promoted.
- [ ] Migrations run as a controlled pre-deploy step and drift check passes.
- [ ] Database and object-storage backups are encrypted, checksummed, retained, and monitored.
- [ ] A clean restore has succeeded with integrity and representative application checks.
- [ ] Rollback/forward-fix, secret rotation, and incident ownership runbooks are exercised.
- [ ] Resource, disk, database connection, Redis, queue, and AI-budget alerts are configured.
