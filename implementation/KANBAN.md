# Implementation Kanban

Rules: one `DOING` (the owner may run independent cards in parallel); take
the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

`pnpm gate fast` (lint, type-check, 1512 unit tests with coverage, route
coverage) passes with Node 26.13.0, and the real-Valkey ACL suite (`pnpm gate
redis`) passes 7/7. On PostgreSQL 18.6 the migrations, drift check and
integration suite (86 tests) pass when run step by step. On 2026-11-07 the
owner ran `pnpm gate integration`, `pnpm gate e2e`, `pnpm gate container` and
`pnpm smoke` on Node 26 on the dev machine and reported no errors (pass counts
were not recorded); WebKit on Windows now retries once (PR #89).
A backup to SeaweedFS and the documented restore drill passed (RPO 134s, RTO
16s).

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-075](tasks/IMP-075.md) | Buttons stay readable: greyed-out buttons and the home page's bottom sign-up button | |
| [IMP-076](tasks/IMP-076.md) | Bell shows no red "0" when nothing is new | |
| [IMP-077](tasks/IMP-077.md) | Dark mode: the activity box and canvas notes follow the theme | |
| [IMP-078](tasks/IMP-078.md) | Canvas top bar fits on a phone | |
| [IMP-087](tasks/IMP-087.md) | Same page width and top bar on every page | |
| [IMP-089](tasks/IMP-089.md) | Empty pages offer a next step | |
| [IMP-088](tasks/IMP-088.md) | The app says "canvas" everywhere, never "board" | |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster (draft: ServesYouRice/Infra#4) | DEC-004 |
| [IMP-079](tasks/IMP-079.md) | Brand colours and font taken from the logo, no gradients | IMP-075 |
| [IMP-080](tasks/IMP-080.md) | Screens use theme colours instead of hand-typed ones | IMP-079 |
| [IMP-081](tasks/IMP-081.md) | Home page shows the product | IMP-079 |
| [IMP-082](tasks/IMP-082.md) | Sign-in and sign-up pages give the form the room | IMP-079 |
| [IMP-083](tasks/IMP-083.md) | Dashboard: canvas previews, starter row, visible search | IMP-079 |
| [IMP-084](tasks/IMP-084.md) | Canvas: clearer top bar and add bar | IMP-078, IMP-079 |
| [IMP-085](tasks/IMP-085.md) | Canvas notes and background look finished | IMP-077, IMP-079 |
| [IMP-086](tasks/IMP-086.md) | Settings: a side menu instead of one long page | IMP-075, IMP-079 |
| [IMP-090](tasks/IMP-090.md) | Canvas cards are real links; buttons are finger-sized | IMP-083 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | May agents add `apps/memoria/` to the infra repo (a push to its `main` deploys)? | Yes, staging first, via PR | Yes (owner, 2026-11-02) | IMP-056 |
| DEC-003 | Give agent sessions push access to `ServesYouRice/infra` (session permission for adding the repo was denied) | Allow `add_repo` for infra in session settings | Yes (owner, 2026-11-06) | IMP-056 |
| DEC-004 | Fill the infra PR's secrets and `CHANGE_ME` values (hosts, R2, SMTP, SOPS), confirm registration modes, then release a staging image | Staging first; registration `closed` on staging, `invite` on production | | IMP-056 |
| DEC-005 | Run `pnpm gate integration`, `pnpm gate e2e`, `pnpm gate container` and `pnpm smoke` on Node 26 on the dev machine (agent sessions are blocked by Prisma's AI guard on `migrate reset` and by the sandbox proxy's TLS in the image build) | Run on the dev machine | Done, no errors reported (owner, 2026-11-07) | IMP-058, IMP-056 |
| DEC-016 | Which single word does the app use for a user's space: "canvas" or "board"? | "canvas" (already used on the dashboard and in most screens) | "canvas" (owner, 2026-11-11) | IMP-088 |
