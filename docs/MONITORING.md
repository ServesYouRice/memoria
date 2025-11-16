# Monitoring & Observability Guide

> **FIXED:** Issue #45 - No monitoring/observability documentation

This guide covers setting up comprehensive monitoring and observability for CanvasCollect in production.

## Table of Contents

- [Overview](#overview)
- [Health Checks](#health-checks)
- [Request Tracing](#request-tracing)
- [Error Tracking](#error-tracking)
- [Performance Monitoring](#performance-monitoring)
- [Logging Strategy](#logging-strategy)
- [Metrics & Analytics](#metrics--analytics)
- [Alerting](#alerting)
- [Dashboard Setup](#dashboard-setup)

---

## Overview

### Current Implementation

✅ **Implemented:**
- Health check endpoint (`/api/health`)
- Request ID tracking (via middleware)
- Structured logging (Pino)
- Database connection monitoring
- Memory usage tracking
- API versioning headers

⚠️ **Recommended for Production:**
- Error tracking (Sentry)
- APM (Application Performance Monitoring)
- Log aggregation (Datadog, Logtail, or Axiom)
- Uptime monitoring (Better Uptime, Pingdom)
- Real User Monitoring (RUM)

---

## Health Checks

### Health Endpoint

**Endpoint:** `GET /api/health`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-15T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "pass",
      "responseTime": 12
    },
    "memory": {
      "status": "pass",
      "percentage": 45.2,
      "used": 512000000,
      "total": 1024000000,
      "rss": 123456789,
      "external": 5678
    }
  }
}
```

**Status Interpretation:**
- `healthy`: All systems operational
- `degraded`: Some non-critical issues (e.g., high memory)
- `unhealthy`: Critical issues (e.g., database unreachable)

**HTTP Status Codes:**
- `200`: Healthy or degraded
- `503`: Unhealthy (triggers alerts)

### Implementation

Located in `src/app/api/health/route.ts`:

```typescript
export async function GET() {
  const checks = {
    database: await checkDatabase(),
    memory: checkMemory(),
  };

  const overallStatus = determineStatus(checks);
  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: API_VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  }, { status: statusCode });
}
```

### Memory Thresholds

```typescript
const memoryPercentage = (used / total) * 100;

if (memoryPercentage > 90) {
  return { status: 'fail', ... };
} else if (memoryPercentage > 75) {
  return { status: 'warn', ... };
} else {
  return { status: 'pass', ... };
}
```

### Uptime Monitoring Setup

**Recommended Services:**

1. **Better Uptime** (Free tier available)
   ```bash
   # Setup
   - Add monitor: GET https://app.canvascollect.com/api/health
   - Check interval: 30 seconds
   - Alert on: Status code != 200
   - Timeout: 10 seconds
   ```

2. **Vercel Monitoring** (Built-in)
   - Automatically monitors all deployments
   - Dashboard: https://vercel.com/dashboard/analytics

3. **UptimeRobot** (Free tier: 50 monitors)
   ```bash
   # Setup
   - Monitor Type: HTTP(s)
   - URL: https://app.canvascollect.com/api/health
   - Interval: 5 minutes
   - Alert Contacts: Email, SMS, Slack
   ```

---

## Request Tracing

### Request IDs

Every request is assigned a unique ID for tracing through the system.

**Implementation:** `src/middleware.ts`

```typescript
import { nanoid } from 'nanoid';

export function middleware(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') || nanoid(16);

  logger.info({
    requestId,
    method: request.method,
    url: request.url,
  }, 'Incoming request');

  const response = NextResponse.next();
  response.headers.set('x-request-id', requestId);

  return response;
}
```

**Response Headers:**
```http
x-request-id: abc123def456
```

### Using Request IDs

**In Logs:**
```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger('api-handler');

export async function POST(request: NextRequest) {
  const requestId = request.headers.get('x-request-id');

  logger.info({ requestId }, 'Processing request');

  try {
    // ... handle request
    logger.info({ requestId }, 'Request completed');
  } catch (error) {
    logger.error({ requestId, error }, 'Request failed');
  }
}
```

**In Client:**
```javascript
fetch('/api/v1/canvases', {
  method: 'POST',
  headers: {
    'x-request-id': generateRequestId(), // Optional: client can provide
  }
}).then(response => {
  const requestId = response.headers.get('x-request-id');
  console.log(`Request ID: ${requestId}`);
});
```

### Distributed Tracing

For production, use OpenTelemetry or Sentry tracing:

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

**Configuration:** `instrumentation.ts`

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

---

## Error Tracking

### Sentry Integration (Recommended)

**Installation:**
```bash
pnpm add @sentry/nextjs
```

**Configuration:** `sentry.client.config.ts`

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    new Sentry.BrowserTracing(),
    new Sentry.Replay(),
  ],
});
```

**Configuration:** `sentry.server.config.ts`

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  integrations: [
    new Sentry.Integrations.Prisma({ client: prisma }),
  ],
});
```

**Global Error Handler:** `instrumentation.ts`

```typescript
export async function register() {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { default: Sentry } = await import('@sentry/nextjs');

    process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
      logger.error({ reason, promise: String(promise) }, 'Unhandled Promise Rejection');
      Sentry.captureException(reason);
    });

    process.on('uncaughtException', (error: Error) => {
      logger.error({ error, stack: error.stack }, 'Uncaught Exception');
      Sentry.captureException(error);

      if (process.env.NODE_ENV === 'production') {
        logger.fatal('Exiting due to uncaught exception');
        process.exit(1);
      }
    });
  }
}
```

**Environment Variables:**
```bash
# .env.local
SENTRY_DSN=https://your-dsn@sentry.io/project-id
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project-id
SENTRY_AUTH_TOKEN=your-auth-token
```

### Error Context

**Attach User Context:**
```typescript
import * as Sentry from '@sentry/nextjs';

