# Memoria

Memoria is a stateful Node application for visual note organization. It combines a free-form canvas with versioned canvases, templates, sharing, comments, and real-time collaboration, and it is being hardened toward a self-host-friendly production model.

## Production Model

- Runtime: stateful Node server with Next.js App Router and a custom WebSocket server
- Required production services: PostgreSQL, Redis, S3-compatible object storage
- Reference self-host stack: Docker Compose + MinIO
- Primary deployment target: self-host or VPS/container hosting
- Non-goal for v1: serverless-first deployment

## Quick Start

### Development

```bash
pnpm setup:dev
pnpm dev
```

What `pnpm setup:dev` does:

- prepares `.env` from `.env.example` without deleting existing state
- generates local secrets and a bootstrap token if missing
- starts PostgreSQL, Redis, and MinIO
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

Current limits:

- scope is canvas-level only
- inbound automation uses authenticated `integrations/*`; the old generic webhook trigger route is disabled
- outbound webhooks are currently limited to approved external-action execution through `WEBHOOK` integration accounts
- the organizer remains a derived read-only lens; it does not silently mutate the manual canvas
- derived relations remain canvas-scoped and intentionally lightweight until broader cross-canvas semantics are proven

## Stack

- Next.js 16.2
- TypeScript
- Prisma + PostgreSQL
- Auth.js / NextAuth v5 exact-pinned to `5.0.0-beta.31`; upstream still exposes the Next.js package on the beta track
- Redis + ioredis
- TanStack Query
- Konva / react-konva
- Yjs + ws
- Zod
- Material UI

## Environment

Use `.env.example` as the source template. Important variables:

- `DATABASE_URL`
- `REDIS_URL`
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
- SMTP is intentionally disabled in this build
- production email requires `sendgrid` or `resend`; the `console` provider is development/test only

## Development Notes

- `pnpm build` now validates environment configuration before running `next build`
- `pnpm build` also emits the compiled custom server bundle at `dist/server.mjs`
- `pnpm start` runs the compiled custom Node server in a cross-platform way
- the collaboration server depends on the same Node runtime path as the main app
- Vercel config may still exist in the repo, but it is no longer the primary deployment story

## Project Areas

- `src/app`: routes, pages, API handlers
- `src/features`: feature-specific UI
- `src/lib`: auth, validation, collaboration, caching, hooks, infrastructure helpers
- `prisma`: schema, migrations, seed
- `scripts`: setup, diagnostics, stack control

## Project State

Use this README and [ARCHITECTURE.md](./ARCHITECTURE.md) as the maintained
project documentation. [REMAINING-WORK.md](./REMAINING-WORK.md) contains only
verified unfinished work and should be updated whenever an item is closed.

## Verification

Recommended checks before shipping:

```bash
pnpm doctor
pnpm lint
pnpm type-check
pnpm build
pnpm test
```
