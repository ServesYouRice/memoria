# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

Gate status, 2026-11-01 (Node 22 sandbox, after IMP-039/040/041/044 merged):
`pnpm lint`, `pnpm type-check` and `pnpm test -- --run` (965 tests) pass;
`pnpm test:e2e` passes 9/9 on Chromium against the production image with real
PostgreSQL, Redis, S3 (SeaweedFS) and captured email, and the strict
operations smoke passes 14/14. Firefox and WebKit run only through
`pnpm gate e2e` and were not run here.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| [IMP-042](tasks/IMP-042.md) | Real co-editing on Yjs with a Hocuspocus sync server | in progress |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-039](tasks/IMP-039.md) | R2 client merged; backup/restore against S3 still to prove | - |
| [IMP-044](tasks/IMP-044.md) | Embeds merged; real-browser framing still to prove | - |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-043](tasks/IMP-043.md) | Realtime split and replica-ready processes | IMP-042 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