export async function POST(request: NextRequest) {
  const session = await auth();

  if (session?.user) {
    Sentry.setUser({
      id: session.user.id,
      email: session.user.email,
      username: session.user.name,
    });
  }

  try {
    // ... handle request
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        endpoint: '/api/v1/canvases',
        method: 'POST',
      },
      extra: {
        requestId: request.headers.get('x-request-id'),
      },
    });

    throw error;
  }
}
```

---

## Performance Monitoring

### Application Performance Monitoring (APM)

**Recommended: Vercel Analytics (Built-in)**

```bash
pnpm add @vercel/analytics
```

**Setup:** `app/layout.tsx`

```typescript
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

**Features:**
- Real User Monitoring (RUM)
- Web Vitals tracking (LCP, FID, CLS)
- Page load performance
- API route performance

### Database Performance

**Slow Query Logging:** `src/lib/db.ts`

```typescript
import { createLogger } from './logger';

const logger = createLogger('database');

export async function logSlowQueries<T>(
  operation: () => Promise<T>,
  queryName: string,
  threshold: number = 1000
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await operation();
    const duration = Date.now() - startTime;

    if (duration > threshold) {
      logger.warn({
        query: queryName,
        duration,
        threshold,
      }, 'Slow query detected');
    }

    return result;
  } catch (error) {
    logger.error({
      query: queryName,
      error,
    }, 'Query failed');

    throw error;
  }
}
```

**Usage:**
```typescript
const canvases = await logSlowQueries(
  () => prisma.canvas.findMany({ where: { userId } }),
  'findManyCanvases'
);
```

### Bundle Size Monitoring

**Analyzer Script:** `scripts/analyze-bundle.mjs`

```bash
# Run bundle analysis
pnpm analyze

# Output
Total JS size: 2.4 MB
Shared chunks: 1.2 MB
Pages:
  /canvas/[id]: 450 KB
  /: 380 KB
```

**Thresholds:** `src/lib/constants.ts`

```typescript
export const MAX_TOTAL_BUNDLE_SIZE_KB = 3000;  // 3 MB
export const MAX_SHARED_CHUNKS_SIZE_KB = 500;  // 500 KB
export const MAX_PAGE_BUNDLE_SIZE_KB = 250;    // 250 KB
```

