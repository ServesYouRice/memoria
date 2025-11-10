Title: Server‑Side Caching Strategy (Deferred)
Date: 2025-11-09
Status: Proposed
Owners: CodexCLI

Context
- Caching adds complexity; defer until clear triggers (load, latency) are reached.

Decision (Proposed)
- Introduce Redis for canvas board snapshots and unfurl cache when thresholds are exceeded (e.g., P95 > target, item count > threshold).

Consequences
- Avoids premature optimization; clear adoption criteria.

References
- SENATErefactoring.md §3.7 (Caching deferred)
