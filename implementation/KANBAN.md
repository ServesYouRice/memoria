# Implementation Kanban

Rules: one `DOING` (the owner may run independent cards in parallel); take
the first `READY`; user fills choices in `USER DECISIONS`.

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
| [IMP-043](tasks/IMP-043.md) | Realtime split and replica-ready processes | — |
| [IMP-045](tasks/IMP-045.md) | Offline canvas edits | — |
| [IMP-046](tasks/IMP-046.md) | Version history from snapshots | — |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-047](tasks/IMP-047.md) | Real client identity behind the gateway | IMP-043 |
| [IMP-048](tasks/IMP-048.md) | Rate-limit budgets per user and per route | — |
| [IMP-049](tasks/IMP-049.md) | Green production dependency audit | — |
| [IMP-050](tasks/IMP-050.md) | Upload body and image bounds | — |
| [IMP-051](tasks/IMP-051.md) | Close small security leaks | — |
| [IMP-052](tasks/IMP-052.md) | Fast batch layout writes | — |
| [IMP-053](tasks/IMP-053.md) | Visible delete failures and a mobile activity feed | IMP-045 |
| [IMP-054](tasks/IMP-054.md) | Plain SMTP email in production | — |
| [IMP-055](tasks/IMP-055.md) | Remove dead code and type escape hatches | — |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster | DEC-001, IMP-043, IMP-047 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | May agents add `apps/memoria/` to the infra repo (a push to its `main` deploys)? | Yes, staging first, via PR | | IMP-056 |