**CI Integration:**
```yaml
# .github/workflows/bundle-check.yml
name: Bundle Size Check

on: [pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm build
      - run: pnpm analyze
```

---

## Logging Strategy

### Structured Logging with Pino

**Logger Implementation:** `src/lib/logger.ts`

```typescript
import pino from 'pino';

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
```

**Log Levels:**
```typescript
logger.trace({ details }, 'Trace message');   // Development only
logger.debug({ details }, 'Debug message');   // Development only
logger.info({ details }, 'Info message');     // Production
logger.warn({ details }, 'Warning message');  // Production
logger.error({ details }, 'Error message');   // Production
logger.fatal({ details }, 'Fatal message');   // Production (exits)
```

### Log Aggregation

**Recommended Services:**

1. **Vercel Log Drains** (Built-in)
   ```bash
   # Configure in Vercel dashboard
   Settings > Integrations > Log Drains
   ```

2. **Datadog**
   ```bash
   pnpm add @datadog/browser-logs dd-trace
   ```

   ```typescript
   // instrumentation.ts
   import tracer from 'dd-trace';

   tracer.init({
     logInjection: true,
     analytics: true,
   });
   ```

3. **Axiom** (Serverless-friendly)
   ```bash
   pnpm add next-axiom
   ```

   ```typescript
   // app/layout.tsx
   import { AxiomWebVitals } from 'next-axiom';

   export default function RootLayout({ children }) {
     return (
       <html>
         <body>
           {children}
           <AxiomWebVitals />
         </body>
       </html>
     );
   }
   ```

### Log Retention

**Recommendation:**
- **Development:** 7 days
- **Staging:** 30 days
- **Production:** 90 days (compliance), 30 days (debug)

---

## Metrics & Analytics

### Custom Metrics

**Track Business Metrics:**
```typescript
// Track canvas creation
logger.info({
  event: 'canvas.created',
  userId: session.user.id,
  canvasId: canvas.id,
  templateUsed: false,
}, 'Canvas created');

// Track template usage
logger.info({
  event: 'template.used',
  userId: session.user.id,
  templateId: template.id,
  templateCategory: template.category,
}, 'Template used');

// Track item creation
logger.info({
  event: 'item.created',
  userId: session.user.id,
  canvasId: item.canvasId,
  itemType: item.type,
}, 'Item created');
```

**Query Metrics in Logs:**
```bash
# Count canvas creations
cat logs.json | grep 'canvas.created' | wc -l

# Get template usage by category
cat logs.json | jq 'select(.event == "template.used") | .templateCategory' | sort | uniq -c
```

### Vercel Analytics

**Setup:**
```bash
pnpm add @vercel/analytics
```

**Track Custom Events:**
```typescript
import { track } from '@vercel/analytics';

// Track button clicks
track('canvas_created', {
  template: 'blank',
  source: 'dashboard',
});

// Track feature usage
track('item_added', {
  type: 'note',
  fromTemplate: false,
});
```

---

## Alerting

### Alert Configuration

**Health Check Alerts:**
```yaml
# Better Uptime / PagerDuty
Alert: API Health Check Failed
Condition: HTTP status != 200
Threshold: 2 failures in 5 minutes
Notify: Email, Slack, SMS
Escalation: After 10 minutes -> On-call engineer
```

**Error Rate Alerts:**
```yaml
# Sentry
Alert: High Error Rate
Condition: > 10 errors per minute
Threshold: Sustained for 5 minutes
Notify: Slack #alerts channel
```

**Performance Alerts:**
```yaml
# Vercel
Alert: Slow API Response
Condition: p95 > 1000ms
Threshold: Sustained for 10 minutes
Notify: Slack #performance channel
```

**Database Alerts:**
```yaml
# Prisma / Database Provider
Alert: Connection Pool Exhausted
Condition: Active connections > 90% of pool size
Notify: Email, Slack
```

### Slack Integration

**Sentry -> Slack:**
```bash
# Sentry Dashboard
Settings > Integrations > Slack
- Select channel: #alerts
- Alert conditions: New issues, regressions
```

