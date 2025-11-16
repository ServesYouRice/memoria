# Code Audit Report - CanvasCollect
**Date:** 2025-11-14
**Auditor:** Claude
**Project:** CanvasCollect - Canvas-based note-taking app

---

## Executive Summary

This comprehensive audit identified **45 issues** across 5 categories:
- 🔴 **Critical Issues:** 8
- 🟡 **High Priority:** 12
- 🟠 **Medium Priority:** 15
- 🟢 **Low Priority:** 10

**Status:** Many TypeScript errors have been fixed. The project requires Prisma client generation and database setup to fully build and run.

---

## 🔴 Critical Issues (Must Fix Immediately)

### 1. **Multiple Next.js Configuration Files** ⚠️
**Severity:** Critical
**Location:** Root directory
**Issue:** Three Next.js config files exist simultaneously:
- `next.config.js`
- `next.config.mjs`
- `next.config.ts`

**Impact:**
- Unpredictable build behavior
- Only one will be used (Next.js precedence: .ts > .mjs > .js)
- Configuration conflicts and maintenance issues

**Action Required:**
```bash
# Keep next.config.mjs (most complete) and remove others
rm next.config.js next.config.ts

# OR consolidate all configurations into a single file
```

**Files to Review:**
- `/home/user/notes/next.config.js` - Lines 1-51
- `/home/user/notes/next.config.mjs` - Lines 1-63
- `/home/user/notes/next.config.ts` - Lines 1-21

---

### 2. **Rate Limiting Memory Leak in Serverless** ⚠️
**Severity:** Critical
**Location:** `src/middleware/rate-limit.ts`
**Issue:** `setInterval` runs at module level (Lines 15-25)

**Problem:**
```typescript
// This creates a memory leak in serverless environments
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);
```

**Impact:**
- In serverless (Vercel, AWS Lambda), intervals don't stop between invocations
- Memory accumulation over time
- Unreliable rate limiting in distributed environments

**Solution:**
```typescript
// Option 1: Lazy cleanup on access
function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

// Call in checkRateLimit before checking
export function rateLimit(config: RateLimitConfig) {
  return function checkRateLimit(request: NextRequest): NextResponse | null {
    cleanupExpired(); // Clean on each request
    // ... rest of logic
  };
}

// Option 2: Use Redis/Upstash Redis (RECOMMENDED)
// Install: pnpm add @upstash/redis
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();
```

---

### 3. **Prisma Client Not Generated** ⚠️
**Severity:** Critical
**Location:** Database layer
**Issue:** Prisma client cannot be generated due to network restrictions

**Error:**
```
Error: Failed to fetch the engine file at https://binaries.prisma.sh/...
- 403 Forbidden
```

**Impact:**
- Cannot build the project
- TypeScript errors for Prisma imports remain
- Database operations will fail at runtime

**Action Required:**
```bash
# For local development with offline mode
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 pnpm run db:generate

# For production, ensure network access or pre-generate client
# Add to .env
DATABASE_URL="postgresql://user:password@localhost:5432/canvas_collect"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here-generate-with-openssl-rand-base64-32"
```

---

### 4. **Missing Import Path Aliases** ⚠️
**Severity:** Critical
**Location:** API routes
**Issue:** Files import from `@/lib/prisma` and `@/lib/auth/auth-options` which don't exist

**Files Affected:**
- `src/app/api/v1/items/[itemId]/comments/route.ts` ✅ **FIXED**
- `src/app/api/v1/items/[itemId]/comments/[commentId]/route.ts` ✅ **FIXED**
- `src/app/api/v1/templates/route.ts` ✅ **FIXED**
- `src/app/api/v1/templates/[templateId]/route.ts` ✅ **FIXED**
- `src/app/api/v1/templates/[templateId]/use/route.ts` ✅ **FIXED**

**Status:** ✅ All fixed - now using correct imports:
- `@/lib/db` (for prisma)
- `@/lib/auth` (for auth function)

---

### 5. **In-Memory Rate Limiting Won't Scale** ⚠️
**Severity:** Critical (Production)
**Location:** `src/middleware/rate-limit.ts`
**Issue:** Using `Map` for rate limiting

