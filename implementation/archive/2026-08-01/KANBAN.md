# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

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
`READY`.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | Self-host registration default | `closed` (`open` in dev) | `open` in production, development, and test unless explicitly overridden | IMP-003, IMP-027 |
| DEC-002 | Agent external webhooks in v1 | Gate off until outbox ships | Gate off until durable outbox delivery ships | IMP-015 |
| DEC-003 | Templates: repair or hide | Hide until safe cloning ships | Hide until safe cloning ships | IMP-010 |
| DEC-004 | Undo/redo: repair or hide | Hide until identity-safe restore ships | Hide until identity-safe restore ships | IMP-011 |
| DEC-005 | Polls: repair or hide | Hide until server-authoritative voting ships | Hide until server-authoritative voting ships | IMP-012 |
| DEC-006 | Rich text: versioned JSON or plain text | Versioned Tiptap JSON | Versioned Tiptap JSON | IMP-013 |
| DEC-007 | Launch topology | One supervised app instance | One supervised app instance | IMP-017 |
| DEC-008 | Launch quotas/retention | 2k items/canvas; 50 versions; trash 30d; shared AI off | 2k items/canvas; 50 versions; trash 30d; shared AI off | IMP-018 |
| DEC-009 | Accessibility launch bar | Accessible DOM item list before public launch | Require accessible DOM item list before public launch; implementation remains UI-excluded | IMP-022 |
| DEC-010 | Recovery target and drill environment | Name S3/Postgres target, owner, RPO/RTO | Separate versioned backup storage plus PostgreSQL PITR; quarterly isolated restore drill; deployment operator owns it; RPO 1h, RTO 4h | IMP-021 |
| DEC-011 | Embeds | Link previews, not live embeds | Link previews at launch; live embeds parked in future expansion | IMP-032 |
| DEC-012 | Meeting timer | Personal UI, clearly labeled | Personal UI, clearly labeled | IMP-032 |
| DEC-013 | AR support | Experimental/off until device matrix passes | Experimental/off until device matrix passes | IMP-032 |

