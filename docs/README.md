# Documentation Index

This is the current documentation map for Memoria. Historical implementation
trackers and point-in-time audits live in [`archive/`](./archive/) so they do
not read as current project state.

## Current References

| Document | Status | Notes |
| --- | --- | --- |
| [README](../README.md) | Current | Product, runtime, setup, and project-state overview. |
| [Architecture](../ARCHITECTURE.md) | Current | Self-hosted runtime, data model, collaboration, agents, and operational shape. |
| [Deployment](./DEPLOYMENT.md) | Current | Development and self-host deployment flow. |
| [API](./API.md) | Current | Main HTTP API reference and response conventions. |
| [API Versioning](./API_VERSIONING.md) | Current | Version headers, supported versions, and error policy. |
| [Monitoring](./MONITORING.md) | Current | Health, metrics, logging, and alerting guidance. |
| [Logging](./LOGGING.md) | Current | Structured logging conventions. |
| [Real-Time Updates](./REAL_TIME_UPDATES.md) | Current | Custom WebSocket and polling behavior. |
| [Database Setup](./DATABASE_SETUP.md) | Current | PostgreSQL and Prisma setup. |
| [Database Indexes](./DATABASE_INDEXES.md) | Current | Index overview and maintenance notes. |
| [Operations](./operations/) | Current | Backup and restore procedures. |
| [ADRs](./adr/) | Current | Accepted architectural decisions. |

## Archived References

The archived documents are retained for history only. They include slice
completion checklists, MVP implementation summaries, old UI plans, and older
security/audit snapshots. Do not use them as implementation status without
checking the current code.
