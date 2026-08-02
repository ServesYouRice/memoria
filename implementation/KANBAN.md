# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Completed launch-foundation cards and their prior board snapshot are archived under
`archive/2026-08-01/`. Parked product proposals remain under `future-expansion/`
until the user explicitly promotes one.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| None |  |  |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| None |  |  |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-038](tasks/IMP-038.md) | Production browser journeys and operations smoke | DEC-014 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-014 | Final production-gate execution | Grant or run unrestricted Docker/esbuild verification: `pnpm test:e2e`, real-PostgreSQL `pnpm test:integration`, `pnpm build`, and `pnpm smoke` |  | IMP-038 |

## DONE

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| [IMP-034](tasks/IMP-034.md) | Truthful registration, verification, and login UI | Registration modes, inbox/resend states, typed verification failures, and safe callbacks; lint, type-check, build, and focused auth tests pass. |
| [IMP-035](tasks/IMP-035.md) | Visible save, image-failure, and collaboration recovery | Save/error indicators, image retry fallback, committed-event replay/tombstone recovery, and focused recovery tests pass. |
| [IMP-036](tasks/IMP-036.md) | Launch UI matches gated-feature and rich-text contracts | Template/poll entry points gated, voting inert with retained data, versioned Tiptap bridge, and focused note-format tests pass. |
| [IMP-037](tasks/IMP-037.md) | Truthful search, share, and mutation dialogs | Server totals/facets, actionable API errors, confirmed public-link rotation/revocation, and focused search tests pass. |

The 33 completed `IMP-001` through `IMP-033` cards and their evidence are
preserved in `archive/2026-08-01/KANBAN.md`.
