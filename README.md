# Memoria

Memoria is a stateful Node application for visual note organization. It combines a free-form canvas with versioned canvases, sharing, comments, and real-time collaboration, and it is being hardened toward a self-host-friendly production model. Templates and canvas duplication are implemented but disabled for this release.

## Production Model

- Runtime: stateful Node server with Next.js App Router and a custom WebSocket server
- Required production services: PostgreSQL, Redis, S3-compatible object storage
- Target platform: the owner's shared k3s cluster (PostgreSQL 16 via CloudNativePG, Valkey, Cloudflare R2); cluster configuration lives in the private `infra` repo
- Reference self-host stack: Docker Compose, with SeaweedFS serving the S3 API under the `minio` service name; this is for local and self-host use only
- Non-goal for v1: serverless-first deployment

## Quick Start

### Development

```bash
pnpm setup:dev
pnpm dev
pnpm sync:dev   # in a second terminal: the collaborative document sync server
```

`pnpm dev` proxies `/api/collaboration/sync` to the sync server on port 3001
(`SYNC_SERVER_INTERNAL_URL`). Without it the canvas still works, but saves
through the HTTP API instead of editing live with collaborators.

What `pnpm setup:dev` does:

- prepares `.env` from `.env.example` without deleting existing state
- generates local secrets and a bootstrap token if missing
- starts PostgreSQL, Redis, and the S3-compatible object store (SeaweedFS under the `minio` service name)
- ensures the default object-storage bucket exists
- runs Prisma generate and development migrations
- optionally supports `--seed`

### Self-Host

```bash
pnpm setup:selfhost
```

What `pnpm setup:selfhost` does:

- prepares `.env.selfhost`
- generates secrets and a one-time bootstrap token
- builds and starts the full Docker Compose stack
- runs production migrations in the app container
- runs live smoke checks against the app HTTP and collaboration paths
- prints the bootstrap URL for first-run initialization

After the stack is up, open `/setup` and create the first owner account. That flow creates:

- the first owner user
- the default `Personal` workspace
- the default `Inbox` canvas

## Operator Commands

- `pnpm setup:dev`
- `pnpm setup:selfhost`
- `pnpm doctor`
- `pnpm smoke`
- `pnpm stack:up`
- `pnpm stack:down`
- `pnpm stack:logs`
- `pnpm build`
- `pnpm start`

`pnpm doctor` validates the current env file, database reachability, Redis reachability, object storage reachability, Prisma migration status, pgvector availability, and, when the app is reachable, the live HTTP/WebSocket smoke path. `pnpm smoke` runs the live app checks directly.

## Agent Foundation

The first agent/control-plane slice is now in the repo. It includes:

- owner-managed `AgentProfile` APIs under `/api/v1/agent-profiles`
- BYOK `ModelCredential` storage under `/api/agent/v1/providers`
- `IntegrationAccount` token issuance and authenticated ingress under `/api/agent/v1/integrations`
- agent-scoped canvas, item, knowledge, and action routes under `/api/agent/v1/*`
- MCP-first external transport at `/api/agent/v1/mcp`
- audited agent comment writes, grouped item writes, bulk preview checkpoints, and approved suggestion execution
- signed outbound webhook execution for approved external actions
- audited `AgentAction`, `ChangeSet`, `ChangeRecord`, `Suggestion`, `KnowledgeEntity`, `KnowledgeRelation`, `ItemEntityLink`, `WorkspaceCheckpoint`, and `AgentJob` primitives
- a read-only organizer tab on each canvas backed by `CanvasView`
- a settings-side agent control center for suggestion review, execution, and change-set rollback
- OAuth 2.1 sign-in for remote MCP clients (Claude, ChatGPT, OpenClaw, Hermes) with per-app board scope; see [docs/agents/connect-ai-apps.md](./docs/agents/connect-ai-apps.md)
- "Sort into piles": the built-in organizer (or any connected agent) proposes titled frames for loose Inbox items, applied only after approval and undoable in one step
- an instruction-only agent skill in [integrations/skills/memoria](./integrations/skills/memoria/SKILL.md)

