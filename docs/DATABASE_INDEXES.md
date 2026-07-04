# Database Indexes Guide

The source of truth for indexes is `prisma/schema.prisma`. This document
summarizes the main index groups and how to verify them in a running database.

## Main Index Groups

### Identity And Auth

- `User.email` is unique.
- `Session.sessionToken` is unique.
- `Session` is indexed by `userId` and `expires`.
- `Account` is unique by provider account and indexed by `userId`.
- password reset and email verification tokens are indexed by email/token and
  expiry.

### Canvases And Items

- `Canvas` is indexed by owner, update time, template fields, public/share
  fields, and workspace.
- `CanvasItem` is indexed by canvas/deletion state, type, z-index, update time,
  spatial coordinates, and creator.
- `Comment` is indexed by item/deletion state, item creation time, user, and
  creation time.
- `ItemConnection`, `CanvasShare`, `CanvasVersion`, and `CanvasView` all carry
  relationship indexes for their common lookup paths.

### Product Features

- `Activity` is indexed by user/time and canvas/time.
- `ApiKey` is unique by key and indexed for user/key lookups.
- `IdempotencyKey` is unique by key/user/method/path and indexed for cleanup.
- Agent, knowledge, suggestion, change-set, integration, checkpoint, and job
  models are indexed around user, status, scope, agent profile, and target
  identifiers.

### Embeddings

`ItemEmbedding` is unique by item/provider/model and indexed by provider/model.
The vector is currently stored as JSON, so similarity search is not backed by a
database vector index yet.

## Verify Indexes

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

For a specific table:

```sql
\d+ "CanvasItem"
```

## Query Plan Checks

Use `EXPLAIN ANALYZE` when changing list, search, collaboration, or agent query
paths:

```sql
EXPLAIN ANALYZE
SELECT *
FROM "CanvasItem"
WHERE "canvasId" = 'example'
  AND "deletedAt" IS NULL
ORDER BY "zIndex" ASC, "createdAt" ASC;
```

Prefer seeing `Index Scan` or `Bitmap Index Scan` on large tables. PostgreSQL
may still choose sequential scans for small tables or low-selectivity filters.

## Maintenance

Refresh planner statistics:

```sql
ANALYZE;
```

Find unused indexes after a meaningful production window:

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexname NOT LIKE '%_pkey'
ORDER BY tablename, indexname;
```

Rebuild only when needed:

```sql
REINDEX TABLE "CanvasItem";
```

## Current Follow-Up Candidates

- Remove duplicate indexes that overlap unique constraints after confirming
  query plans.
- Move large thumbnails out of hot canvas list payloads.
- Plan a pgvector-backed embedding index if semantic search becomes a product
  requirement.
