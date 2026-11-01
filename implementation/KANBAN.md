# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

`pnpm lint`, `pnpm type-check` and `pnpm test -- --run` (1015 tests) pass;
the real-PostgreSQL integration suite passes 37/37 (including 14 sync-server
cases); E2E passes 10/10 on Chromium (including two-browser co-editing and
real-browser embed framing) against the production image with real
PostgreSQL, Redis, S3 (SeaweedFS) and captured email, and the strict
operations smoke passes 15/15. Firefox and WebKit run only through
`pnpm gate e2e` and were not run here. A backup to SeaweedFS and the
documented restore drill passed (RPO 134s, RTO 16s).

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-043](tasks/IMP-043.md) | Realtime split and replica-ready processes | — |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
