Title: Performance Budgets and CI Enforcement
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Decision
- Budgets: Landing < 100KB gz JS; Auth < 125KB; Canvas shell < 150KB (canvas libs lazy‑loaded).
- Enforcement via CI bundle size guard and route‑level checks.

Consequences
- Predictable UX; build fails on regressions.

References
- SENATE.md §3.8 Performance Budgets (Accepted)
