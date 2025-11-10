Title: Observability — Logging, Health, Metrics
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Decision
- Logging: pino with correlation IDs (traceparent), user id when present, and redaction of secrets.
- Endpoints: `/api/health` deep health (DB + storage), `/metrics` Prometheus format.

Consequences
- Enables triage and SLO tracking; small runtime overhead.

References
- SENATE.md §3.7 Observability & Metrics (Accepted)
