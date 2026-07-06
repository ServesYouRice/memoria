Title: Server-Side Caching Strategy
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

## Context

The application started with PostgreSQL, Prisma, and TanStack Query as the main
data path. As collaboration, bookmark unfurling, and self-host production
requirements grew, Redis became part of the production runtime for shared cache
state and multi-instance coordination.

## Decision

Adopt Redis as the server-side cache and shared coordination layer where it
removes database load or supports multi-instance runtime behavior.

Current uses:

- canvas snapshot caching in `src/lib/cache/canvas-cache.ts`;
- bookmark unfurl metadata caching in `src/lib/cache/unfurl-cache.ts`;
- Redis client singleton in `src/lib/cache/redis-client.ts`;
- collaboration fanout in `src/lib/collaboration/websocket-server.ts`;
- production environment validation requiring `REDIS_URL`.

## Cache Policy

- Cache entries must have explicit TTLs.
- Mutating routes must invalidate affected canvas caches.
- Cache failures must degrade to database/external-source reads where safe.
- Production deployments must provide Redis; development can run with Redis
  through the reference Docker Compose stack.
- Cache keys should be namespaced by feature, for example `canvas:*` or
  `unfurl:*`.

## Current TTLs

| Cache | TTL | Rationale |
| --- | --- | --- |
| Canvas snapshots | 5 minutes | Avoid stale collaboration/list state for long periods. |
| Unfurl metadata | 24 hours | External page metadata changes infrequently. |

## Future Work

- Add cache hit/miss/error counters to the metrics endpoint.
- Add request instrumentation for route latency and cache impact.
- Add Redis status to `/api/health` if operator needs require it.
- Replace ad hoc cache stats that use `KEYS` with scan-based implementations
  before large deployments.

## Consequences

Positive:

- Reduces repeated database and external metadata fetches.
- Supports multi-instance collaboration fanout.
- Provides a clear production dependency instead of hidden in-memory fallbacks.

Negative:

- Adds operational dependency and failure modes.
- Requires careful invalidation on mutations.
- Needs monitoring to prove cache effectiveness.

## References

- `src/lib/cache/redis-client.ts`
- `src/lib/cache/canvas-cache.ts`
- `src/lib/cache/unfurl-cache.ts`
- `src/lib/collaboration/websocket-server.ts`
- `src/lib/env.ts`
