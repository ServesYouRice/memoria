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
| [IMP-110](tasks/IMP-110.md) | Optional full copy of saved pages (picture and PDF) | |
| [IMP-113](tasks/IMP-113.md) | PDFs on the canvas: upload, read, search and ask | |
| [IMP-114](tasks/IMP-114.md) | Video cards with time-stamped notes and a transcript | |
| [IMP-119](tasks/IMP-119.md) | Settings page shows one copy of each field while it loads | |
| [IMP-120](tasks/IMP-120.md) | "Page not found" says so in plain words and offers two ways on | |
| [IMP-121](tasks/IMP-121.md) | Plain words on Status, Your data, Share and Help | |
| [IMP-122](tasks/IMP-122.md) | Every label uses sentence case | |
| [IMP-123](tasks/IMP-123.md) | One name for two-step codes | |
| [IMP-124](tasks/IMP-124.md) | Settings tidy-up: one password field with show/hide, clear headings, shortcuts get their own entry | |
| [IMP-125](tasks/IMP-125.md) | Small readability and markup fixes found by the accessibility check | |
| [IMP-126](tasks/IMP-126.md) | Every page can be reached from a menu (Inbox, Reminders, Weekly recap, Help) | |
| [IMP-128](tasks/IMP-128.md) | Password and email pages look and read like the sign-in page | |
| [IMP-129](tasks/IMP-129.md) | Shared-link and setup pages carry the Memoria name and a way on | |
| [IMP-130](tasks/IMP-130.md) | "Organised list" shows a real list you can filter and sort | |
| [IMP-131](tasks/IMP-131.md) | AI settings fit one screen; the rest sits under "Advanced" | |
| [IMP-132](tasks/IMP-132.md) | Deleted canvases go to Trash for 30 days (server side) | |
| [IMP-134](tasks/IMP-134.md) | One search, and Ctrl K always opens it | |
| [IMP-135](tasks/IMP-135.md) | The canvas menu is sorted into named groups | |
| [IMP-136](tasks/IMP-136.md) | Dashboard: one "New canvas" button, plus sort and filter | |
| [IMP-137](tasks/IMP-137.md) | Each canvas card has a "..." menu: rename, duplicate, move to workspace, delete | |
| [IMP-138](tasks/IMP-138.md) | Activity names the canvas, groups repeats and stays small | |
| [IMP-139](tasks/IMP-139.md) | On a phone, hidden tools get a "More" button and labels fit | |
| [IMP-140](tasks/IMP-140.md) | Press and hold opens an item's menu on touch screens (check on a real iPhone first) | |
| [IMP-141](tasks/IMP-141.md) | An empty canvas shows a first step | |
| [IMP-142](tasks/IMP-142.md) | Double-click a note and type on it (no pop-up form) | |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-056](tasks/IMP-056.md) | Deploy Memoria on the k3s cluster (draft: ServesYouRice/Infra#4) | DEC-004 |
| [IMP-115](tasks/IMP-115.md) | A hosted paid plan people can sign up and pay for | DEC-019 |
| [IMP-127](tasks/IMP-127.md) | API keys live inside Settings | IMP-126 |
| [IMP-133](tasks/IMP-133.md) | Deleting a canvas says "Move to Trash", offers Undo, and Trash lists it | IMP-132 |
| [IMP-143](tasks/IMP-143.md) | "Note" drops a note on the board, ready to type | IMP-142 |

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
