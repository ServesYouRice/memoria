# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

Gate status, 2026-08-24: `pnpm lint` and `pnpm type-check` pass with TypeScript
5.9.3, and all 64 unit/API files collect. The normal test gate is still
order-dependent: its first run failed 8 of 444 tests, `pnpm test:coverage` then
passed 444/444, and an immediate repeat of the normal command passed 444/444.
The focused command is also broken and nearly every server test still pays for
happy-dom. Take [IMP-053](tasks/IMP-053.md) first, then
[IMP-052](tasks/IMP-052.md), before relying on later test evidence.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| [IMP-065](tasks/IMP-065.md) | Cover comment authorization by visibility and role | In progress |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-066](tasks/IMP-066.md) | Cover connection authorization and canvas binding |  |
| [IMP-050](tasks/IMP-050.md) | Make local push checks proportional and fail-safe |  |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-045](tasks/IMP-045.md) | Make collaboration transport truthful and bounded (need higher model assistance) |  |
| [IMP-046](tasks/IMP-046.md) | Make the launch surface truthful and accessible (need higher model assistance) |  |
| [IMP-047](tasks/IMP-047.md) | Make operations recoverable and observable (need higher model assistance) |  |
| [IMP-048](tasks/IMP-048.md) | Bound resource cost at supported scale (need higher model assistance) | IMP-045 |
| [IMP-038](tasks/IMP-038.md) | Production browser journeys and operations smoke (need higher model assistance) | IMP-045 through IMP-048, IMP-050, IMP-061, DEC-014 |
| [IMP-061](tasks/IMP-061.md) | Ratchet explicit API-route coverage from a measured baseline | IMP-055 through IMP-060, IMP-062 through IMP-066 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-014 | Final production-gate execution | Grant or run unrestricted Docker/esbuild verification: `pnpm test:e2e`, real-PostgreSQL `pnpm test:integration`, `pnpm build`, and `pnpm smoke` |  | IMP-038 |
