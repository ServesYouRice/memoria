# Implementation Kanban

Rules: one `DOING` (the owner may run independent cards in parallel); take
the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

`pnpm lint`, `pnpm type-check` and `pnpm test -- --run` (1191 tests) pass;
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

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-047](tasks/IMP-047.md) | Real client identity behind the gateway (built; compose smoke not run) | DEC-002 |
| [IMP-053](tasks/IMP-053.md) | Visible delete failures and a mobile activity feed (built; E2E not run) | DEC-002 |
| [IMP-057](tasks/IMP-057.md) | Image proxy so the CSP can drop `img-src https:` (built; E2E not run) | DEC-002 |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster | DEC-001, IMP-047 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | May agents add `apps/memoria/` to the infra repo (a push to its `main` deploys)? | Yes, staging first, via PR | | IMP-056 |
| DEC-002 | Run `pnpm smoke` against the compose stack and `pnpm gate e2e` on a machine with Docker (the agent container has none) | Owner runs both on the dev machine | | IMP-047, IMP-053, IMP-057 |
