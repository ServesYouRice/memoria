# Architecture Overview

Memoria is a stateful Next.js application for visual note organization. The
production runtime is a custom Node server that hosts the Next.js App Router,
and a separate realtime process, built from the same image, that serves every
collaboration socket: Yjs document sync and presence.

## Runtime Model

```
Browser
  | HTTP/JSON                         | WebSocket /api/collaboration/*
  v                                   v (gateway route, or proxied by server.ts)
Custom Node server (server.ts)      Realtime process (pnpm sync:server, 3001)
  | Next.js App Router                | /sync: Hocuspocus + Yjs documents
  | API route handlers                | /:canvasId: presence, cursors, chat
  |                                   | auth, role checks, update validation
  v                                   v
PostgreSQL + Redis + S3-compatible object storage
```

The upgrade proxy in `server.ts` serves single-port and development setups.
Behind it, the realtime process sees the app as the peer, so
`TRUSTED_PROXY_CIDRS` must include the app's address for per-client limits.

Production is container oriented: the target host is the owner's shared k3s
cluster (see `AGENTS.md`, Direction). Serverless stays out because collaboration
depends on stateful WebSocket servers and shared infrastructure.

### Target topology

The direction set by the owner's handbook, ordered by the Kanban:

- **App:** Next.js + HTTP API, stateless, rolling updates. Rate limits live in
  Redis; any replica can serve any request.
- **Realtime:** the `sync` service: Hocuspocus for Yjs co-editing, saving
  every document update to PostgreSQL (IMP-042), plus the presence socket.
  Replicas share documents through the PostgreSQL update log and connection
  limits through Redis (IMP-043), so any replica can take any connection.
- **Worker and scheduler:** separate processes from the same image; the
  outbox claims jobs with `SKIP LOCKED`.
- **Data:** shared PostgreSQL 16, Valkey (Redis protocol), Cloudflare R2.

Production runs one replica of each process. The `replicas` compose profile
(`COMPOSE_PROFILES=replicas` plus `MEMORIA_APP_UPSTREAMS` and
`MEMORIA_SYNC_UPSTREAMS`, see `docker-compose.yml`) runs two app and two
realtime replicas behind the gateway.

## Core Services

- **PostgreSQL** stores users, workspaces, canvases, canvas items, comments,
  shares, templates, activities, API keys, agent audit records, and knowledge
  graph primitives.
- **Redis** is required in production for cache/shared-state support and
  collaboration fanout across instances.
- **S3-compatible object storage** is required in production for uploads.
  Production targets Cloudflare R2; the local and self-host stack runs
  SeaweedFS under the `minio` host name.
