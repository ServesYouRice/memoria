# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

Gate status, 2026-08-29: after integrating the `gemini-implementation` and
`codex-implementation` lines, `pnpm lint`, `pnpm type-check`,
`pnpm test:coverage` (95 files, 750 tests), `pnpm test:coverage:routes`,
`pnpm build`, and `pnpm check-bundle` all pass. The order-dependent unit gate
that IMP-052 and IMP-053 addressed did not reappear across repeated runs. That
evidence was collected on Node 22, not the Node 24 line `package.json` and CI
pin. `pnpm test:integration` now passes locally against PostgreSQL 16 (14/14)
after the gate repair. `pnpm test:e2e` and `pnpm smoke` still need Docker and
remain gated on DEC-014; CI exercises the E2E gate.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| [IMP-047](tasks/IMP-047.md) | Make operations recoverable and observable (need higher model assistance) |  |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-048](tasks/IMP-048.md) | Bound resource cost at supported scale (need higher model assistance) | IMP-045 |
| [IMP-038](tasks/IMP-038.md) | Production browser journeys and operations smoke (need higher model assistance) | IMP-045 through IMP-048, IMP-050, IMP-061, DEC-014 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-014 | Final production-gate execution | Grant or run unrestricted Docker/esbuild verification: `pnpm test:e2e`, real-PostgreSQL `pnpm test:integration`, `pnpm build`, and `pnpm smoke` |  | IMP-038 |
