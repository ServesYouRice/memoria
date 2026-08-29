# Observability

Launch-scale byte, item, timing, memory, export, and collaboration ceilings
are recorded in [resource-budgets.md](resource-budgets.md). Treat a budget
violation as a capacity incident; do not raise a limit before capturing a
fresh normal and hostile-flow trace.

Start the reference profile with:

```bash
docker compose --env-file .env.selfhost --profile observability up -d
```

Prometheus scrapes the protected application metrics endpoint with the
operations token mounted as a Compose secret. Grafana is available only on the
configured loopback port (3001 by default), and Alertmanager is on loopback
port 9093. The checked-in Alertmanager receiver retains and groups alerts in its
UI without embedding organization credentials; configure an external paging
receiver before relying on unattended notifications.

Every rule in `monitoring/alerts.yml` has an explicit threshold, severity,
owner, and runbook. Exercise changes with:

```bash
docker run --rm -v "$PWD/monitoring:/work" \
  prom/prometheus:v3.5.0 \
  promtool test rules /work/alert-tests.yml
```

## Target down

Owner: platform. Confirm the app container is running, inspect its last stop
signal, and use public `/api/health` only to distinguish process liveness from
dependency readiness. Do not route traffic until authenticated `/api/ready`
recovers.

## Readiness

Owner: platform. Inspect the protected readiness checks. Database, migration,
and Redis failures remove traffic; private object-storage failure degrades the
upload feature and remains visible separately.

## Database

Owner: data. Check PostgreSQL health, connections, disk, and migration state.
Keep the app out of traffic until both database checks pass.

## Storage

Owner: storage. Verify the private source bucket, endpoint, credentials, and
representative authorized object reads. Existing note reads can continue while
uploads are degraded.

## HTTP errors

Owner: application. The critical threshold is more than five 5xx responses in
five minutes; the client-error warning is more than 100 4xx responses in ten
minutes. Correlate with deploys and structured request logs.

## Redis safety

Owners: platform and security. Redis unavailability removes the reference app
from traffic. Any recorded login/rate-limit safety failure pages security;
verify fail-closed behavior before restoring traffic.

## WebSockets

Owner: collaboration. Investigate more than 20 rejected upgrades in five
minutes or more than 4,500 concurrent connections (90% of the supported
single-instance ceiling). Check origins, authorization, Redis, and abusive
clients before raising limits.

## Outbox

Owner: delivery. A runnable job older than five minutes warns; any dead letter
or repeated claim failure is critical. Provider timeouts and lease loss warn
immediately. Inspect the protected outbox control, resolve the underlying
provider/dependency issue, then replay only safe dead jobs.

## Email

Owner: delivery. Check the provider status and verified sender/domain, then run
the controlled operations delivery probe. Preserve its job ID and mailbox
receipt as evidence. Recovery links use stable delivery IDs and remain valid if
a provider performs an at-least-once retry.

## AI budget

Owner: AI operations. Direct provider requests reserve worst-case tokens and
cost atomically in Redis before execution. `AI_ENABLED=false` is the operator
kill switch; `AI_DAILY_TOKEN_BUDGET`, `AI_DAILY_COST_MICRO_USD`, and
`AI_MAX_CONCURRENT_PER_USER` bound each account. Any budget rejection warns and
is visible in account settings. The separate agent-action gauge warns at 80% of
`AI_ACTION_BUDGET_DAILY` and becomes critical above 100%. Investigate runaway
automation or unexpected reservations before raising either budget.

Backup alerts and recovery actions are documented in
`docs/operations/backup-recovery.md`.
