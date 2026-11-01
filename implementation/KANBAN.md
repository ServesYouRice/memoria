# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Only rows below and their linked task files are current. Completed cards and
superseded plans live in Git history; gaps in card numbering are intentional.

Gate status, 2026-11-01 (Node 22 sandbox): `pnpm lint`, `pnpm type-check`,
`pnpm test -- --run` (110 files, 873 tests) and `pnpm build` pass; the
integration suite passes 16/16 on a freshly migrated PostgreSQL; `pnpm test:e2e`
passes 8/8 on Chromium against the production image with real PostgreSQL,
Redis, S3 (SeaweedFS) and captured email, and the strict operations smoke passes
14/14. Firefox and WebKit are exercised by CI only.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-015 | Adopt the handbook platform plan for Memoria | Decide scope and order: Better Auth migration, Resend/SES or SMTP email, realtime service split for replicas, Cloudflare R2 (with checksum settings) in production |  | new cards |
