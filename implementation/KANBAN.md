# Implementation Kanban

Rules: one `DOING` (the owner may run independent cards in parallel); take
the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

`pnpm gate fast` (lint, type-check, 1493 unit tests with coverage, route
coverage) passes with Node 24.20.0; the real-PostgreSQL integration suite
passes 37/37 (including 14 sync-server cases). `pnpm gate e2e` passes 37/37
on Chromium, Firefox and WebKit (2 Chromium-only layout audits skip
elsewhere) against the production image with real PostgreSQL, Redis, S3
(SeaweedFS) and captured email, and the strict operations smoke passes
15/15. A backup to SeaweedFS and the documented restore drill passed (RPO
134s, RTO 16s).

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-058](tasks/IMP-058.md) | Move the runtime to Node 26 LTS in one step | |
| [IMP-072](tasks/IMP-072.md) | Moving an item to another board leaves no broken lines | |
| [IMP-073](tasks/IMP-073.md) | Every Redis key and channel under `memoria:` (shared Valkey ACL) | |
| [IMP-074](tasks/IMP-074.md) | Prove Memoria on PostgreSQL 18 (the cluster's version) | |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster (draft: ServesYouRice/Infra#4) | IMP-073, DEC-004 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | May agents add `apps/memoria/` to the infra repo (a push to its `main` deploys)? | Yes, staging first, via PR | Yes (owner, 2026-11-02) | IMP-056 |
| DEC-003 | Give agent sessions push access to `ServesYouRice/infra` (session permission for adding the repo was denied) | Allow `add_repo` for infra in session settings | Yes (owner, 2026-11-06) | IMP-056 |
| DEC-004 | Fill the infra PR's secrets and `CHANGE_ME` values (hosts, R2, SMTP, SOPS), confirm registration modes, then release a staging image | Staging first; registration `closed` on staging, `invite` on production | | IMP-056 |
