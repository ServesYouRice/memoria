# Implementation workflow

`KANBAN.md` is the only live backlog. Each row links to one self-contained task
card. The work loop lives in `../AGENTS.md`; this file defines only the board
lifecycle and card format.

`tasks/` contains only unfinished cards linked by the board. Completed cards,
superseded audits, and unselected proposals are removed from the working tree;
Git history remains their source of record. Missing card numbers are therefore
intentional and never imply work.

## Status rules

- `READY`: may start now.
- `DOING`: exactly one active card.
- `WAITING`: a listed `IMP-` or `DEC-` dependency is unresolved.
- `USER DECISIONS`: the user fills `Choice`; the related card then moves from
  `WAITING` to `READY`.

Every unfinished card has exactly one status row. When acceptance checks pass,
remove the row and task file in the same commit. Keep the board terse;
completion evidence belongs in the commit and reported verification output.

## Card format

Cards use XML sections so small models can separate context from work:
`<objective>` (the outcome), `<files>` (repo-relative entry points, not an
exhaustive list), optional `<context>`, `<executor_constraints>`, `<steps>`,
`<acceptance>`, and `<verification>`. Repository-wide context stays in
`../AGENTS.md`; per-task context is loaded only from the selected card.

Do not add audit dumps, model transcripts, alternate backlogs, completed-card
archives, or proposal folders under `implementation/`. Convert a confirmed,
approved piece of work directly into one bounded Kanban card.
