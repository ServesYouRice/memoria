# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

Gate status, 2026-08-29: on the merge of `codex-implementation` into `main`,
`pnpm lint`, `pnpm type-check`, `pnpm test -- --run` (104 files, 780 tests),
`pnpm build`, and `pnpm check-bundle` all pass. The integration suite passes
14/14 against PostgreSQL 16 and `scripts/check-schema-drift.mjs` reports only
the approved generated-tsvector exception. That evidence was collected on Node
22, not the Node 24 line `package.json` and CI pin, and the suite ran against a
freshly migrated database rather than through the `prisma migrate reset` step of
`pnpm test:integration`. `pnpm test:e2e` and `pnpm smoke` still need Docker and
remain gated on DEC-014; CI exercises the E2E gate.

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
