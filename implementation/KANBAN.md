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
| [IMP-059](tasks/IMP-059.md) | Built-in AI runs on any saved provider (Claude, Gemini, OpenRouter, local), not only OpenAI | |
| [IMP-060](tasks/IMP-060.md) | Browser extension: save all tabs to Memoria with a sorting note, then close them | |
| [IMP-062](tasks/IMP-062.md) | AI sorting that follows your written instruction | IMP-059, IMP-060 |
| [IMP-061](tasks/IMP-061.md) | Phone: "Share → Memoria" (Android share target, iPhone Shortcut) | IMP-060 |
| [IMP-063](tasks/IMP-063.md) | Saved links name, tag and explain themselves | IMP-059 |
| [IMP-064](tasks/IMP-064.md) | "You saved this already" duplicate warning | IMP-060 |
| [IMP-065](tasks/IMP-065.md) | New items file themselves into the right board (one tap, undo) | IMP-063 |
| [IMP-066](tasks/IMP-066.md) | Agents (Hermes, OpenClaw) can write on cards and make boards | |
| [IMP-067](tasks/IMP-067.md) | Ask your boards, and tell them what to do | IMP-059 |
| [IMP-068](tasks/IMP-068.md) | Turn a pile into a checklist, table or summary | IMP-059 |
| [IMP-069](tasks/IMP-069.md) | Weekly recap and tidy-up of old links | IMP-063 |
| [IMP-070](tasks/IMP-070.md) | Voice and photos become tidy notes | IMP-059 |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-047](tasks/IMP-047.md) | Real client identity behind the gateway (built; compose smoke not run) | DEC-002 |
| [IMP-053](tasks/IMP-053.md) | Visible delete failures and a mobile activity feed (built; E2E not run) | DEC-002 |
| [IMP-057](tasks/IMP-057.md) | Image proxy so the CSP can drop `img-src https:` (built; E2E not run) | DEC-002 |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster | DEC-003, IMP-047 |
| [IMP-058](tasks/IMP-058.md) | Move the runtime to Node 26 LTS in one step | DEC-002 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | May agents add `apps/memoria/` to the infra repo (a push to its `main` deploys)? | Yes, staging first, via PR | Yes (owner, 2026-11-02) | IMP-056 |
| DEC-002 | Run `pnpm smoke` against the compose stack and `pnpm gate e2e` on a machine with Docker (the agent container has none) | Owner runs both on the dev machine | | IMP-047, IMP-053, IMP-057, IMP-058 |
| DEC-003 | Give agent sessions push access to `ServesYouRice/infra` (session permission for adding the repo was denied) | Allow `add_repo` for infra in session settings | | IMP-056 |
