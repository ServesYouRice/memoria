# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| _none_ |  |  |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-001](tasks/IMP-001.md) | Reliable private image reads | — |
| [IMP-002](tasks/IMP-002.md) | Working verify/login/deep-link journey | — |
| [IMP-004](tasks/IMP-004.md) | Proxy-safe rate-limit identity | — |
| [IMP-007](tasks/IMP-007.md) | Lossless autosave and cache rollback | — |
| [IMP-008](tasks/IMP-008.md) | One geometry/capability contract | — |
| [IMP-009](tasks/IMP-009.md) | SSR/theme/shortcut/error baseline | — |
| [IMP-014](tasks/IMP-014.md) | Durable outbox/worker foundation | — |
| [IMP-019](tasks/IMP-019.md) | Real-DB and production-auth tests | — |
| [IMP-020](tasks/IMP-020.md) | Release artifact gates | — |
| [IMP-033](tasks/IMP-033.md) | Revocable public share links | — |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-003](tasks/IMP-003.md) | Explicit registration modes | DEC-001 |
| [IMP-005](tasks/IMP-005.md) | Lockout without victim DoS | IMP-004 |
| [IMP-006](tasks/IMP-006.md) | WebSocket permission and admission boundary | IMP-004 |
| [IMP-010](tasks/IMP-010.md) | Safe templates and duplication | DEC-003 |
| [IMP-011](tasks/IMP-011.md) | Identity-safe undo and redo | DEC-004, IMP-007 |
| [IMP-012](tasks/IMP-012.md) | Server-authoritative polls | DEC-005 |
| [IMP-013](tasks/IMP-013.md) | Durable rich-text format | DEC-006 |
| [IMP-015](tasks/IMP-015.md) | Durable email/webhook delivery | IMP-014, DEC-002 |
| [IMP-016](tasks/IMP-016.md) | Durable upload lifecycle | IMP-014 |
| [IMP-017](tasks/IMP-017.md) | Convergent item synchronization | IMP-007, DEC-007 |
| [IMP-018](tasks/IMP-018.md) | Enforced launch limits and retention | IMP-014, DEC-008 |
| [IMP-021](tasks/IMP-021.md) | Proven backup and recovery | IMP-016, DEC-010 |
| [IMP-022](tasks/IMP-022.md) | Accessible and responsive canvas | DEC-009 |
| [IMP-023](tasks/IMP-023.md) | Contract cleanup and decomposition | IMP-007, IMP-008, IMP-017 |
| [IMP-024](tasks/IMP-024.md) | Viewport-first canvas loading | IMP-017, IMP-018 |
| [IMP-025](tasks/IMP-025.md) | Durable maintenance and thumbnails | IMP-014, IMP-016, IMP-018 |
| [IMP-026](tasks/IMP-026.md) | Bounded version history and restore | IMP-017, IMP-018 |
| [IMP-027](tasks/IMP-027.md) | Share invitations and recipient notifications | IMP-002, IMP-014, DEC-001 |
| [IMP-028](tasks/IMP-028.md) | Edge and operations hardening | IMP-004 |
| [IMP-029](tasks/IMP-029.md) | Truthful client errors and search | IMP-007 |
| [IMP-030](tasks/IMP-030.md) | Atomic canvas commands and viewport state | IMP-007, IMP-008 |
| [IMP-031](tasks/IMP-031.md) | Runtime collaboration efficiency | IMP-004, IMP-006, IMP-017 |
| [IMP-032](tasks/IMP-032.md) | Optional product-surface semantics | DEC-011, DEC-012, DEC-013 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY`.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-001 | Self-host registration default | `closed` (`open` in dev) | _unset_ | IMP-003, IMP-027 |
| DEC-002 | Agent external webhooks in v1 | Gate off until outbox ships | _unset_ | IMP-015 |
| DEC-003 | Templates: repair or hide | Hide until safe cloning ships | _unset_ | IMP-010 |
| DEC-004 | Undo/redo: repair or hide | Hide until identity-safe restore ships | _unset_ | IMP-011 |
| DEC-005 | Polls: repair or hide | Hide until server-authoritative voting ships | _unset_ | IMP-012 |
| DEC-006 | Rich text: versioned JSON or plain text | Versioned Tiptap JSON | _unset_ | IMP-013 |
| DEC-007 | Launch topology | One supervised app instance | _unset_ | IMP-017 |
| DEC-008 | Launch quotas/retention | 2k items/canvas; 50 versions; trash 30d; shared AI off | _unset_ | IMP-018 |
| DEC-009 | Accessibility launch bar | Accessible DOM item list before public launch | _unset_ | IMP-022 |
| DEC-010 | Recovery target and drill environment | Name S3/Postgres target, owner, RPO/RTO | _unset_ | IMP-021 |
| DEC-011 | Embeds | Link previews, not live embeds | _unset_ | IMP-032 |
| DEC-012 | Meeting timer | Personal UI, clearly labeled | _unset_ | IMP-032 |
| DEC-013 | AR support | Experimental/off until device matrix passes | _unset_ | IMP-032 |

## DONE

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| _none_ |  |  |
