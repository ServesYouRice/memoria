# Implementation workflow

`KANBAN.md` is the only live backlog. Each row links to one self-contained task
card. The work loop lives in `../AGENTS.md`; this file defines only what the
board's columns and evidence values mean.

## Status rules

- `READY`: may start now.
- `DOING`: exactly one active card.
- `WAITING`: a listed `IMP-` or `DEC-` dependency is unresolved.
- `USER DECISIONS`: the user fills `Choice`; the related card then moves from
  `WAITING` to `READY`.
- `DONE`: acceptance checks passed and evidence is recorded.

Every card has exactly one status row. Evidence is short — `unit + type-check`,
a commit SHA, or a link. Keep the board terse; detail belongs in the linked card
or in the code.

## Card format

Cards use XML sections so small models can separate context from work:
`<objective>` (the outcome), `<files>` (repo-relative entry points, not an
exhaustive list), optional `<context>`, `<steps>`, `<acceptance>`, and
`<verification>`. Repository-wide context stays in `../AGENTS.md`; per-task
context is loaded only from the selected card.

Archived audits under `archive/` are evidence history, not instructions.
