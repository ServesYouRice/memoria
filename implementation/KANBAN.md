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

IMP-144 to IMP-153 come from the handbook's 2026-11-12 rehearsal run
(`before-production.md` section memoria, `board.md` ME-01 to ME-08, RUN-ME-1
to RUN-ME-3).

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-144](tasks/IMP-144.md) | Container image under 1 GB (drop webpack's build cache) | - |
| [IMP-145](tasks/IMP-145.md) | Mail required in production only; staging warns and sharing still works | - |
| [IMP-146](tasks/IMP-146.md) | A switch that keeps passkeys off until the final domain | - |
| [IMP-147](tasks/IMP-147.md) | Scheduler retries within a minute; `server.ts` drops `url.parse` | - |
| [IMP-148](tasks/IMP-148.md) | Release command: build, tag, push, digest; stop on high findings | - |
| [IMP-149](tasks/IMP-149.md) | Least-privilege runtime database role | - |
| [IMP-150](tasks/IMP-150.md) | Expand/contract rule for migrations; `DEPLOYMENT.md` | - |
| [IMP-151](tasks/IMP-151.md) | OpenTelemetry; drop `@vercel/analytics`; runtime browser Sentry address | - |
| [IMP-152](tasks/IMP-152.md) | Direct browser uploads; password-reset mail through the outbox | - |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster (manifests merged in ServesYouRice/Infra#4; secrets and staging release open) | DEC-004 |
| [IMP-110](tasks/IMP-110.md) | Optional full copy of saved pages (built; needs a real-browser run) | DEC-020 |
| [IMP-119](tasks/IMP-119.md) | Settings page shows one copy of each field while it loads | DEC-022 |
| [IMP-140](tasks/IMP-140.md) | Press and hold opens an item's menu on touch screens (built; needs a real iPhone check) | DEC-021 |
| [IMP-153](tasks/IMP-153.md) | A way to issue sign-up invites in production | DEC-024 |
| [IMP-115](tasks/IMP-115.md) | A hosted paid plan people can sign up and pay for | DEC-019 |

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
| DEC-017 | Which licence does Memoria publish under, and which features are promised to stay free? | AGPL-3.0 (used by comparable self-hosted tools); always free: self-hosting, passkeys and two-step codes, export, AI on your own key | AGPL-3.0; always free: self-hosting, passkeys and two-step codes, export, AI on your own key (owner, 2026-11-11) | IMP-112 |
| DEC-018 | May Memoria fetch video transcripts automatically? YouTube has no open official way to read captions of other people's videos; unofficial tools work but can break and sit in a grey area of its terms | No automatic fetching: ship time-stamped notes and pasted transcripts only | Yes, as an opt-in switch: off by default, switched on per deployment (owner, 2026-11-11) | IMP-114 |
| DEC-019 | Hosted paid plan: what does the paid plan add, what does it cost, and who takes the payments? | One paid plan next to a free one; it sells hosting, more storage and included AI, never the features promised free in DEC-017; a payment company that also handles sales tax | | IMP-115 |
| DEC-020 | Run the page-capture worker once with a real browser: `COMPOSE_PROFILES=capture PAGE_CAPTURE=true docker compose up --build capture-worker`, save a link, and confirm a picture and PDF appear | Run on the dev machine | Owner runs it on the dev machine (owner, 2026-11-14) | IMP-110 |
| DEC-021 | On a real iPhone or iPad: hold a note ~0.5 s, the item menu opens at the finger with no text-selection bubble; drag, pinch, tap and double-tap still work; on Android the menu opens once | Check on a real device | Owner checks on a real iPhone (owner, 2026-11-14) | IMP-140 |
| DEC-022 | Duplicate Settings fields come from React re-rendering the `loading.tsx` boundary while the server copy is still hidden; the trigger is unknown. Either debug against a production build on the dev machine, or delete `src/app/settings/loading.tsx` (Settings loses its loading placeholder) | Debug on a production build first | Debug against a production build (owner, 2026-11-14) | IMP-119 |
| DEC-023 | Run `pnpm build`, `pnpm gate integration` and `pnpm gate e2e` on Node 26 on the dev machine for the 2026-11-14 batch (agent sessions had no disk for a build, no browser stack and no Redis) | Run on the dev machine | Merge without them (owner, 2026-11-14) | IMP-110, IMP-140 |
| DEC-024 | Production sign-up: how do new people get in? Today `REGISTRATION_MODE=invite` and nothing creates an invite (handbook INF-32) | Keep `invite`; build an owner-only invite command and Settings page | | IMP-153 |
