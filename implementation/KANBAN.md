# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

Gate status, 2026-11-01 (Node 22 sandbox): `pnpm lint`, `pnpm type-check`,
`pnpm test -- --run` (110 files, 873 tests) and `pnpm build` pass; the
integration suite passes 16/16 on a freshly migrated PostgreSQL; `pnpm test:e2e`
passes 8/8 on Chromium against the production image with real PostgreSQL,
Redis, S3 (SeaweedFS) and captured email, and the strict operations smoke passes
14/14. Firefox and WebKit run only through `pnpm gate e2e`.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-039](tasks/IMP-039.md) | Cloudflare R2 as the production object store | - |
| [IMP-041](tasks/IMP-041.md) | Better Auth replaces next-auth 5 beta | - |
| [IMP-044](tasks/IMP-044.md) | Signed embeds with per-embed framing | - |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-042](tasks/IMP-042.md) | Real co-editing on Yjs with a Hocuspocus sync server | IMP-041 |
| [IMP-043](tasks/IMP-043.md) | Realtime split and replica-ready processes | IMP-042 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