**Vercel -> Slack:**
```bash
# Vercel Dashboard
Integrations > Slack
- Select channel: #deployments
- Events: Deployments, errors
```

---

## Dashboard Setup

### Grafana Dashboard (Self-hosted)

```yaml
# docker-compose.yml
version: '3'
services:
  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - ./grafana:/var/lib/grafana
```

**Panels:**
1. Request rate (requests/min)
2. Error rate (%)
3. API response time (p50, p95, p99)
4. Database query time
5. Memory usage
6. Active users

### Vercel Dashboard

**Built-in Metrics:**
- Functions: Invocations, duration, errors
- Bandwidth: Total, per region
- Build time: Average, max
- Edge Requests: Count, latency

**Access:** https://vercel.com/dashboard/analytics

---

## Quick Start Guide

### Minimal Production Setup (5 minutes)

1. **Enable Vercel Analytics:**
   ```bash
   pnpm add @vercel/analytics
   ```

   ```tsx
   // app/layout.tsx
   import { Analytics } from '@vercel/analytics/react';

   export default function RootLayout({ children }) {
     return (
       <html>
         <body>
           {children}
           <Analytics />
         </body>
       </html>
     );
   }
   ```

2. **Setup Uptime Monitoring:**
   - Sign up: https://betteruptime.com
   - Add monitor: `GET https://your-app.vercel.app/api/health`
   - Alert email: your@email.com

3. **Configure Log Drains:**
   - Vercel Dashboard > Project > Settings > Log Drains
   - Add drain: Datadog, Axiom, or custom webhook

4. **Enable Error Tracking:**
   ```bash
   pnpm add @sentry/nextjs
   npx @sentry/wizard@latest -i nextjs
   ```

   Follow wizard prompts.

5. **Test:**
   ```bash
   # Trigger test error
   curl https://your-app.vercel.app/api/test-error

   # Check health
   curl https://your-app.vercel.app/api/health
   ```

---

## Production Checklist

Before going to production, ensure:

- [ ] Health endpoint returns 200
- [ ] Error tracking configured (Sentry)
- [ ] Uptime monitoring active (Better Uptime)
- [ ] Analytics enabled (Vercel Analytics)
- [ ] Log aggregation setup (Datadog/Axiom)
- [ ] Alerts configured (Slack integration)
- [ ] Request IDs in all logs
- [ ] Slow query logging enabled
- [ ] Memory thresholds configured
- [ ] Bundle size under limits
- [ ] Database connection monitoring
- [ ] Rate limiting active
- [ ] CORS configured correctly
- [ ] CSP headers enabled

---

## Troubleshooting

### High Memory Usage

```bash
# Check memory in production
curl https://your-app.vercel.app/api/health | jq '.checks.memory'

# Expected response
{
  "status": "warn",
  "percentage": 78.5,
  "used": 805306368,
  "total": 1024000000
}
```

**Solutions:**
- Increase function memory in `vercel.json`
- Optimize large queries
- Enable pagination
- Clear in-memory caches

### Slow API Responses

```bash
# Enable slow query logging
LOG_LEVEL=debug pnpm dev

# Check logs for queries > 1s
cat logs.json | jq 'select(.duration > 1000)'
```

**Solutions:**
- Add database indexes
- Enable query result caching
- Optimize N+1 queries
- Use viewport-based pagination

### High Error Rate

```bash
# Check Sentry dashboard
# Or query logs
cat logs.json | grep 'level":"error"' | wc -l
```

**Solutions:**
- Review error stack traces
- Check for deployment issues
- Verify database connectivity
- Review recent code changes

---

## Resources

- **Vercel Observability:** https://vercel.com/docs/observability
- **Sentry Documentation:** https://docs.sentry.io/platforms/javascript/guides/nextjs/
- **Pino Logger:** https://getpino.io/
- **OpenTelemetry:** https://opentelemetry.io/
- **Better Uptime:** https://betteruptime.com/
- **Datadog:** https://docs.datadoghq.com/

---

**Last Updated:** 2025-11-15
**Status:** Production-ready setup documented
