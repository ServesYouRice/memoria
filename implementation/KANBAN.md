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
| [IMP-091](tasks/IMP-091.md) | Import bookmarks from a browser, Pocket or Raindrop | |
| [IMP-092](tasks/IMP-092.md) | Saving from an iPhone is easy to set up | |
| [IMP-093](tasks/IMP-093.md) | Browser button saves the page you are on | |
| [IMP-094](tasks/IMP-094.md) | Keep the text of saved pages | |
| [IMP-095](tasks/IMP-095.md) | Arrows work as real links between items | |
| [IMP-096](tasks/IMP-096.md) | Open canvas files in and out (`.canvas`, `.excalidraw`) | |
| [IMP-097](tasks/IMP-097.md) | "Remind me" and "Something old" | |
| [IMP-098](tasks/IMP-098.md) | Templates and "Duplicate canvas" (build the server side, then switch on) | |
| [IMP-099](tasks/IMP-099.md) | Sign in with an existing login system | |
| [IMP-100](tasks/IMP-100.md) | Lighter install and set-up checks | |
| [IMP-101](tasks/IMP-101.md) | Ask about one canvas or one tag | |
| [IMP-102](tasks/IMP-102.md) | Setting up your own AI key is easy | |
| [IMP-103](tasks/IMP-103.md) | The canvas stays smooth when it is full (2,000 items) | |
| [IMP-104](tasks/IMP-104.md) | Polls with votes counted on the server | |
| [IMP-105](tasks/IMP-105.md) | A timer everyone on the canvas sees | |
| [IMP-106](tasks/IMP-106.md) | Your own tagging rules | |
| [IMP-107](tasks/IMP-107.md) | Standing notes for AI agents, per workspace | |
| [IMP-108](tasks/IMP-108.md) | Tables on the canvas | |
| [IMP-109](tasks/IMP-109.md) | One item on several canvases | |
| [IMP-112](tasks/IMP-112.md) | Publish the AGPL-3.0 licence and a "never paywalled" promise | |

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
| [IMP-110](tasks/IMP-110.md) | Optional full copy of saved pages (picture and PDF) | IMP-094 |
| [IMP-111](tasks/IMP-111.md) | Home page and guides say what Memoria leads on | IMP-081 |
| [IMP-113](tasks/IMP-113.md) | PDFs on the canvas: upload, read, search and ask | IMP-094 |
| [IMP-114](tasks/IMP-114.md) | Video cards with time-stamped notes and a transcript | IMP-094 |
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
