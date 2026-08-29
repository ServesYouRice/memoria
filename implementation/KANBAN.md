# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

Gate status, 2026-08-29: `pnpm test -- --run` passes 104 files and 780 tests;
`pnpm lint`, `pnpm type-check`, `pnpm check-bundle`, and `prisma validate` also
pass. Next's webpack compilation and route generation pass; the final server
bundle needs the repository's Node 24.20 runtime and unrestricted filesystem.
Schema drift additionally needs a reachable `DATABASE_URL` database.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-038](tasks/IMP-038.md) | Production browser journeys and operations smoke (need higher model assistance) | DEC-014 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-014 | Final production-gate execution | Grant or run unrestricted Docker/esbuild verification: `pnpm test:e2e`, real-PostgreSQL `pnpm test:integration`, `pnpm build`, and `pnpm smoke` |  | IMP-038 |