Current limits:

- scope is canvas-level only
- inbound automation uses authenticated `integrations/*`; the old generic webhook trigger route is disabled
- outbound webhooks are currently limited to approved external-action execution through `WEBHOOK` integration accounts
- the organizer remains a derived read-only lens; it does not silently mutate the manual canvas
- derived relations remain canvas-scoped and intentionally lightweight until broader cross-canvas semantics are proven

## Stack

- Next.js 16.3.1
- TypeScript
- Prisma + PostgreSQL
- Better Auth exact-pinned to `1.7.14` (with `@better-auth/passkey`): Argon2 credentials, passkeys, and authenticator-app two-factor on database sessions
- Redis + ioredis
- TanStack Query
- Konva / react-konva
- Yjs + Hocuspocus (collaborative sync server) + ws
- Zod
- Material UI

## Environment

Use `.env.example` as the source template. Important variables:

- `DATABASE_URL`
- `REDIS_URL`
- `REDIS_KEY_PREFIX` (default `memoria:`; every Redis key and pub/sub channel
  lives under it, so a shared Valkey can limit Memoria's ACL user to
  `~memoria:*` and `&memoria:*`)
- `AUTH_URL`
- `AUTH_SECRET`
- `APP_BOOTSTRAP_TOKEN`
- `MODEL_CREDENTIAL_ENCRYPTION_KEY`
- `UPLOAD_STORAGE`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Production rules enforced by the app:

- Redis is required
- local uploads are rejected
- S3-compatible storage must be configured
- a bootstrap token must exist for first-run setup
- production email uses `sendgrid`, `resend`, or `smtp` (`SMTP_*` settings, TLS required); the `console` provider is development/test only

## Development Notes

- `pnpm build` now validates environment configuration before running `next build`
- `pnpm build` also emits the compiled custom server bundle at `dist/server.mjs`
- `pnpm start` runs the compiled custom Node server in a cross-platform way
- the collaboration server depends on the same Node runtime path as the main app

## Project Areas

- `src/app`: routes, pages, API handlers
- `src/features`: feature-specific UI
- `src/lib`: auth, validation, collaboration, caching, hooks, infrastructure helpers
- `prisma`: schema, migrations, seed
- `scripts`: setup, diagnostics, stack control

## Project State

Use this README and [ARCHITECTURE.md](./ARCHITECTURE.md) as the maintained
project documentation. [implementation/KANBAN.md](./implementation/KANBAN.md)
is the only live implementation backlog; its linked cards contain executable
scope and acceptance criteria. Superseded plans, completed cards, and audits are
available from Git history rather than retained beside live work.

## Verification

Verification is local; there is no hosted CI. `pnpm gate` is the single entry
point (`scripts/gate.mjs` also pins the Node and pnpm versions):

```bash
pnpm gate                # fast: install, prisma generate, lint, type-check, coverage, route coverage
pnpm gate build          # production build + bundle budgets
pnpm gate audit          # prod dependency audit, license inventory, GPL/AGPL denial
pnpm gate integration    # PostgreSQL integration + schema drift (TEST_DATABASE_URL, a *test* DB)
pnpm gate redis          # real Valkey under the shared-cluster ACL (~memoria:*, &memoria:*) (docker)
pnpm gate container      # clean image build + CycloneDX SBOM (docker, syft)
pnpm gate e2e            # production-image E2E + ops smoke: chromium, firefox, webkit (docker)
pnpm gate all            # every stage above
pnpm gate --list         # stage descriptions
```

Set `GATE_STRICT_RUNTIME=1` to fail (instead of warn) when the local Node or
pnpm differs from the pinned versions. Run `pnpm doctor` for environment checks.