**Problems:**
```typescript
const rateLimitStore = new Map<string, RateLimitEntry>(); // Line 12
```

- Not shared across server instances
- Lost on server restart
- Ineffective in serverless/edge environments
- No persistence

**Impact:**
- Rate limits won't work properly in production
- Easy to bypass with multiple IPs/containers
- Users can exceed limits across instances

**Recommended Solution:**
```typescript
// Use Upstash Redis (Vercel-friendly)
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
  analytics: true,
  prefix: '@upstash/ratelimit',
});

// Or use Vercel's built-in rate limiting
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-RateLimit-Limit', value: '100' },
          { key: 'X-RateLimit-Remaining', value: '99' },
        ],
      },
    ];
  },
};
```

---

### 6. **Auth Configuration Mismatch** ⚠️
**Severity:** High
**Location:** Authentication layer
**Issue:** Using old NextAuth v5 beta import pattern

**Current Implementation:**
```typescript
// src/lib/auth.ts
export const { handlers, auth, signIn, signOut } = NextAuth({ ... });
```

**Potential Issues:**
- NextAuth v5 is in beta (package.json: `"next-auth": "5.0.0-beta.25"`)
- API might change before stable release
- Consider pinning to specific beta version

**Action:**
- Monitor NextAuth v5 changelog
- Test auth flows thoroughly
- Consider migrating to stable v4 if issues arise

---

### 7. **Unsafe Type Assertions in Tests** ⚠️
**Severity:** Medium
**Location:** Test files
**Issue:** Using `as any` to bypass TypeScript checks

**Examples:**
```typescript
// src/__tests__/csp.test.ts - Multiple locations
(process.env as any).NODE_ENV = 'production'; // Lines 33, 43, 53

// src/__tests__/lib/errors/problem.test.ts
(problem['errors'] as any)[0].field // Line 52
```

**Better Solution:**
```typescript
// Use proper mocking
import { vi } from 'vitest';

// Mock environment
vi.stubEnv('NODE_ENV', 'production');

// Or use test-specific type utilities
type WritableProcessEnv = {
  -readonly [K in keyof NodeJS.ProcessEnv]: NodeJS.ProcessEnv[K];
};
(process.env as WritableProcessEnv).NODE_ENV = 'production';
```

---

### 8. **Missing Error Boundaries** ⚠️
**Severity:** High
**Location:** React components
**Issue:** No global error boundary for React errors

**Impact:**
- Unhandled React errors crash entire app
- Poor user experience
- No error reporting/logging

**Action Required:**
Create error boundary:
```typescript
// src/components/ErrorBoundary.tsx
'use client';
import React from 'react';

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error boundary caught:', error, errorInfo);
    // TODO: Send to error tracking service (Sentry, etc.)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div>
          <h2>Something went wrong</h2>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wrap app in layout.tsx
```

---

## 🟡 High Priority Issues

### 9. **Potential Memory Leak in useAutosave Hook**
**Severity:** High
**Location:** `src/lib/hooks/use-autosave.ts:106-113`
**Issue:** `flush` function called in cleanup depends on refs

**Problem:**
```typescript
useEffect(() => {
  return () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    flush(); // This dependency could cause issues
  };
}, [flush]); // flush changes on every render if callbacks change
```

**Impact:**
- Effect re-runs when `flush` reference changes
- Potential duplicate timers
- Race conditions in cleanup

**Solution:**
```typescript
useEffect(() => {
  return () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    // Inline flush logic to avoid dependency
    if (Object.keys(pendingChangesRef.current).length > 0) {
      const changes = { ...pendingChangesRef.current };
      pendingChangesRef.current = {};
      updateItem.mutate({
        itemId,
        data: { ...changes, version: currentVersionRef.current },
      });
    }
  };
}, [itemId, updateItem]); // Stable dependencies
```

---

### 10. **Missing Request Validation**
**Severity:** High
**Location:** Multiple API routes
**Issue:** Some routes don't validate content length/size

