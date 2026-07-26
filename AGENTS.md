# Agent guide

Memoria is a stateful Next.js application for visual notes. The production
runtime is the custom Node/WebSocket server in `server.ts`; it is not a
serverless-first app. PostgreSQL owns durable state, Redis supports shared
state, and S3-compatible storage owns uploads. WebSockets carry ephemeral
collaboration signals; validated HTTP/Prisma routes remain the durable item
write authority.

## Work loop

1. Read `implementation/KANBAN.md`. Follow a user-named card; otherwise take
   the first `READY` card. Never start a card blocked by a user decision.
2. Move only that card to `DOING`, then read its linked task file. Load source
   files as needed. Treat `implementation/archive/` as history and
   `implementation/future-expansion/` as unscheduled proposals; neither is a
   current instruction and neither is a place to start work.
3. Implement the smallest complete change that meets the card acceptance
   criteria. Match nearby code, types, naming, and comments.
4. Run the card's targeted checks, then the relevant repository checks. Do not
   weaken tests or checks to get a pass.
5. Move the card to `DONE` with one short evidence note. If blocked, move it to
   `WAITING` and add one `DEC-` row naming the exact decision or external action
   needed.

Keep at most one card in `DOING`. Do not create new audit, plan, summary, or
remaining-work files. Add newly discovered work to the Kanban only when it is
real, non-duplicate, and outside the active card.

## Repository gotchas

- Use `pnpm`; supported Node and pnpm versions are declared in `package.json`.
- `src/proxy.ts` is the request middleware boundary. Production-only auth,
  proxy, CSP, rate-limit, Redis, email, and object-storage behavior needs
  production-shaped tests.
- Preserve HTTP authorization and Zod validation even when the UI prevents an
  action. UI capability checks are not a security boundary.
- Schema changes require a Prisma migration. Test database behavior against
  PostgreSQL when constraints, transactions, cascades, or raw SQL matter.
- Keep the supported launch topology explicit. Do not add replicas or move to
  serverless until shared event, lease, and job semantics are implemented.
- Preserve unrelated user changes in a dirty worktree.

## Verification

Prefer focused tests while iterating. Before handoff, run the checks named by
the task card. Common checks are:

```bash
pnpm lint
pnpm type-check
pnpm test -- --run
pnpm build
pnpm smoke
```

Report commands that were not run or did not pass; never infer success.

## Model and agent use

Use one executor for normal cards. If parallel agents are available, use them
only for independent work with disjoint file ownership; the coordinator alone
updates the Kanban and integrates results. A lower-tier executor should consult
an advisor/high-tier model only for a concrete architecture, security, or
debugging impasse, then continue execution itself.
