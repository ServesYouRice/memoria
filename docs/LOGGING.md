# Logging Best Practices

> **FIXED:** Issue #36 - Console logs in production

This project uses **Pino** for structured logging instead of `console.*` methods.

## Why Not Console?

❌ **Don't use:**
```typescript
console.log('User logged in');
console.error('Database error:', error);
console.warn('Deprecated feature used');
```

✅ **Use instead:**
```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth');

logger.info('User logged in');
logger.error({ error }, 'Database error');
logger.warn('Deprecated feature used');
```

## Benefits of Structured Logging

1. **Structured Data**: Log events with contextual data
2. **Searchable**: Easily query logs in production
3. **Performance**: Pino is one of the fastest Node.js loggers
4. **Standard Format**: JSON output for log aggregation services
5. **Log Levels**: Filter logs by severity in production

## Usage

### Creating a Logger

```typescript
import { createLogger } from '@/lib/logger';

// Create a named logger for your module
const logger = createLogger('api:canvases');
```

### Log Levels

```typescript
// TRACE: Very detailed information (development only)
logger.trace({ details }, 'Trace message');

// DEBUG: Debugging information (development only)
logger.debug({ userId, action }, 'Debug message');

// INFO: General informational messages
logger.info({ userId }, 'User logged in');

// WARN: Warning messages (potential issues)
logger.warn({ feature }, 'Deprecated feature used');

// ERROR: Error messages (needs attention)
logger.error({ error, userId }, 'Failed to create canvas');

// FATAL: Fatal errors (application will exit)
logger.fatal({ error }, 'Database connection failed');
```

### Adding Context

```typescript
// Add structured data for better debugging
logger.info({
  requestId: req.headers.get('x-request-id'),
  userId: session.user.id,
  canvasId: canvas.id,
  duration: 150,
}, 'Canvas created successfully');

// This produces JSON output:
{
  "level": "info",
  "time": "2025-11-15T12:00:00.000Z",
  "name": "api:canvases",
  "requestId": "abc123",
  "userId": "user_123",
  "canvasId": "canvas_456",
  "duration": 150,
  "msg": "Canvas created successfully"
}
```

### Error Logging

```typescript
try {
  await prisma.canvas.create({ ... });
} catch (error) {
  logger.error({
    error,
    userId: session.user.id,
    data: validatedData,
  }, 'Failed to create canvas');

  throw error;
}
```

## ESLint Rule

The project has an ESLint rule to prevent `console.*` usage:

```javascript
// eslint.config.mjs
{
  rules: {
    'no-console': 'error', // Prevents all console.* calls
  }
}
```

If you need to bypass this rule (rare cases):

```typescript
// eslint-disable-next-line no-console
console.log('Allowed in specific cases');
```

## Logging in Different Environments

### Development

```bash
# Set log level to debug
LOG_LEVEL=debug pnpm dev
```

**Output:** Pretty-printed, colorized logs

### Production

```bash
# Set log level to info (default)
LOG_LEVEL=info pnpm start
```

**Output:** JSON logs for aggregation services

### Testing

```bash
# Disable logs during tests
LOG_LEVEL=silent pnpm test
```

## Log Aggregation

In production, logs should be sent to a log aggregation service:

- **Datadog**: Full-featured APM and logging
- **Axiom**: Serverless-friendly, fast search
- **Logtail**: Simple, affordable logging
- **Container log collectors**: Promtail, Vector, Fluent Bit, or your platform
  collector for self-hosted deployments

See [MONITORING.md](./MONITORING.md) for setup instructions.

## Common Patterns

### API Routes

```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:canvases');

export async function GET(request: NextRequest) {
  const requestId = request.headers.get('x-request-id');

  logger.info({ requestId }, 'Fetching canvases');

  try {
    const canvases = await prisma.canvas.findMany({ ... });

    logger.info({
      requestId,
      count: canvases.length,
    }, 'Canvases fetched successfully');

    return NextResponse.json({ canvases });
  } catch (error) {
    logger.error({
      requestId,
      error,
    }, 'Failed to fetch canvases');

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

### React Components

For client-side logging, avoid excessive logging. Use logger sparingly:

```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger('canvas');

export function Canvas() {
  const handleError = (error: Error) => {
    // Only log significant errors
    logger.error({ error, canvasId }, 'Failed to save canvas');
  };

  return <div>...</div>;
}
```

### Middleware

```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger('middleware');

export function middleware(request: NextRequest) {
  const requestId = nanoid(16);

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

## Performance Considerations

Pino is designed for performance:

- **Asynchronous**: Doesn't block the event loop
- **Fast Serialization**: Optimized JSON stringification
- **Minimal Overhead**: < 1ms per log in most cases

However, avoid logging in hot paths:

```typescript
// ❌ Don't log in tight loops
for (let i = 0; i < 10000; i++) {
  logger.debug({ i }, 'Processing item'); // Bad!
}

// ✅ Log summary instead
logger.info({ count: 10000 }, 'Processed items');
```

## Troubleshooting

### Logs Not Appearing

1. Check `LOG_LEVEL` environment variable
2. Ensure logger is created with correct name
3. Verify log statements have correct level

### Too Many Logs

1. Increase `LOG_LEVEL` to `info` or `warn`
2. Remove debug statements from hot paths
3. Use conditional logging for verbose operations

### JSON Output Hard to Read

Use Pino's pretty printer in development:

```bash
pnpm add -D pino-pretty

# Run with pretty output
pnpm dev | pnpm exec pino-pretty
```

---

## Reference

- **Pino Documentation:** https://getpino.io/
- **Best Practices:** https://getpino.io/#/docs/best-practices
- **API Reference:** https://getpino.io/#/docs/api

---

**Last Updated:** 2025-11-15
**Issue:** #36 - Console logs in production