**Example:**
```typescript
// src/app/api/v1/canvas-items/route.ts
// No validation for content size - user could send huge objects
content: data.content as any, // Line 43
```

**Action Required:**
```typescript
// Add to validation schema
const createCanvasItemSchema = z.object({
  // ... existing fields
  content: z.object({
    text: z.string().max(100000), // 100KB limit
  }).or(z.object({
    url: z.string().url().max(2048),
    title: z.string().max(500),
  })),
});
```

---

### 11. **Inconsistent Error Handling**
**Severity:** High
**Location:** API routes
**Issue:** Mix of `throw` and `return errorResponse()`

**Examples:**
```typescript
// Some routes use throw
throw new UnauthorizedError('You must be logged in');

// Others use try-catch with errorResponse
try {
  // ...
} catch (error) {
  return errorResponse(error, request.url);
}
```

**Solution:** Standardize on one approach:
```typescript
// Recommended: Use middleware for error handling
// Create src/lib/api/error-handler.ts
export function withErrorHandler(handler: RouteHandler) {
  return async (req: NextRequest, context: any) => {
    try {
      return await handler(req, context);
    } catch (error) {
      return errorResponse(error, req.url);
    }
  };
}

// Use in routes
export const GET = withErrorHandler(async (request, { params }) => {
  // No try-catch needed
  await requireAuth();
  // ...
});
```

---

### 12. **Missing Database Indexes**
**Severity:** High
**Location:** `prisma/schema.prisma`
**Issue:** Some query patterns lack optimized indexes

**Recommendations:**
```prisma
model Canvas {
  // ... existing fields
  @@index([userId, isTemplate]) // For template listing by user
  @@index([isPublic]) // For public canvas discovery
}

model CanvasItem {
  // ... existing fields
  @@index([canvasId, createdById]) // For filtering by creator
}

model Comment {
  // ... existing fields
  @@index([itemId, createdAt]) // For chronological comments
}
```

---

### 13. **No Request Timeout Configuration**
**Severity:** High
**Location:** API routes and middleware
**Issue:** No timeout configured for long-running operations

**Impact:**
- Database queries could hang indefinitely
- API routes never timeout
- Resource exhaustion

**Solution:**
```typescript
// In prisma client initialization
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Add query timeout
  __internal: {
    engine: {
      endpoint: process.env.DATABASE_URL,
      queryTimeout: 5000, // 5 seconds
    },
  },
});

// In Next.js config
export const config = {
  api: {
    externalResolver: true,
    responseLimit: '4mb',
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
  maxDuration: 10, // 10 seconds for Vercel
};
```

---

### 14. **Viewport Filtering Done in Memory**
**Severity:** High
**Location:** `src/app/api/v1/canvas-items/route.ts:131-141`
**Issue:** Viewport filtering fetches all items then filters in JavaScript

**Problem:**
```typescript
let items = await prisma.canvasItem.findMany({
  where: baseWhere,
  orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }],
}); // Fetches ALL items

// Then filters in memory
items = items.filter((item: CanvasItem) => {
  // viewport intersection logic
});
```

**Impact:**
- Fetches all canvas items regardless of viewport
- Memory intensive for large canvases (1000+ items)
- Slow response times
- Database-to-application data transfer overhead

**Solution:**
```typescript
// Use database filtering with raw SQL or custom queries
const items = await prisma.$queryRaw<CanvasItem[]>`
  SELECT * FROM "CanvasItem"
  WHERE "canvasId" = ${query.canvasId}
    AND "deletedAt" IS NULL
    AND ("positionX" + "width") >= ${minX}
    AND "positionX" <= ${maxX}
    AND ("positionY" + "height") >= ${minY}
    AND "positionY" <= ${maxY}
  ORDER BY "zIndex" ASC, "createdAt" ASC
  LIMIT ${limit} OFFSET ${offset}
`;
```

---

### 15. **Missing CORS Configuration**
**Severity:** Medium
**Location:** API routes
**Issue:** No CORS headers configured

**Impact:**
- Can't access API from different origins
- Breaks browser-based tools/integrations
- No preflight OPTIONS handling

