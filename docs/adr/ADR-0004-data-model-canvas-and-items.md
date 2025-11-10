Title: Data Model — Multi‑Canvas, Normalized Geometry, Versioning, Audit, Indexes
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Context
- MVP must avoid migration traps and support growth to collaboration.

Decision
- User:Canvas = 1:N (drop unique on Canvas.userId; add index).
- CanvasItem: keep content JSON for flexibility; normalize geometry (positionX/Y, width/height).
- Add version (optimistic concurrency), audit fields (createdBy/updatedBy/deletedBy), deletedAt soft‑delete.
- Indexes: (canvasId), (canvasId,type), (canvasId,zIndex), (canvasId,deletedAt).

Alternatives
- All JSONB (rejected: unqueryable and slow for geometry/ordering).

Consequences
- Queryable, evolvable model; straightforward ordering and soft‑delete semantics.

Implementation
- Update Prisma schema; consider tsvector generated column in Phase 2 for search.

References
- SENATE.md §3.3 Schema (Accepted)
