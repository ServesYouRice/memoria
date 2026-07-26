# Implementation workflow

`KANBAN.md` is the only live backlog. Each row links to one self-contained task
prompt. Read one card at a time; the archived audits are evidence history only.

## Status rules

- `READY`: may start now.
- `DOING`: exactly one active card.
- `WAITING`: dependency is not done.
- `USER DECISIONS`: the user must fill the choice before work starts.
- `DONE`: acceptance checks passed; evidence is recorded.

An executor moves a card to `DOING` before editing and to `DONE` after checks.
Use a short evidence value such as `unit + type-check` or a commit SHA. Keep the
board terse; implementation detail belongs in the linked card or code.

## Execution rules

1. Complete one card per run.
2. Use the listed files as entry points, then inspect only what the change
   requires.
3. Follow numbered steps and acceptance criteria literally. Ask only when a
   listed user decision is unresolved or a newly discovered choice materially
   changes product/security behavior.
4. Verify with the card commands. Preserve failing evidence instead of editing
   tests to match broken behavior.
5. Update existing cards instead of producing another audit or plan.

The cards use clear outcomes, explicit constraints, and XML sections so small
models can distinguish context, work, acceptance, and verification. Repository
context stays in `AGENTS.md`; task-specific context is loaded progressively
from the selected card.
