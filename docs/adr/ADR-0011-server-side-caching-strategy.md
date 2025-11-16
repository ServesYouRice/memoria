Title: Server-Side Caching Strategy (Deferred with Triggers)
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

## Context

The MVP architecture relies on:
- PostgreSQL with proper indexing for data persistence
- TanStack Query for client-side caching
- Direct database queries for all API endpoints

This approach is sufficient for early-stage usage. However, as the application scales, server-side caching may be required to:
- Reduce database load
- Improve response times for frequently accessed data
- Support higher concurrent user counts
- Cache expensive operations (e.g., bookmark unfurling, canvas snapshots)

**Problem:** Introducing caching prematurely adds operational complexity, cache invalidation challenges, and increased infrastructure costs without proven need.

**Solution:** Define clear, measurable triggers that indicate when caching should be introduced.

## Decision

**Defer server-side caching until one or more triggers are met. When triggered, introduce Redis as the caching layer.**

### Triggers for Cache Implementation

Implement server-side caching when ANY of these conditions are met:

1. **Performance Degradation:**
   - API endpoint P95 latency > 500ms for 3+ consecutive days
   - Database CPU utilization > 70% sustained for 24+ hours
   - Query execution times > 200ms on indexed queries

2. **Scale Thresholds:**
   - Total canvas items across all users > 100,000
   - Individual canvas item count > 1,000 items
   - Concurrent active users > 500

3. **Specific Feature Requirements:**
   - Bookmark unfurling implemented (Phase 2) - cache unfurled metadata
   - Real-time collaboration active (Phase 3) - cache canvas snapshots for fast joins

4. **Cost Optimization:**
   - Database read operations exceed budget thresholds
   - Repeated expensive queries identified in logs (same query > 100x/hour)

### Caching Strategy

When triggers are met, implement caching in this order:

#### Tier 1: Read-Through Cache (Immediate Relief)
**What to cache:**
- Canvas snapshots (full canvas state)
- User profile data
- Canvas metadata (name, owner, item count)

**Implementation:**
```typescript
// Example: Canvas cache
async function getCanvas(canvasId: string) {
  const cacheKey = `canvas:${canvasId}`

  // Try cache first
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  // Cache miss: query database
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    include: { items: { where: { deletedAt: null } } }
  })

  // Store in cache with TTL
  await redis.setex(cacheKey, 300, JSON.stringify(canvas)) // 5 min TTL

  return canvas
}
```

**Cache TTL:**
- Canvas snapshots: 5 minutes
- User profiles: 1 hour
- Canvas metadata: 10 minutes

#### Tier 2: Write-Through Cache (Consistency)
**What to cache:**
- Canvas items (invalidate on update)
- User sessions (already handled by Auth.js, but could move to Redis)

**Invalidation Strategy:**
```typescript
// Invalidate cache on write
async function updateCanvasItem(itemId: string, data: UpdateData) {
  const item = await prisma.canvasItem.update({
    where: { id: itemId },
    data
  })

  // Invalidate canvas cache
  await redis.del(`canvas:${item.canvasId}`)

  return item
}
```

#### Tier 3: Application-Level Cache (Expensive Operations)
**What to cache:**
- Bookmark unfurling results (Phase 2)
- Aggregated metrics (canvas item counts, user statistics)
- Search results (if search feature added)

**Example: Unfurl cache**
```typescript
async function unfurlBookmark(url: string) {
  const cacheKey = `unfurl:${hashUrl(url)}`

  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const metadata = await fetchAndParseMetadata(url)

  // Cache for 7 days (unfurled data rarely changes)
  await redis.setex(cacheKey, 604800, JSON.stringify(metadata))

  return metadata
}
```

## Technology Choice: Redis

**Selected:** Redis (via `ioredis` client)

**Why Redis?**
- Industry-standard for caching
- Rich data structures (strings, hashes, lists, sets)
- Built-in TTL support
- Pub/sub for cache invalidation across instances
- Battle-tested, mature ecosystem
- Easy to deploy (Redis Cloud, AWS ElastiCache, self-hosted)

**Alternatives Considered:**
- **Memcached:** Simpler but less feature-rich, no persistence
- **Database-level caching:** Insufficient for high-traffic scenarios
- **In-memory JS cache:** Not suitable for multi-instance deployments
- **CDN caching:** Only helps with static assets, not API responses

## Implementation Plan

### Phase 1: Infrastructure Setup
- [ ] Provision Redis instance (Redis Cloud or Docker for local dev)
- [ ] Install `ioredis` dependency
- [ ] Create Redis client singleton (`/src/lib/redis.ts`)
- [ ] Add Redis connection to health check endpoint
- [ ] Configure environment variables (`REDIS_URL`)

### Phase 2: Implement Read-Through Cache
- [ ] Wrap canvas queries with cache layer
- [ ] Add cache metrics to `/api/metrics` (hit rate, miss rate)
- [ ] Monitor cache effectiveness (should see reduced DB queries)

### Phase 3: Cache Invalidation
- [ ] Implement invalidation on canvas item mutations
- [ ] Add cache invalidation to Prisma middleware
- [ ] Test consistency across multiple tabs/users

### Phase 4: Application Cache
- [ ] Add unfurl cache (when Phase 2 implemented)
- [ ] Add canvas snapshot cache (when Phase 3 collaboration active)
- [ ] Implement cache warming for popular canvases

## Cache Configuration

### Default Settings
```typescript
// /src/lib/redis.ts
import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000)
  },
  lazyConnect: true, // Don't block startup if Redis is down
})

// Graceful degradation: if Redis is unavailable, skip cache
export async function cachedQuery<T>(
  key: string,
  ttl: number,
  fallback: () => Promise<T>
): Promise<T> {
  try {
    const cached = await redis.get(key)
    if (cached) return JSON.parse(cached)
  } catch (err) {
    logger.warn({ err, key }, 'Cache read failed, using fallback')
  }

  const result = await fallback()

  try {
    await redis.setex(key, ttl, JSON.stringify(result))
  } catch (err) {
    logger.warn({ err, key }, 'Cache write failed')
  }

  return result
}
```

### Monitoring

Track these metrics in `/api/metrics`:
- `cache_hits_total` (counter)
- `cache_misses_total` (counter)
- `cache_errors_total` (counter)
- `cache_latency_seconds` (histogram)
- `cache_size_bytes` (gauge)

**Target Hit Rate:** > 80% after warmup period

## Consequences

**Positive:**
- Clear, measurable triggers prevent premature optimization
- Redis is a proven, scalable solution
- Graceful degradation keeps the app functional if cache is down
- Can scale horizontally by adding Redis replicas

**Negative:**
- Adds operational complexity (Redis infrastructure, monitoring)
- Cache invalidation is a source of bugs if not carefully implemented
- Increased infrastructure costs (~$30-100/month for managed Redis)
- Need to handle cache consistency edge cases

**Neutral:**
- Monitoring reveals whether caching is actually helping
- May need to adjust TTL values based on real-world usage patterns

## Rollback Plan

If caching causes issues:
1. Set environment variable `DISABLE_CACHE=true` to bypass Redis
2. Monitor database performance - if it degrades, scale database vertically
3. Investigate cache inconsistencies via logs and metrics
4. Roll back code changes if cache layer is causing bugs

## References

- SENATE.md §3.7 (Performance & Scalability - caching deferred)
- ADR-0006 (Observability - metrics for monitoring cache effectiveness)
- ADR-0009 (Autosave & Concurrency - ensure cache doesn't break version control)
- Redis Best Practices: https://redis.io/docs/manual/patterns/
- TanStack Query: https://tanstack.com/query (client-side caching in place)
