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
| [IMP-040](tasks/IMP-040.md) | Complete bounded response contracts |  |
| [IMP-041](tasks/IMP-041.md) | Correct authentication and capability handling |  |
| [IMP-042](tasks/IMP-042.md) | Make self-host configuration enforceable |  |
| [IMP-043](tasks/IMP-043.md) | Harden external fetches, uploads, and dependencies |  |
| [IMP-045](tasks/IMP-045.md) | Make collaboration transport truthful and bounded |  |
| [IMP-050](tasks/IMP-050.md) | Make the unit and API gate deterministic |  |
| [IMP-051](tasks/IMP-051.md) | Close the verified small-surface residue |  |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-044](tasks/IMP-044.md) | Make item mutations composable and recoverable | IMP-040 |
| [IMP-046](tasks/IMP-046.md) | Make the launch surface truthful and accessible | IMP-040, IMP-044 |
| [IMP-047](tasks/IMP-047.md) | Make operations recoverable and observable | IMP-042, IMP-043 |
| [IMP-048](tasks/IMP-048.md) | Bound resource cost at supported scale | IMP-040, IMP-043, IMP-044, IMP-045 |
| [IMP-038](tasks/IMP-038.md) | Production browser journeys and operations smoke | IMP-040 through IMP-048, IMP-050, DEC-014 |

## USER DECISIONS

Fill `Choice`; an executor then moves the related card from `WAITING` to
`READY` when all dependencies are satisfied.

| ID | Decision | Recommended | Choice | Unblocks |
| -- | -------- | ----------- | ------ | -------- |
| DEC-014 | Final production-gate execution | Grant or run unrestricted Docker/esbuild verification: `pnpm test:e2e`, real-PostgreSQL `pnpm test:integration`, `pnpm build`, and `pnpm smoke` |  | IMP-038 |

## DONE

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| [IMP-049](tasks/IMP-049.md) | Reconciled Codex audit findings against Opus and current source | All 42 Codex findings dispositioned with evidence; 2 left untraced rather than scheduled; corrections recorded in both directions; residue promoted to IMP-050, IMP-051 and named in IMP-044. Verified 2026-08-11: `pnpm audit --prod` red (5 high, 5 moderate), `pnpm test -- --run` red (6 files, 7 tests, all timeouts). |
| [IMP-039](tasks/IMP-039.md) | Reconciled Opus audit findings against Codex and current source | Blockers dispositioned, false positives corrected, omissions promoted to IMP-040 through IMP-048; dependency audit re-confirmed red. |
| [IMP-034](tasks/IMP-034.md) | Truthful registration, verification, and login UI | Registration modes, inbox/resend states, typed verification failures, and safe callbacks; lint, type-check, build, and focused auth tests pass. |
| [IMP-035](tasks/IMP-035.md) | Visible save, image-failure, and collaboration recovery | Save/error indicators, image retry fallback, committed-event replay/tombstone recovery, and focused recovery tests pass. |
| [IMP-036](tasks/IMP-036.md) | Launch UI matches gated-feature and rich-text contracts | Template/poll entry points gated, voting inert with retained data, versioned Tiptap bridge, and focused note-format tests pass. |
| [IMP-037](tasks/IMP-037.md) | Truthful search, share, and mutation dialogs | Server totals/facets, actionable API errors, confirmed public-link rotation/revocation, and focused search tests pass. |

The 33 completed `IMP-001` through `IMP-033` cards and their evidence are
preserved in `archive/2026-08-01/KANBAN.md`.
