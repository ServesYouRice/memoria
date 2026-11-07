# Implementation Kanban

Rules: one `DOING` (the owner may run independent cards in parallel); take
the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

`pnpm gate fast` (lint, type-check, 1512 unit tests with coverage, route
coverage) passes with Node 26.13.0, and the real-Valkey ACL suite (`pnpm gate
redis`) passes 7/7. On PostgreSQL 18.6 the migrations, drift check and
integration suite (86 tests) pass when run step by step; `pnpm gate
integration` itself stops at `prisma migrate reset`, which Prisma refuses to
run for AI agents without the owner's consent. The last full `pnpm gate e2e`
(37/37 on Chromium, Firefox and WebKit) and the strict operations smoke
(15/15) ran on Node 24 and PostgreSQL 16, before IMP-058, IMP-073 and IMP-074.
A backup to SeaweedFS and the documented restore drill passed (RPO 134s, RTO
16s).

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-058](tasks/IMP-058.md) | Move the runtime to Node 26 LTS in one step (pins done; full gates left) | DEC-005 |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster (draft: ServesYouRice/Infra#4) | DEC-004, DEC-005 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | May agents add `apps/memoria/` to the infra repo (a push to its `main` deploys)? | Yes, staging first, via PR | Yes (owner, 2026-11-02) | IMP-056 |
| DEC-003 | Give agent sessions push access to `ServesYouRice/infra` (session permission for adding the repo was denied) | Allow `add_repo` for infra in session settings | Yes (owner, 2026-11-06) | IMP-056 |
| DEC-004 | Fill the infra PR's secrets and `CHANGE_ME` values (hosts, R2, SMTP, SOPS), confirm registration modes, then release a staging image | Staging first; registration `closed` on staging, `invite` on production | | IMP-056 |
| DEC-005 | Run `pnpm gate integration`, `pnpm gate e2e`, `pnpm gate container` and `pnpm smoke` on Node 26 on the dev machine (agent sessions are blocked by Prisma's AI guard on `migrate reset` and by the sandbox proxy's TLS in the image build) | Run on the dev machine | | IMP-058, IMP-056 |
