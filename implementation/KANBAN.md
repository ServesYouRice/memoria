# Implementation Kanban

Rules: one `DOING` (the owner may run independent cards in parallel); take
the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

`pnpm gate fast` (lint, type-check, 1191 unit tests with coverage, route
coverage) passes on the Windows dev machine with Node 24.20.0; the
real-PostgreSQL integration suite passes 37/37 (including 14 sync-server
cases); E2E passes 13/13 on Chromium (including two-browser co-editing and
real-browser embed framing) against the production image with real
PostgreSQL, Redis, S3 (SeaweedFS) and captured email, and the strict
operations smoke passes 15/15, both there and against the compose stack.
`pnpm gate e2e` on all three browsers passes 32 and fails 5 (IMP-059). A
backup to SeaweedFS and the documented restore drill passed (RPO 134s,
RTO 16s).

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-059](tasks/IMP-059.md) | Firefox and WebKit pass `pnpm gate e2e` | |
| [IMP-063](tasks/IMP-063.md) | AI sorting that follows your written instruction | IMP-060, IMP-061 |
| [IMP-062](tasks/IMP-062.md) | Phone: "Share → Memoria" (Android share target, iPhone Shortcut) | IMP-061 |
| [IMP-064](tasks/IMP-064.md) | Saved links name, tag and explain themselves | IMP-060 |
| [IMP-065](tasks/IMP-065.md) | "You saved this already" duplicate warning | IMP-061 |
| [IMP-066](tasks/IMP-066.md) | New items file themselves into the right board (one tap, undo) | IMP-064 |
| [IMP-068](tasks/IMP-068.md) | Ask your boards, and tell them what to do | IMP-060 |
| [IMP-069](tasks/IMP-069.md) | Turn a pile into a checklist, table or summary | IMP-060 |
| [IMP-070](tasks/IMP-070.md) | Weekly recap and tidy-up of old links | IMP-064 |
| [IMP-071](tasks/IMP-071.md) | Voice and photos become tidy notes | IMP-060 |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-053](tasks/IMP-053.md) | Visible delete failures and a mobile activity feed (built; Chromium E2E passes) | IMP-059 |
| [IMP-057](tasks/IMP-057.md) | Image proxy so the CSP can drop `img-src https:` (built; Chromium E2E passes) | IMP-059 |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster | DEC-003 |
| [IMP-058](tasks/IMP-058.md) | Move the runtime to Node 26 LTS in one step | IMP-059 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | May agents add `apps/memoria/` to the infra repo (a push to its `main` deploys)? | Yes, staging first, via PR | Yes (owner, 2026-11-02) | IMP-056 |
| DEC-003 | Give agent sessions push access to `ServesYouRice/infra` (session permission for adding the repo was denied) | Allow `add_repo` for infra in session settings | | IMP-056 |
