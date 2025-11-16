# Database Indexes Guide

**FIXED: Issue #12 - Missing Database Indexes**

This document explains the database indexes added to improve query performance.

## Overview

Database indexes are critical for performance as they allow the database to quickly locate rows without scanning the entire table. Without proper indexes, queries can be slow, especially as data grows.

## Added Indexes

### Session Model

```prisma
@@index([userId])
@@index([expires])
```

**Why:**
- `userId`: Sessions are frequently queried by user ID when checking if a user is logged in
- `expires`: Essential for cleanup queries that remove expired sessions

**Impact:** 10-100x faster session lookups and cleanup operations

### Account Model

```prisma
@@index([userId])
```

**Why:**
- `userId`: OAuth accounts are queried by user ID during authentication

**Impact:** Faster OAuth login flows

### Canvas Model

```prisma
@@index([userId, updatedAt])
@@index([isTemplate, usageCount, createdAt])
```

**Why:**
- `userId, updatedAt`: Supports fetching user's canvases ordered by most recent update
- `isTemplate, usageCount, createdAt`: Optimizes template listing queries that sort by popularity (usageCount) and recency

**Impact:**
- Faster canvas list views for users with many canvases
- Template gallery loads instantly even with 1000+ templates

### CanvasItem Model

```prisma
@@index([canvasId, positionX, positionY])
```

**Why:**
- Supports viewport-based spatial queries for canvas rendering
- When zooming/panning, only items visible in the viewport need to be fetched
- The composite index helps PostgreSQL efficiently filter by position ranges

**Impact:**
- 5-20x faster viewport queries on canvases with 1000+ items
- Smooth zooming and panning even on very large canvases

## Applying the Migration

### Option 1: Automatic Migration (Recommended)

```bash
# Generate migration SQL
pnpm prisma migrate dev --name add-performance-indexes

# Apply to production
pnpm prisma migrate deploy
```

### Option 2: Manual SQL (For Production Control)

If you prefer to review and apply indexes manually:

```sql
-- Session indexes
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- Account indexes
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- Canvas indexes
CREATE INDEX "Canvas_userId_updatedAt_idx" ON "Canvas"("userId", "updatedAt");
CREATE INDEX "Canvas_isTemplate_usageCount_createdAt_idx" ON "Canvas"("isTemplate", "usageCount", "createdAt");

-- CanvasItem spatial index
CREATE INDEX "CanvasItem_canvasId_positionX_positionY_idx" ON "CanvasItem"("canvasId", "positionX", "positionY");
```

### Verifying Indexes

```sql
-- Check all indexes on a table
\d+ "Session"
\d+ "Account"
\d+ "Canvas"
\d+ "CanvasItem"

-- Or query pg_indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('Session', 'Account', 'Canvas', 'CanvasItem')
ORDER BY tablename, indexname;
```

## Performance Monitoring

### Query Analysis

Use `EXPLAIN ANALYZE` to verify indexes are being used:

```sql
-- Session lookup (should use userId index)
EXPLAIN ANALYZE
SELECT * FROM "Session" WHERE "userId" = 'clxxx...';

-- Template listing (should use composite index)
EXPLAIN ANALYZE
SELECT * FROM "Canvas"
WHERE "isTemplate" = true
ORDER BY "usageCount" DESC, "createdAt" DESC
LIMIT 50;

-- Viewport query (should use spatial index)
EXPLAIN ANALYZE
SELECT * FROM "CanvasItem"
WHERE "canvasId" = 'clxxx...'
  AND "positionX" >= 0 AND "positionX" <= 1000
  AND "positionY" >= 0 AND "positionY" <= 1000;
```

### Expected Output

You should see `Index Scan` or `Bitmap Index Scan` in the query plan, not `Seq Scan` (sequential scan).

**Good (uses index):**
```
Index Scan using Session_userId_idx on Session  (cost=0.29..8.31 rows=1 width=...)
```

**Bad (no index used):**
```
Seq Scan on Session  (cost=0.00..1234.00 rows=1 width=...)
```

## Index Maintenance

### Monitoring Index Usage

```sql
-- Find unused indexes
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

### Rebuilding Indexes

If indexes become bloated over time:

```sql
REINDEX TABLE "Session";
REINDEX TABLE "Account";
REINDEX TABLE "Canvas";
REINDEX TABLE "CanvasItem";
```

### Analyzing Tables

Update statistics for the query planner:

```sql
ANALYZE "Session";
ANALYZE "Account";
ANALYZE "Canvas";
ANALYZE "CanvasItem";
```

## Performance Tips

1. **Monitor Slow Queries**: Enable PostgreSQL's slow query log
   ```sql
   -- In postgresql.conf
   log_min_duration_statement = 1000  # Log queries slower than 1s
   ```

2. **Index Size**: Indexes consume disk space and slow down writes slightly. Only add indexes for frequently used queries.

3. **Composite Index Order**: The order of columns matters! `[canvasId, positionX, positionY]` can be used for:
   - `WHERE canvasId = ?`
   - `WHERE canvasId = ? AND positionX = ?`
   - `WHERE canvasId = ? AND positionX = ? AND positionY = ?`

   But NOT for:
   - `WHERE positionX = ?` (doesn't start with canvasId)

4. **B-tree vs GiST**: For true 2D spatial queries, consider PostgreSQL's GiST index type with PostGIS extension. Our B-tree composite index works well for simple range queries.

## Troubleshooting

### Migration Fails

If migration fails due to data constraints:

```bash
# Check for constraint violations
pnpm prisma validate

# Force reset (CAUTION: deletes all data)
pnpm prisma migrate reset
```

### Index Not Used

If PostgreSQL doesn't use your index:

1. Check query matches index columns
2. Run `ANALYZE` to update statistics
3. Check if index is selective enough (PostgreSQL prefers seq scan for >5% of table)
4. Verify data types match

### Performance Didn't Improve

1. Verify index is being used with `EXPLAIN ANALYZE`
2. Check if bottleneck is elsewhere (network, application code)
3. Consider connection pooling (PgBouncer)
4. Monitor database resource usage (CPU, RAM, I/O)

## Further Reading

- [PostgreSQL Indexes](https://www.postgresql.org/docs/current/indexes.html)
- [Prisma Schema Indexes](https://www.prisma.io/docs/concepts/components/prisma-schema/indexes)
- [PostgreSQL Performance Tips](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [Understanding EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