**Solution:**
```typescript
// src/middleware.ts or next.config.js
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add CORS headers
  response.headers.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 200, headers: response.headers });
  }

  return response;
}
```

---

### 16. **No Query Result Pagination Limits**
**Severity:** Medium
**Location:** Various GET endpoints
**Issue:** Some queries don't enforce maximum result limits

**Example:**
```typescript
// src/app/api/v1/templates/route.ts:95
const templates = await prisma.canvas.findMany({
  where,
  include: { items: { where: { deletedAt: null } } },
  // No limit! Could return thousands of templates
});
```

**Solution:**
```typescript
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const limit = Math.min(
  parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT)),
  MAX_LIMIT
);

const templates = await prisma.canvas.findMany({
  where,
  include: { items: { where: { deletedAt: null } } },
  take: limit,
  skip: parseInt(searchParams.get('offset') || '0'),
});
```

---

### 17. **Konva Bundle Size Not Optimized**
**Severity:** Medium
**Location:** `next.config.js` and `next.config.mjs`
**Issue:** Conflicting Konva optimizations

**Problem:**
```javascript
// next.config.js
konva: 'konva/lib/index-node', // Wrong - this is for Node.js

// next.config.mjs
config.externals = [...(config.externals || []), { canvas: 'canvas' }];
// Better but not complete
```

**Solution:**
```javascript
// Choose ONE config file and use:
webpack: (config, { isServer }) => {
  if (!isServer) {
    // Exclude canvas module in browser
    config.externals = {
      ...config.externals,
      canvas: 'canvas',
    };

    // Tree-shake unused Konva features
    config.resolve.alias = {
      ...config.resolve.alias,
      'konva': require.resolve('konva/lib/index.js'),
    };
  }
  return config;
},
```

---

### 18. **Missing Input Sanitization**
**Severity:** High
**Location:** Comment and content creation
**Issue:** No HTML/XSS sanitization on user input

**Example:**
```typescript
// src/app/api/v1/items/[itemId]/comments/route.ts
content: z.string().min(1).max(5000), // No sanitization
```

**Impact:**
- Stored XSS vulnerability
- Script injection in comments
- Could compromise other users

**Solution:**
```typescript
import DOMPurify from 'isomorphic-dompurify';

const createCommentSchema = z.object({
  content: z.string()
    .min(1)
    .max(5000)
    .transform((val) => DOMPurify.sanitize(val, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code'],
      ALLOWED_ATTR: [],
    })),
});
```

---

### 19. **No Rate Limiting on Auth Routes**
**Severity:** High
**Location:** Auth API routes
**Issue:** Login/register routes vulnerable to brute force

**Current:**
```typescript
// middleware.ts only applies to /api/v1/*
if (request.nextUrl.pathname.startsWith('/api/v1')) {
  const rateLimitResponse = apiRateLimit(request);
  // Auth routes like /api/auth/* not protected!
}
```

**Solution:**
```typescript
// Add to middleware
if (request.nextUrl.pathname.startsWith('/api/auth')) {
  const rateLimitResponse = authRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;
}

// Or use NextAuth built-in throttling
export const { handlers, auth } = NextAuth({
  callbacks: {
    async signIn({ user, account, profile, email, credentials }) {
      // Implement rate limiting logic
      const attempts = await getLoginAttempts(credentials.email);
      if (attempts > 5) {
        return false;
      }
      return true;
    },
  },
});
```

---

### 20. **Unhandled Promise Rejections**
**Severity:** Medium
**Location:** Throughout codebase
**Issue:** Some async operations lack error handling

**Example:**
```typescript
// src/lib/hooks/use-canvas-history.ts:91-97
await command.undo(); // If this throws, it's caught...

// But what about:
setUndoStack((prev) => prev.slice(0, -1)); // These could fail silently
setRedoStack((prev) => [...prev, command]);
```

**Recommendation:**
Add global unhandled rejection handler:
```typescript
// src/app/layout.tsx or instrumentation.ts
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    // Send to error tracking
  });
}
```

