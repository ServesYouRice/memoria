# Implementation Kanban

Rules: one `DOING`; take the first `READY`; user fills choices in `USER DECISIONS`.

Gate status, 2026-08-22: `pnpm type-check` is red (`TS5102`, `baseUrl` removed in
TypeScript 7) and `pnpm test -- --run` is red (10 failing tests, 3 suites that
fail to collect). The pre-push hook and CI both fail on the first of these. No
card can produce trustworthy evidence until [IMP-052](tasks/IMP-052.md) lands,
so take it before resuming anything else.

Completed launch-foundation cards and their prior board snapshot are archived under
`archive/2026-08-01/`. Parked product proposals remain under `future-expansion/`
until the user explicitly promotes one.

## DOING

| Card | Outcome | Evidence |
| ---- | ------- | -------- |
| [IMP-045](tasks/IMP-045.md) | Make collaboration transport truthful and bounded | In progress |

## READY

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-052](tasks/IMP-052.md) | Restore the unit and API gate to green |  |
| [IMP-045](tasks/IMP-045.md) | Make collaboration transport truthful and bounded |  |
| [IMP-046](tasks/IMP-046.md) | Make the launch surface truthful and accessible |  |
| [IMP-047](tasks/IMP-047.md) | Make operations recoverable and observable |  |
| [IMP-051](tasks/IMP-051.md) | Close the verified small-surface residue |  |

## WAITING

| Card | Outcome | Depends |
| ---- | ------- | ------- |
| [IMP-053](tasks/IMP-053.md) | Make focused runs and CI reproducible | IMP-052 |
| [IMP-054](tasks/IMP-054.md) | Remove live network I/O from the unit suite | IMP-052 |
| [IMP-055](tasks/IMP-055.md) | Replace card evidence that asserts nothing about the product | IMP-052 |
| [IMP-056](tasks/IMP-056.md) | Cover the API-key authentication boundary | IMP-052 |
| [IMP-057](tasks/IMP-057.md) | Cover account credential and deletion routes | IMP-052 |
| [IMP-058](tasks/IMP-058.md) | Cover operator, cron, and bootstrap endpoints | IMP-052 |
| [IMP-059](tasks/IMP-059.md) | Cover agent API authorization | IMP-052, IMP-056 |
| [IMP-060](tasks/IMP-060.md) | Cover ownership enforcement on remaining v1 CRUD routes | IMP-052 |
| [IMP-050](tasks/IMP-050.md) | Make the unit and API gate deterministic | IMP-052, IMP-053 |
| [IMP-061](tasks/IMP-061.md) | Ratchet coverage from a measured baseline | IMP-056 through IMP-060 |
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
| [IMP-044](tasks/IMP-044.md) | Make item mutations composable and recoverable | Per-item optimistic rollback isolation; undo preserves original soft-deleted item ID and relations; bulk duplicate/delete uses allSettled with partial feedback and failed selection retention; in-flight idempotency lease recovery on uncompleted requests. |
| [IMP-043](tasks/IMP-043.md) | Harden external fetches, uploads, and dependencies | SSRF DNS rebinding and TOCTOU prevented via pinned connection requests; FEATURE_BOOKMARK_UNFURLING fails closed; item content structural and 256KB byte caps enforced; CORS sets Vary: Origin header on reflected responses. |
| [IMP-042](tasks/IMP-042.md) | Make self-host configuration enforceable | Placeholder secrets rejected in production env and doctor; unique secret generation in setup.mjs; full env pass-through in docker-compose.yml with configurable host port; reference Caddyfile with operations route protection, body limits, and reverse proxy. |
| [IMP-041](tasks/IMP-041.md) | Correct authentication and capability handling | Reject active lock before Argon2 verification on all paths; password verified before checking unverified email state; registration existing-user and race handling returns uniform 201; atomic CAS on email verification token redemption; explicit canvas metadata role-based field select redacting shareToken for non-owners. |
| [IMP-040](tasks/IMP-040.md) | Complete bounded response contracts | Linear UTF-8 byte accumulation and budget bounding; authoritative cursor pagination across byte boundaries; shared runtime response schemas and types; public share page continuation loop; thumbnailRevision cache busting and image fallback; server pagination total and truthful selection label. |
| [IMP-049](tasks/IMP-049.md) | Reconciled Codex audit findings against Opus and current source | All 42 Codex findings dispositioned with evidence; 2 left untraced rather than scheduled; corrections recorded in both directions; residue promoted to IMP-050, IMP-051 and named in IMP-044. Verified 2026-08-11: `pnpm audit --prod` red (5 high, 5 moderate), `pnpm test -- --run` red (6 files, 7 tests, all timeouts). |
| [IMP-039](tasks/IMP-039.md) | Reconciled Opus audit findings against Codex and current source | Blockers dispositioned, false positives corrected, omissions promoted to IMP-040 through IMP-048; dependency audit re-confirmed red. |
| [IMP-034](tasks/IMP-034.md) | Truthful registration, verification, and login UI | Registration modes, inbox/resend states, typed verification failures, and safe callbacks; lint, type-check, build, and focused auth tests pass. |
| [IMP-035](tasks/IMP-035.md) | Visible save, image-failure, and collaboration recovery | Save/error indicators, image retry fallback, committed-event replay/tombstone recovery, and focused recovery tests pass. |
| [IMP-036](tasks/IMP-036.md) | Launch UI matches gated-feature and rich-text contracts | Template/poll entry points gated, voting inert with retained data, versioned Tiptap bridge, and focused note-format tests pass. |
| [IMP-037](tasks/IMP-037.md) | Truthful search, share, and mutation dialogs | Server totals/facets, actionable API errors, confirmed public-link rotation/revocation, and focused search tests pass. |

The 33 completed `IMP-001` through `IMP-033` cards and their evidence are
preserved in `archive/2026-08-01/KANBAN.md`.
