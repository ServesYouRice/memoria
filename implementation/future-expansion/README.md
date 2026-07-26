# Future expansion

Proposals for work that is **not scheduled and not executable**. Nothing here
has a status row on `../KANBAN.md`, and an executor must never start from a file
in this folder.

A proposal moves into the live backlog only when the user promotes it: its
decision becomes a `DEC-` row, and only the selected next release becomes `IMP-`
cards in `../tasks/`. Never copy a whole proposal onto the board.

Each proposal states the product goal, the decisions that gate it, what the
codebase already supports, what blocks it, and the cards it would become.

## Embeddable canvases

| Document | Role |
| -------- | ---- |
| [FE-roundtable.md](FE-roundtable.md) | **Current synthesis.** Read this one. Merged plan, ranked decisions, and two review rounds. |
| [embeddable-canvases-codex.md](embeddable-canvases-codex.md) | Review input, superseded by the synthesis. |
| [embeddable-canvases-opus.md](embeddable-canvases-opus.md) | Review input, superseded by the synthesis. |

Gated on: the Gate 0 product-boundary decisions, plus IMP-004 and IMP-033 for
the first release. Inputs are retained until the first release is promoted, then
deleted.
