# Architecture Overview

Memoria is a stateful Next.js application for visual note organization. The
production runtime is a custom Node server that hosts the Next.js App Router and
the WebSocket collaboration server in the same process.

## Runtime Model

```
Browser
  | HTTP/JSON
  v
Custom Node server (server.ts)
  | Next.js App Router
  | API route handlers
  | WebSocket upgrades at /api/collaboration/:canvasId
  v
PostgreSQL + Redis + S3-compatible object storage
```

Production is self-host/VPS/container oriented. Serverless-first deployment is
not the primary target because collaboration depends on a stateful WebSocket
server and shared infrastructure.

## Core Services

- **PostgreSQL** stores users, workspaces, canvases, canvas items, comments,
  shares, templates, activities, API keys, agent audit records, and knowledge
  graph primitives.
- **Redis** is required in production for cache/shared-state support and
  collaboration fanout across instances.
- **S3-compatible object storage** is required in production for uploads. The
  reference self-host stack uses MinIO.
- **Auth.js / NextAuth** provides session handling with credentials auth,
  argon2 password verification, email verification, reset tokens, and account
  lockout logic.

## Application Areas

- `src/app`: pages, layouts, setup flow, API routes, and health/metrics
  endpoints.
- `src/features`: feature-specific UI for auth, dashboard, canvas, and agents.
- `src/lib`: shared server/client utilities, auth, validation, hooks, caching,
  collaboration, agents, rate limiting, logging, and security helpers.
- `prisma`: schema, seed, and migrations.
- `scripts`: setup, build, diagnostics, stack control, smoke checks, backup, and
  restore utilities.

## Data Model

The main domain objects are:

- `Workspace`: groups canvases for a user.
- `Canvas`: board metadata, sharing, template metadata, versions, views, and
  thumbnail state.
- `CanvasItem`: normalized geometry and JSON content for notes, bookmarks,
  images, drawings, shapes, arrows, text, frames, embeds, and polls.
- `CanvasShare`: email-based canvas access with `VIEW`, `COMMENT`, or `EDIT`.
- `CanvasVersion`: point-in-time canvas snapshots for restore.
- `Activity`: dashboard and notification events.
- Agent models: `AgentProfile`, `ModelCredential`, `IntegrationAccount`,
  `AgentAction`, `ChangeSet`, `ChangeRecord`, `Suggestion`,
  `KnowledgeEntity`, `KnowledgeRelation`, `ItemEntityLink`,
  `WorkspaceCheckpoint`, `CanvasView`, and `AgentJob`.

Writes use Zod validation at API boundaries and Prisma for parameterized
database access. Canvas item updates retain optimistic version fields for the
HTTP/autosave path.

## API Shape

Most user-facing API routes live under `/api/v1/*`. Agent-control routes live
under `/api/agent/v1/*`. Operational endpoints include:

- `GET /api/health`: database and process health.
- `GET /api/metrics`: Prometheus-compatible process/application metrics.
- `POST /api/csp-report`: CSP violation reports.
- `GET /api/collaboration/:canvasId`: WebSocket upgrade path handled by
  `server.ts`, not by a serverless route.

Versioned API responses receive `X-API-Version`,
`X-API-Version-Prefix`, and `X-API-Deprecated` headers from middleware.
Errors use RFC 7807-style problem JSON via shared error helpers.

## Collaboration

Real-time collaboration uses Yjs documents over a custom `ws` WebSocket server.
The server:

- authenticates upgrades from Auth.js/NextAuth session cookies;
- verifies canvas ownership or shared access;
- broadcasts Yjs updates and presence to connected clients;
- uses Redis pub/sub when available for multi-instance fanout;
- persists document state back into `CanvasItem` rows on a debounced interval.

HTTP polling remains available for non-collaboration views and fallback
refreshes.

## Caching

Redis-backed cache helpers currently cover canvas snapshots and bookmark unfurl
metadata. Mutating canvas-item routes invalidate the relevant canvas cache.
Unfurl metadata is cached with a longer TTL because external page metadata
changes less frequently.

## Agent Foundation

The first agent/control-plane slice is implemented. It supports owner-managed
agent profiles, BYOK model credentials, integration-token ingress, MCP tool
transport, audited canvas/item/knowledge/action routes, suggestion approval and
execution, signed outbound webhook actions, rollback-capable change sets, and a
read-only organizer view.

Current agent limits remain intentionally conservative:

- scope is canvas-level only;
- generic inbound webhooks are disabled;
- approved external-action execution is the outbound webhook path;
- derived relations are canvas-scoped;
- the organizer is a read-only derived lens.

## Security Layers

- Strict environment validation with production invariants for Redis, S3, and
  bootstrap setup.
- CSP nonce propagation through middleware, layout, and Emotion.
- Security headers and CORS middleware.
- SSRF-protected metadata fetching for unfurling.
- API and auth rate limiting in middleware.
- Structured logging with request IDs and redaction.
- Soft deletes and audit fields for canvas items.
- Idempotency-key handling for selected mutation routes.

## Operations

The supported operational path is:

```bash
pnpm setup:dev
pnpm doctor
pnpm smoke
pnpm build
pnpm start
```

Self-host setup is driven by:

```bash
pnpm setup:selfhost
pnpm stack:up
pnpm stack:logs
pnpm stack:down
```

Before shipping, run:

```bash
pnpm doctor
pnpm lint
pnpm type-check
pnpm test
pnpm build
pnpm smoke
```
