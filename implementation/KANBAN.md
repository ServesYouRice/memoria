# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| [IMP-018](tasks/IMP-018.md) | Enforced launch limits and retention | Backend implementation in progress; quota UI excluded by user |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-008](tasks/IMP-008.md) | One geometry/capability contract | UI scope excluded by user |
| [IMP-009](tasks/IMP-009.md) | SSR/theme/shortcut/error baseline | UI scope excluded by user |
| [IMP-021](tasks/IMP-021.md) | Proven backup and recovery | IMP-016 and DEC-010 resolved |
| [IMP-022](tasks/IMP-022.md) | Accessible and responsive canvas | UI scope excluded by user |
| [IMP-027](tasks/IMP-027.md) | Share invitations and recipient notifications | IMP-002, IMP-014, and DEC-001 resolved |
| [IMP-032](tasks/IMP-032.md) | Optional product-surface semantics | UI scope excluded by user |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-023](tasks/IMP-023.md) | Contract cleanup and decomposition | IMP-007, IMP-008, IMP-017 |
| [IMP-024](tasks/IMP-024.md) | Viewport-first canvas loading | IMP-017, IMP-018 |
| [IMP-025](tasks/IMP-025.md) | Durable maintenance and thumbnails | IMP-014, IMP-016, IMP-018 |
| [IMP-026](tasks/IMP-026.md) | Bounded version history and restore | IMP-017, IMP-018 |
| [IMP-030](tasks/IMP-030.md) | Atomic canvas commands and viewport state | IMP-007, IMP-008 |
| [IMP-031](tasks/IMP-031.md) | Runtime collaboration efficiency | IMP-004, IMP-006, IMP-017 |

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