## DONE

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| [IMP-008](tasks/IMP-008.md) | One geometry/capability contract | Parent-owned serialized geometry commits cover all item types; role gates prevent unsupported local mutations; focused geometry suite (60 tests) and type-check pass. |
| [IMP-009](tasks/IMP-009.md) | SSR/theme/shortcut/error baseline | Server HTML/theme reconciliation, editable shortcut suppression, neutral error recovery, and loading skeletons; focused UI suite (16 tests), type-check, and lint pass. |
| [IMP-022](tasks/IMP-022.md) | Accessible and responsive canvas | DOM item list is wired into authenticated and public canvases with keyboard actions/capability gates; responsive overflow actions and mobile-safe controls added; type-check and lint pass. **Steps 1-4 only: Playwright axe automation, the NVDA/VoiceOver manual protocol, and Percy coverage are still outstanding — see the `<status>` block in [IMP-022](tasks/IMP-022.md) before treating DEC-009 as evidenced.** |
| [IMP-032](tasks/IMP-032.md) | Optional product-surface semantics | Embeds are labelled inert link previews, timer is explicitly personal, AR is opt-in experimental and device-gated, and help copy matches; focused product suite (10 tests), type-check, and lint pass. |
| [IMP-023](tasks/IMP-023.md) | Contract cleanup and decomposition | Request IDs now span proxy/server/problem/log boundaries, API responses are bounded and validated, the legacy serverless branch is removed, Redis configuration is shared, and external webhook delivery is isolated; 292 unit tests, 14 real-PostgreSQL tests, type-check, lint, build, and strict smoke pass. |
| [IMP-031](tasks/IMP-031.md) | Runtime collaboration efficiency | Backend: declared 15-second session-version cache/invalidation, batched heartbeat authorization, 20 Hz cursor fanout with noise dropping, and shared Redis rate-limit client implemented; cache and rate-limit tests pass in the 292-test final suite. |
| [IMP-030](tasks/IMP-030.md) | Atomic canvas commands and viewport state | Backend: idempotent mixed update/delete/create transaction with one authorization/lock, OCC rollback, deterministic z-index, and explicit published-default viewport contract implemented; atomic rollback and replay pass against PostgreSQL. |
| [IMP-026](tasks/IMP-026.md) | Bounded version history and restore | Backend: bounded version bytes/items, shared mutation lock, set-based restore under timeouts, identity collision checks, retained post-restore revision, and durable reload-required fanout implemented; a 2,000-item PostgreSQL restore passes under the 15-second budget. |
| [IMP-025](tasks/IMP-025.md) | Durable maintenance and thumbnails | Backend: outbox-backed bookmark refresh and cleanup, unchanged-content version stability, revision-checked thumbnail candidates/private objects, stale suppression, replacement deletion, explicit list projections, and queue metrics implemented; focused worker tests pass in the final suite. |
| [IMP-024](tasks/IMP-024.md) | Viewport-first canvas loading | Backend: database spatial queries, bounded authenticated/public pagination, 512 KiB response budgets, and authorized canvas summary endpoint implemented; bounded public reads pass against PostgreSQL. |
| [IMP-027](tasks/IMP-027.md) | Share invitations and recipient notifications | Backend: expiring single-use invitation tokens, encrypted delivery secrets, stable recipient identity, atomic pending-share caps, accept/decline/revoke state, notification preferences, durable email delivery, and recipient read-state API implemented; lifecycle and replay tests pass against PostgreSQL. |
| [IMP-021](tasks/IMP-021.md) | Proven backup and recovery | Signed versioned manifests, fail-closed database/object checksums, isolated object inventory restore, freshness checks, separate recovery storage, and runbook implemented; script tests pass and an isolated PostgreSQL 17/MinIO drill restored matching row counts and object SHA-256 in about 8 seconds. |
| [IMP-018](tasks/IMP-018.md) | Enforced launch limits and retention | Central launch limits, transaction-scoped quota locking, bounded trash/version retention jobs, safe usage endpoint, oversized input validation, and operator violation reporting implemented; final unit, PostgreSQL integration, build, and strict smoke gates pass. |
| [IMP-017](tasks/IMP-017.md) | Convergent item synchronization | Ordered committed-event envelopes and deletion tombstones are atomically outboxed, Redis/WebSocket fanout added, bounded cursor replay can demand snapshots; 14 focused tests and 8 real-PostgreSQL tests, type-check, lint pass. Client merge UI excluded by user. |
| [IMP-015](tasks/IMP-015.md) | Durable email/webhook delivery | Registration/resend atomically queue encrypted verification delivery, worker uses stable delivery IDs and terminal retry policy, token-gated operator replay/cancel exists, v1 webhooks gated; 25 focused tests and 7 real-PostgreSQL tests, type-check, lint pass. |
| [IMP-013](tasks/IMP-013.md) | Durable rich-text format | Versioned bounded Tiptap JSON with allowlisted nodes/marks/links, safe legacy HTML bridge, readable projections, and idempotent migration command; 28 focused tests, type-check, lint pass. Rich-text UI conversion excluded by user. |
| [IMP-012](tasks/IMP-012.md) | Server-authoritative polls | Poll creation, direct reads, list queries, and mutations are explicitly gated; stored poll rows preserved and voter arrays no longer returned by canvas APIs; 10 focused tests, type-check, lint pass. Poll UI excluded by user. |
| [IMP-011](tasks/IMP-011.md) | Identity-safe undo and redo | Unsupported undo/redo command payloads rejected by strict durable schemas; explicit trash restore retains original IDs and optimistic versions; 11 focused tests, type-check, lint pass. UI shortcuts/history excluded by user. |
| [IMP-010](tasks/IMP-010.md) | Safe templates and duplication | Launch API routes explicitly gated before auth/storage, stored templates preserved, normal canvas lists exclude templates; 2 focused tests, type-check, lint pass. Template UI excluded by user. |
| [IMP-003](tasks/IMP-003.md) | Explicit registration modes | Explicit open/invite/closed policy, early API enforcement, atomic single-use invite consumption, setup/doctor coverage; 5 focused tests, type-check, lint pass. Registration UI excluded by user. |
| [IMP-020](tasks/IMP-020.md) | Release artifact gates | Migration/runtime separation, schema-drift and Next 16 bundle gates, production-shaped services and artifacts; lint, type-check, 262 unit tests, 6 real-PostgreSQL tests, build, bundle budgets, and final strict smoke pass. |
| [IMP-001](tasks/IMP-001.md) | Reliable private image reads | Backend scope: exact upload-write limiting; streamed private reads with ETag/cache tests; 7 focused tests, type-check, lint pass. Canvas error UI excluded by user. |
| [IMP-002](tasks/IMP-002.md) | Working verify/login/deep-link journey | Backend scope: typed unverified error, truthful registration delivery, public safe resend/token replacement, verified login destination, safe callback validation; 10 focused tests, type-check, lint pass. Auth UI/E2E excluded by user. |
| [IMP-004](tasks/IMP-004.md) | Proxy-safe rate-limit identity | Trusted CIDR/rightmost-untrusted derivation, internal header overwrite, env/doctor diagnostics, duplicate policy removed; 17 focused tests, type-check, lint pass. |
| [IMP-007](tasks/IMP-007.md) | Lossless autosave and cache rollback | Serialized lossless delta queue, server-version advancement, typed conflict/offline states, full cache rollback; 3 focused tests, type-check, lint pass. Canvas status UI excluded by user. |
| [IMP-014](tasks/IMP-014.md) | Durable outbox/worker foundation | Migrated outbox, transactional enqueue, atomic SKIP LOCKED leasing, retries/dead letters/replay, worker lifecycle; unit plus 3 real-PostgreSQL tests pass. |
| [IMP-019](tasks/IMP-019.md) | Real-DB and production-auth tests | Guarded from-zero integration runner and CI PostgreSQL job cover leases/dedupe/dead-letter/cascades; 3 real-DB tests pass. Browser/UI scenarios excluded by user. |
| [IMP-033](tasks/IMP-033.md) | Revocable public share links | Atomic enable, permanent disable revocation, owner rotation with activity, cache invalidation; 5 real-PostgreSQL tests, type-check, lint pass. Share-dialog UI excluded by user. |
| [IMP-005](tasks/IMP-005.md) | Lockout without victim DoS | Per-principal/client escalation, bounded account delay, correct-login recovery, production Redis fail-closed policy; focused auth/Redis tests, type-check, lint pass. |
| [IMP-006](tasks/IMP-006.md) | WebSocket permission and admission boundary | Exact-origin and active-share-token admission, VIEW social-write denial, closed schemas, layered budgets, Redis cross-instance messages; 4 focused tests, type-check, lint pass. |
| [IMP-028](tasks/IMP-028.md) | Edge and operations hardening | Minimal liveness, token-gated readiness/metrics, HSTS/XSS/CORS policy, recursive log scrubbing, hostile SSRF coverage, legacy API-key migration/removal; 16 focused tests, type-check, lint pass. Production smoke deferred. |
| [IMP-029](tasks/IMP-029.md) | Truthful client errors and search | RFC 7807 request/retry metadata, bounded/escaped search, complete type/tag facets, all-type snippets, transient FTS recovery; 4 focused tests, type-check, lint pass. Dialog/search UI excluded by user. |
| [IMP-016](tasks/IMP-016.md) | Durable upload lifecycle | Lifecycle/quota schema, atomic reservation, pending/active/failed states, durable idempotent deletion worker and cascade enqueue; 6 real-PostgreSQL tests, type-check, lint pass. |