---

## 🟠 Medium Priority Issues

### 21. **Duplicate Configuration Loading**
**Severity:** Medium
**Location:** Build configuration
**Issue:** Multiple config files being processed

**Impact:**
- Slower build times
- Configuration precedence unclear
- Potential conflicts

**Action:** Remove duplicate configs (see Issue #1)

---

### 22. **Missing Database Connection Pooling Config**
**Severity:** Medium
**Location:** `src/lib/db.ts`
**Issue:** No connection pool configuration

**Recommendation:**
```typescript
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Add connection pooling for production
if (process.env.NODE_ENV === 'production') {
  prisma.$connect().catch((error) => {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  });
}
```

---

### 23. **No API Versioning Strategy**
**Severity:** Medium
**Location:** API routes
**Issue:** Using `/api/v1/` but no version migration plan

**Recommendation:**
- Document API versioning policy
- Create deprecation strategy
- Add version in response headers

```typescript
response.headers.set('X-API-Version', '1.0.0');
response.headers.set('X-API-Deprecated', 'false');
```

---

### 24. **Missing Request ID Tracking**
**Severity:** Medium
**Location:** Logging and observability
**Issue:** No correlation ID across request lifecycle

**Solution:**
```typescript
// middleware.ts
import { nanoid } from 'nanoid';

export function middleware(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') || nanoid();
  const response = NextResponse.next();

  response.headers.set('x-request-id', requestId);

  // Use in logging
  const logger = createRequestLogger({ requestId });
  // ...
}
```

---

### 25. **Inefficient Session Checks**
**Severity:** Medium
**Location:** Multiple API routes
**Issue:** Repeated `await auth()` calls in same request

**Example:**
```typescript
export async function POST(request: NextRequest) {
  const session = await auth(); // Database query
  // ...
}

export async function GET(request: NextRequest) {
  const session = await auth(); // Another database query
  // ...
}
```

**Solution:**
Cache session in request context or use middleware

---

### 26. **No Retry Logic for Database Operations**
**Severity:** Medium
**Location:** All database operations
**Issue:** No automatic retry for transient failures

**Solution:**
```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      if (isRetryable(error)) {
        await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Unreachable');
}
```

---

### 27. **Large Bundle Size**
**Severity:** Medium
**Location:** Client bundles
**Issue:** No bundle analysis configured

**Action:**
```bash
pnpm add -D @next/bundle-analyzer

# next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer(nextConfig);

# Run analysis
ANALYZE=true pnpm build
```

---

### 28. **No Health Check Endpoint Details**
**Severity:** Medium
**Location:** `src/app/api/health/route.ts`
**Issue:** Health check should include more details

**Current:**
```typescript
// Too simple - just checks if route responds
```

**Recommended:**
```typescript
export async function GET() {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  };

  const healthy = checks.database && checks.redis;

  return NextResponse.json(
    { status: healthy ? 'healthy' : 'degraded', checks },
    { status: healthy ? 200 : 503 }
  );
}
```

---

### 29. **Missing Optimistic Updates**
**Severity:** Low
**Location:** Canvas operations
**Issue:** All updates wait for server response

**Impact:**
- Sluggish UI
- Poor user experience during network delays

**Solution:**
```typescript
// In useUpdateCanvasItem
const updateItem = useMutation({
  mutationFn: updateCanvasItemApi,
  onMutate: async (newData) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: ['items', canvasId] });

    // Snapshot previous value
    const previousItems = queryClient.getQueryData(['items', canvasId]);

    // Optimistically update cache
    queryClient.setQueryData(['items', canvasId], (old) => {
      return old.map(item =>
        item.id === newData.itemId ? { ...item, ...newData.data } : item
      );
    });

    return { previousItems };
  },
  onError: (err, newData, context) => {
    // Rollback on error
    queryClient.setQueryData(['items', canvasId], context.previousItems);
  },
});
```

---

### 30. **Canvas Performance Issues**
**Severity:** Medium
**Location:** `src/features/canvas/components/Canvas.tsx`
**Issue:** Re-renders entire canvas on any item change

**Problem:**
```typescript
{items?.map((item) => {
  // All items re-render when one changes
  if (item.type === ItemType.NOTE) {
    return <NoteItem key={item.id} item={item} ... />;
  }
})}
```

**Solution:**
```typescript
// Memoize items
const MemoizedNoteItem = React.memo(NoteItem, (prev, next) => {
  return prev.item.id === next.item.id &&
         prev.item.updatedAt === next.item.updatedAt &&
         prev.isSelected === next.isSelected;
});

// Use virtualization for many items
import { useVirtualizer } from '@tanstack/react-virtual';
```

---

### 31. **No Websocket/Real-time Updates**
**Severity:** Low
**Location:** Collaboration features
**Issue:** No real-time updates for shared canvases

**Current:** Relies on polling/refetching

**Recommendation:**
```typescript
// Consider adding Pusher, Ably, or Socket.io
import Pusher from 'pusher-js';

const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
});

const channel = pusher.subscribe(`canvas-${canvasId}`);
channel.bind('item-updated', (data) => {
  queryClient.invalidateQueries(['items', canvasId]);
});
```

---

### 32. **Unused Dependencies**
**Severity:** Low
**Location:** `package.json`
**Issue:** Some dependencies might be unused

**Action:**
```bash
# Check for unused dependencies
pnpm add -D depcheck
npx depcheck

# Remove unused
pnpm remove <unused-package>
```

---

### 33. **No API Documentation**
**Severity:** Medium
**Location:** API routes
**Issue:** No OpenAPI/Swagger documentation

**Recommendation:**
```typescript
// Add swagger integration
pnpm add next-swagger-doc swagger-ui-react

// Generate from Zod schemas
import { generateOpenApiDocument } from 'zod-to-openapi';
```

---

### 34. **Missing E2E Tests**
**Severity:** Medium
**Location:** `tests/e2e/`
**Issue:** Playwright configured but limited test coverage

**Action:**
- Add more E2E tests for critical flows
- Test authentication
- Test canvas operations
- Test sharing features

---

### 35. **No Loading States**
**Severity:** Low
**Location:** UI components
**Issue:** Some components lack loading indicators

**Impact:**
- User doesn't know if action is processing
- Possible duplicate submissions

**Solution:**
Add loading states to all async actions

---

## 🟢 Low Priority Issues (Nice to Have)

### 36. **Code Duplication**
**Severity:** Low
**Location:** Various
**Issue:** Some logic duplicated across files

**Examples:**
- Session checking repeated in many routes
- Similar validation logic

**Solution:** Create shared utilities

---

### 37. **Magic Numbers**
**Severity:** Low
**Location:** Throughout
**Issue:** Hard-coded numbers without constants

**Examples:**
```typescript
max(5000) // Should be MAX_COMMENT_LENGTH
windowMs: 15 * 60 * 1000 // Should be RATE_LIMIT_WINDOW_MS
```

**Action:** Extract to constants file

---

### 38. **Missing JSDoc Comments**
**Severity:** Low
**Location:** Complex functions
**Issue:** Some complex logic lacks documentation

**Recommendation:** Add JSDoc for public APIs

---

### 39. **No Image Optimization**
**Severity:** Low
**Location:** User uploads
**Issue:** No image compression/optimization

**Recommendation:**
```typescript
// Use next/image or sharp for optimization
import Image from 'next/image';
```

---

### 40. **No Analytics Integration**
**Severity:** Low
**Location:** Application
**Issue:** No usage tracking/analytics

**Recommendation:**
- Add Vercel Analytics
- Or Google Analytics
- Track key user actions

---

### 41. **Missing Accessibility Features**
**Severity:** Low
**Location:** UI components
**Issue:** Limited ARIA labels and keyboard navigation

**Action:**
- Add ARIA labels
- Improve keyboard navigation
- Test with screen readers

---

### 42. **No Dark Mode**
**Severity:** Low
**Location:** Theme
**Issue:** No dark mode option

**Recommendation:**
Use MUI's dark mode theming

---

### 43. **Console Warnings**
**Severity:** Low
**Location:** Development
**Issue:** Potential console warnings in dev mode

**Action:**
- Remove console.logs from production
- Use proper logger

---

### 44. **Git Hooks Not Enforcing Rules**
**Severity:** Low
**Location:** `.husky/`
**Issue:** Pre-commit hooks might not catch all issues

**Recommendation:**
```json
// package.json
"lint-staged": {
  "*.{js,jsx,ts,tsx}": [
    "eslint --fix",
    "prettier --write",
    "pnpm run type-check"
  ]
}
```

---

### 45. **No Monitoring/Observability**
**Severity:** Medium
**Location:** Production
**Issue:** No error tracking or performance monitoring

**Recommendation:**
```bash
pnpm add @sentry/nextjs

# Initialize in instrumentation.ts
```

---

## 📊 Performance Audit Summary

### Bundle Sizes
- Not analyzed yet - needs `@next/bundle-analyzer`

### Recommendations:
1. ✅ Enable bundle analysis
2. ✅ Code splitting for routes
3. ✅ Lazy load Konva only on canvas routes
4. ✅ Optimize images with next/image
5. ✅ Use dynamic imports for heavy components

---

## 🔒 Security Audit Summary

### Findings:
1. ✅ CSP headers configured (middleware/csp.ts)
2. ✅ CSRF protection via NextAuth
3. ⚠️ Rate limiting needs Redis
4. ⚠️ Input sanitization needed
5. ⚠️ No WAF/DDoS protection

### Recommendations:
1. Add Vercel WAF for production
2. Implement input sanitization
3. Add rate limiting to auth routes
4. Set up security headers
5. Regular security audits

---

## 📝 Action Plan (Prioritized)

### Phase 1: Critical Fixes (Week 1)
- [ ] Remove duplicate Next.js configs
- [ ] Fix rate limiting memory leak
- [ ] Generate Prisma client properly
- [ ] Add error boundaries
- [ ] Implement proper request validation

### Phase 2: High Priority (Week 2)
- [ ] Migrate to Redis-based rate limiting
- [ ] Add database query optimizations
- [ ] Implement proper error handling strategy
- [ ] Add input sanitization
- [ ] Configure request timeouts

### Phase 3: Medium Priority (Week 3-4)
- [ ] Add API documentation
- [ ] Implement optimistic updates
- [ ] Add comprehensive E2E tests
- [ ] Set up monitoring/observability
- [ ] Optimize bundle sizes

### Phase 4: Polish (Week 5+)
- [ ] Add analytics
- [ ] Implement real-time features
- [ ] Improve accessibility
- [ ] Add dark mode
- [ ] Performance optimizations

---

## 🛠️ Quick Wins (Can Do Now)

1. **Remove duplicate configs:**
   ```bash
   rm next.config.js next.config.ts
   ```

2. **Add environment variables to .env:**
   ```bash
   cp .env.example .env
   # Fill in DATABASE_URL and NEXTAUTH_SECRET
   ```

3. **Fix rate limiting:**
   ```typescript
   // Remove setInterval, add lazy cleanup
   ```

4. **Add bundle analyzer:**
   ```bash
   pnpm add -D @next/bundle-analyzer
   ```

5. **Run type-check:**
   ```bash
   pnpm run type-check
   ```

---

## 📚 Resources

- [Next.js 15 Documentation](https://nextjs.org/docs)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)
- [NextAuth.js v5](https://authjs.dev/)
- [Upstash Redis](https://upstash.com/)
- [Vercel Security](https://vercel.com/docs/security)

---

## 🎯 Success Metrics

After implementing fixes, measure:
- [ ] TypeScript errors: 0
- [ ] Build time: < 2 minutes
- [ ] Bundle size: < 500KB (first load)
- [ ] API response time: < 500ms (p95)
- [ ] Test coverage: > 80%
- [ ] Lighthouse score: > 90

---

**Report Generated:** 2025-11-14
**Total Issues Found:** 45
**Estimated Fix Time:** 3-5 weeks
**Priority:** Address Critical and High Priority issues first

