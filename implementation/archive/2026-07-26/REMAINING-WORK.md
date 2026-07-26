# Remaining work

This file contains only work that could not be completed during the 2026-07-18 repository cleanup and audit pass. The prior 178-row historical ledger was removed because its fixed and re-verification entries no longer described the current tree; the original remains available in git history.

There are no known unresolved P0 release blockers. The items below need a larger architectural change, external infrastructure, broader test fixtures, or a product decision.

## Security and data integrity

| ID | Priority | Remaining work | Completion evidence |
|---|---:|---|---|
| SEC-12 | High | Replace direct external-webhook delivery with a transactional outbox and retry worker. Delivery IDs and idempotency headers now exist and persisted metadata is redacted, but a database commit and network delivery are not atomic. | Failure/retry integration tests prove at-most-once downstream effects and eventual delivery after worker restart. |
| COR-16 | Medium | Persist bookmark-refresh attempt/backoff state. Refreshes are bounded, skip deleted rows, preserve metadata/history, and use optimistic concurrency, but repeated failing URLs are only moved to the back of the `updatedAt` queue. | Migration plus scheduler tests demonstrate exponential backoff and eventual retry. |
| COR-30 | Medium | Add a scheduled retention job for expired idempotency rows. Request-time cleanup and account-deletion cleanup exist, but inactive installations can retain expired rows. | Scheduler test deletes only expired rows in bounded batches. |
| COR-23 / PERF-18 | Medium | Move cross-instance collaboration presence to an expiring Redis model. Live authorization is revalidated on every heartbeat, but remote-instance presence does not have a formally tested TTL/lease protocol. | Two-server test proves stale presence disappears after process loss and revoked access closes live sockets. |

## Infinite-canvas scalability

| ID | Priority | Remaining work | Completion evidence |
|---|---:|---|---|
| PERF-01/03/04 | High | Make viewport-based item loading the primary canvas data path. The API has bounded spatial queries, but the main board still loads the complete active item set so search, tags, selection, versions, and export remain coherent. | A documented client cache/merge design plus tests for pan, zoom, off-screen selection, search, reconnect, and concurrent edits on 10k+ items. |
| PERF-05/06 | High | Replace base64 canvas thumbnails with private object assets and generate them from stable revisions or a background job. Current list payloads can include thumbnails and the owner client still regenerates after item changes. | List payload budget test and thumbnail job/revision tests. |
| PERF-08/24 | High | Replace per-upload object enumeration and repeated image buffering with an authoritative quota counter and streaming image pipeline. | Concurrent-upload quota tests and peak-memory measurements for maximum-size images. |
| PERF-09 | High | Add per-user/workspace AI spend quotas and concurrency limits. Input sizes are bounded and missing providers fail closed, but usage is not budgeted. | Atomic quota tests covering concurrent requests, cancellation, and reset windows. |
| PERF-10/11/12/13 | Medium | Split the remaining large UI/data surfaces: `CanvasBoard`, the public-share interactive bundle, dashboard management panels, and template item payloads. | Bundle/render profiles establish budgets and regression gates for each surface. |
| PERF-23 | Medium | Replace sequential version-restore upserts with a bounded set-based or staged restore strategy. | Large-snapshot integration test meets a defined transaction-duration budget without partial restore. |
| PERF-26 | Medium | Establish an infinite-canvas load test and performance budgets. | CI or scheduled test records latency, memory, payload, and interaction thresholds at representative item counts. |

## Product and accessibility decisions

| ID | Priority | Remaining work | Completion evidence |
|---|---:|---|---|
| UX-03/06 | High | Design a complete undo/redo model for create, edit, move, resize, and delete, plus a non-spatial keyboard/screen-reader way to inspect and manipulate canvas items. Keyboard deletion, organizer view, labels, and recovery now exist, but they are not a full accessible alternative. | Product-approved interaction model, screen-reader protocol, and automated keyboard coverage. |
| UX-08 | Medium | Re-audit the optional AR camera lifecycle on supported devices. This requires real device/browser permission testing unavailable in the local environment. | Manual matrix documents permission, reopen, background, denial, and stream-release behavior. |
| UX-10 | Medium | Decide whether `EMBED` items should become sandboxed live embeds or be presented as link previews. | Security-reviewed product decision and tests for the chosen behavior. |
| UX-14 | Medium | Decide whether the meeting timer is personal UI or synchronized collaboration state. | Label it explicitly as personal, or add server-authoritative synchronized state and reconnect tests. |
| PRODUCT-01 | Medium | Add an invitation acceptance/decline lifecycle for email shares. Current shares become available automatically when the matching verified email signs in; no invitation token or consent state exists. | Expiring single-use invitation flow with email delivery, accept/decline UI, and enumeration-safe tests. |

## Release evidence and maintainability

| ID | Priority | Remaining work | Completion evidence |
|---|---:|---|---|
| TST-02/11 | High | Add database-backed integration coverage for account deletion, trash restore, version restore, template use, upload lifecycle, agent execution, and webhook outbox behavior. | Tests run against migrated PostgreSQL and verify constraints/rollback behavior. |
| TST-03/05 | High | Expand the real-auth Playwright smoke suite into behavioral canvas, sharing, recovery, upload, and account-export scenarios. Stale/fake-auth suites were deleted instead of being treated as release evidence. | Deterministic Chromium/Firefox/WebKit CI scenarios assert persisted outcomes. |
| TST-12/13/14 | Medium | Add multi-instance collaboration, service-worker, and automated accessibility harnesses. | CI exercises two app instances, offline/cache upgrades, and axe plus the manual canvas protocol. |
| TST-15 | Medium | Boot and health-check the clean production container, not only build it. | CI starts the image with PostgreSQL/Redis/MinIO, applies migrations, and passes smoke/health checks. |
| OPS-21 | Medium | Add a schema-drift gate comparing the Prisma schema, committed migrations, and a freshly migrated database. | CI fails on an unrepresented schema change. |
| OPS-14 | Medium | Run and document a real backup/restore drill. Backup and restore scripts exist, but this pass had no external S3/PostgreSQL target on which to prove recovery objectives. | Timestamped drill demonstrates checksum validation, restore, application read/write, RPO, and RTO. |
| MNT-01/05/06 | Medium | Decompose `service-core.ts` and `CanvasBoard.tsx`, remove remaining boundary `any` types, and converge API error/correlation handling. | Smaller ownership-focused modules and contract tests; no unvalidated boundary payloads. |

## Verification unavailable in this pass

- `pnpm run type-check`, `pnpm run lint`, `prisma validate`, and `git diff --check` pass after the final edits.
- The full Vitest suite passed earlier in this pass at 28 files / 217 tests. A final rerun after the last product-surface edits was denied by the out-of-sandbox execution quota, so those edits have static but not fresh unit-test evidence.
- The production build passed earlier in this pass with 59 generated routes. A final post-edit build could not be run for the same execution-quota reason.
- The in-app browser runtime reported that no browser was available, so responsive visual screenshots and interactive inspection remain unperformed.
- Docker/S3 backup drills, real email delivery, multi-instance collaboration, and AR device testing require external services or hardware not available in this workspace.
