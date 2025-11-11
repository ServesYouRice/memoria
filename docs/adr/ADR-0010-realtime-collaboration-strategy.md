Title: Real‑Time Collaboration Strategy (CRDT vs OT)
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Context
- Collaboration is Phase 3. MVP uses debounced autosave; we must define a migration path compatible with our data model.

Decision (Proposed)
- Prefer CRDTs (e.g., Y.js) for conflict‑free item transforms and presence; evaluate OT if strict ordering is required.

Evaluation Criteria
- Offline support, merge semantics, latency under N concurrent users, persistence model, server complexity, operational overhead.

Next Steps
- Prototype Y.js on a branch; document persistence and reconciliation with server state.

References
- SENATErefactoring.md §3.5, §3.2 (Phase 3)