- **Better Auth** (exact-pinned) owns sign-in and server-side database
  sessions under `/api/auth/*`: Argon2 password sign-in, passkeys
  (user verification required), and authenticator-app two-factor with backup
  codes. Its endpoints are allowlisted in `src/lib/auth/server.ts`; Memoria
  keeps its own registration, email verification, reset tokens, account
  lockout, and Redis-backed auth rate limits. Every session read (proxy,
  route handlers, server components, WebSocket upgrades) goes through
  `src/lib/auth/session.ts`, and revoking a session deletes its row. The MCP
  OAuth 2.1 server (`OAuthToken`, `.well-known`) is separate.

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
- `CanvasEmbed`: owner-created, signed, revocable read-only embed of a canvas
  (token digest, allowed origins, expiry, revoked flag). Every response denies
  framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`) except
  `/embed/<token>` for a live token, which `src/proxy.ts` frames only from that
  embed's origins.
- `CanvasVersion`: point-in-time canvas snapshots for restore, with the Yjs
  state of the canvas document they were taken from.
- `CanvasDocument` / `CanvasDocumentUpdate`: the collaborative Yjs document
  of a canvas (compacted state, the updates accepted since, and the last
  `CanvasEvent` folded in). See Collaboration.
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
- `GET /api/collaboration/sync`: WebSocket upgrade to the sync server (the
  gateway routes it there; `server.ts` proxies it to
  `SYNC_SERVER_INTERNAL_URL` otherwise). The sync server's own `/health` and
  `/ready` stay on the internal network.

Versioned API responses receive `X-API-Version`,
`X-API-Version-Prefix`, and `X-API-Deprecated` headers from middleware.
Errors use RFC 7807-style problem JSON via shared error helpers.

## Collaboration

Two WebSocket services work side by side.

**Co-editing (IMP-042).** Each canvas has one Yjs document, named by the
canvas id and served by the sync server (`src/lib/collaboration/sync/`). Its
root map `items` holds one map per live item: `type`, geometry, `tags`, and
either JSON `content` or, for notes, a `text` XML fragment that TipTap edits
(`protocol.ts`). Several people can move the same item and type into the same
note at once; Yjs merges the edits.

- **Auth.** Every document connection is authenticated from the Better Auth
  session cookie (`src/lib/auth/session.ts`), or a public share token for
  guests, and authorized against ownership and shares. Viewers, commenters
  and guests are read-only connections. Access is re-checked on the presence
  socket's 30-second interval: a revoked share, link or session closes the
  connection (`memoria:forbidden`), and a role change makes the client
  authenticate again (`memoria:reauthenticate`).
- **Validation.** The server never trusts a client document. Each update is
  applied first to a private copy, every touched item is read back and
  validated with the item Zod schemas (note text against the note schema),
  capacity limits and poll gating; anything else in the update (another root,
  key, type change, foreign item id) refuses the whole update
  (`memoria:invalid-update`), and the client discards its copy and resyncs.
- **Persistence and direction.** Document to rows is synchronous: in one
  PostgreSQL transaction under the canvas lock, the sync server appends the
  update (`CanvasDocumentUpdate`), projects the touched fields onto
  `CanvasItem` rows and records `CanvasEvent`s, then applies the update to
  the live document and acknowledges it. An acknowledged edit is durable, so a
  restart loses none. Rows to document is asynchronous: HTTP, agent, trash and
  restore writes keep going through their routes, and the sync server folds
  their `CanvasEvent`s into open documents within about a second (field-level,
  last commit wins). Canvases migrate lazily on first open. `CanvasItem` rows
  stay the source for search, export, agents, the HTTP API and the accessible
  item list; version snapshots also store the document's Yjs state.
- **Client.** `CanvasBoard` opens a `CanvasDocumentSession`; while it is
  synced and writable, item writes and the note editor go through the
  document, and the board renders the document's items with row metadata.
  Otherwise writes use the HTTP API.
- **Replicas (IMP-043).** The PostgreSQL update log is the order of record.
  Every write (a client update, a row reconciliation, a compaction) holds the
  canvas row lock and first applies whatever other replicas stored since this
  one last looked, so each replica writes on top of the latest document and a
  row change is reconciled into the log exactly once. After a write the
  replica announces the canvas on Redis (`collaboration:sync:documents`);
  others pull the new updates at once, and the one-second reconcile pass
  compares update ids as a fallback. The Hocuspocus Redis extension is not
  used: it would relay updates to other replicas before they are validated
  and stored, breaking "acknowledged means durable". Document awareness is
  unused (presence has its own socket).

**Presence.** A custom `ws` server (`websocket-server.ts`), hosted by the
realtime process on the same port as sync, carries ephemeral presence,
cursors, chat, and reactions, and relays committed item events so clients
refresh rows. It:

- authenticates upgrades from Better Auth session cookies and closes
  connections whose session row was revoked or expired;
- verifies canvas ownership or shared access;
- broadcasts presence, cursor, chat, and reaction messages to connected clients;
- uses Redis pub/sub when available for multi-instance fanout;
- holds per-canvas, per-user and per-client connection limits and the
  per-client upgrade budget across replicas in Redis (leased sorted sets,
  renewed on the heartbeat, `shared-admission.ts`), falling back to
  per-process limits if Redis fails;
- does not persist collaboration messages or mutate `CanvasItem` rows.

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

Remote MCP clients sign in with OAuth 2.1 (authorization code + PKCE, dynamic
client registration). Discovery documents live at
`/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`; the MCP endpoint answers
unauthenticated requests with HTTP 401 pointing at them. Each consent creates
an `AgentProfile`, so capability rungs and canvas scope govern connected apps
exactly as they govern integration tokens. Access and refresh tokens are
stored as SHA-256 digests in `OAuthToken` and rotate on refresh.

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
