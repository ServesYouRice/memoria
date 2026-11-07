# Agent guide

Memoria is a stateful Next.js application for visual notes. The production
runtime is the custom Node/WebSocket server in `server.ts`; it is not a
serverless-first app. PostgreSQL owns durable state, Redis supports shared
state, and S3-compatible storage owns uploads. WebSockets carry ephemeral
collaboration signals; validated HTTP/Prisma routes remain the durable item
write authority.

## Direction

Memoria follows the owner's hosting and architecture handbook
(`ServesYouRice/handbook`, `projects/memoria.md` and `standards.md`).

- **Principle:** build it as a full product with the right technology, not a
  demo, and without overkill. Size hardware for today, but build the seams for
  scale; switch on a second replica or heavier stack only when it is used.
- **Target:** real co-editing on Yjs with a dedicated Hocuspocus sync server
  that persists document updates (offline edits and snapshot history follow);
  the realtime service split from the Next.js app so either can run more than
  one replica. Already in place: Better Auth (passkeys, TOTP), signed embed
  tokens with per-embed framing rules, and an R2-ready S3 client.
- **Platform:** the shared k3s cluster's PostgreSQL 18 (CloudNativePG), Valkey
  (Redis protocol) and R2. The bundled SeaweedFS/MinIO and monitoring stack are
  for local and self-host use only. Cluster configuration lives in the private
  `infra` repo, not here.
- **Verification is local.** The owner uses no hosted CI; checks run on the dev
  machine and in pre-push hooks.
- **Stays out:** Kafka, Elasticsearch, and feature microservices. A separate
  process is justified only when it runs differently (worker, scheduler, sync
  server). Background work stays in the PostgreSQL outbox/job queue, and every
  job must be safe to run twice.

The Kanban orders the target work. Earlier "intentionally disabled" or
"do not build" notes that conflict with this section are superseded.

## Work loop

1. Read `implementation/KANBAN.md`. Follow a user-named card; otherwise take
   the first `READY` card. Never start a card blocked by a user decision.
2. Move only that card to `DOING`, then read its linked task file. Load source
   files as needed. Only cards linked from the live Kanban are instructions;
   missing card numbers and material recoverable from Git history are not work.
3. Implement the smallest complete change that meets the card acceptance
   criteria. Match nearby code, types, naming, and comments.
4. Run the card's targeted checks, then the relevant repository checks. Do not
   weaken tests or checks to get a pass.
5. When the card passes, remove its Kanban row and task file in the same commit;
   the commit and reported checks are the durable evidence. If blocked, move it
   to `WAITING` and add one `DEC-` row naming the exact decision or external
   action needed.

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
- Keep the supported topology explicit. Serverless stays out. A second replica
  of any process is switched on only after its shared event, lease, and job
  semantics are implemented and tested (see the Kanban).
- Preserve unrelated user changes in a dirty worktree.

## Verification

Prefer focused tests while iterating. Before handoff, run the checks named by
the task card. Common checks are:

```bash
pnpm test:file <path>
pnpm lint
pnpm type-check
pnpm test -- --run
pnpm build
pnpm smoke
pnpm gate [build|audit|integration|redis|container|e2e|all]
```

There is no hosted CI: `pnpm gate` (fast stage by default) is the local gate,
and service-backed or browser stages are explicit opt-ins. Run `build` for
build-affecting changes, `integration` for schema, SQL, or transaction changes,
and `e2e` for runtime, auth, or UI flow changes.

Report commands that were not run or did not pass; never infer success.

## Model and agent use

Use one executor for normal cards. If parallel agents are available, use them
only for independent work with disjoint file ownership; the coordinator alone
updates the Kanban and integrates results. A lower-tier executor should consult
an advisor/high-tier model only for a concrete architecture, security, or
debugging impasse, then continue execution itself.
