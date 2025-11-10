Title: State Management Policy — TanStack Query vs Zustand
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Decision
- TanStack Query: server‑persisted data (user, canvases, items), fetching/caching/invalidation.
- Zustand: ephemeral UI (selection, tool, live zoom/pan, modals); no server data stored here.
- Persist zoom/pan via debounced mutations when appropriate.

Consequences
- Predictable data flow and fewer sync bugs.

References
- SENATE.md §3.9 State Management Policy (Accepted)
