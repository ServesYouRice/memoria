# Monitoring & Observability Guide

Memoria exposes lightweight first-party health, metrics, and structured logging
signals. Production deployments should pair these with external uptime checks,
log aggregation, and alerting.

## Health

Endpoint:

```http
GET /api/health
```

Response shape:

```json
{
  "status": "healthy",
  "timestamp": "2026-07-04T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "pass",
      "responseTime": 12
    },
    "memory": {
      "status": "pass",
      "percentage": 45.2,
      "used": 512000000,
      "total": 1024000000,
      "rss": 123456789,
      "external": 5678
    }
  }
}
```

Status behavior:

| Overall status | HTTP status | Meaning |
| --- | --- | --- |
| `healthy` | `200` | Database is reachable and memory is within normal range. |
| `degraded` | `503` | Non-critical pressure exists, currently high memory warning. |
| `unhealthy` | `503` | A critical check failed. |

Health responses are never cached.

## Metrics

Endpoint:

```http
GET /api/metrics
```

The endpoint returns Prometheus text format:

```text
# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 1.23

# HELP nodejs_heap_size_total_bytes Process V8 heap size total in bytes.
# TYPE nodejs_heap_size_total_bytes gauge
nodejs_heap_size_total_bytes 12345678
```

Current metrics include:

- `process_cpu_user_seconds_total`
- `process_cpu_system_seconds_total`
- `process_start_time_seconds`
- `nodejs_heap_size_total_bytes`
- `nodejs_heap_size_used_bytes`
- `nodejs_external_memory_bytes`
- `canvascollect_http_requests_total`
- `canvascollect_http_request_duration_seconds`
- `canvascollect_canvas_operations_total`

The application metrics currently provide a stable scraping contract. Request
instrumentation can increment them in a later pass.

## Request Tracing

Middleware assigns or forwards an `x-request-id` value and adds it to responses.
Use that ID to correlate client reports, reverse-proxy logs, application logs,
and error tracking events.

## Logging

Structured logging is implemented with Pino under `src/lib/logger`. Logs are
JSON in production and redacted for sensitive fields such as passwords, tokens,
secrets, API keys, and authorization headers.

Operational expectations:

- collect stdout/stderr from the app container;
- retain logs long enough to investigate security and data-loss incidents;
- alert on repeated health failures, migration failures, and WebSocket upgrade
  failures;
- keep request IDs visible in reverse-proxy logs.

## Recommended Alerts

- `/api/health` returns non-`200` for two consecutive checks.
- App container restarts repeatedly.
- PostgreSQL is unreachable or migrations fail.
- Redis is unreachable in production.
- Object-storage bucket checks fail.
- WebSocket smoke checks fail after deployment.
- Memory remains above the degraded threshold.

## Verification

```powershell
pnpm doctor
pnpm smoke
curl http://localhost:3000/api/health
curl http://localhost:3000/api/metrics
```

In self-host setups, run the checks from both inside the app network and from
the external reverse proxy path.
