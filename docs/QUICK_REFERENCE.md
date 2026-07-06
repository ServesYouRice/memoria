# Quick Reference - Memoria

## Essential Commands

### Setup And Runtime

```bash
pnpm setup:dev       # Prepare local env and start PostgreSQL/Redis/MinIO
pnpm setup:selfhost  # Prepare and start the reference self-host stack
pnpm dev             # Start the custom dev server
pnpm build           # Validate env, build Next.js, and compile the server
pnpm start           # Start the compiled custom server
```

### Operations

```bash
pnpm doctor      # Validate env, services, migrations, and smoke paths
pnpm smoke       # Run live HTTP/WebSocket checks
pnpm stack:up    # Start the Docker Compose stack
pnpm stack:down  # Stop the Docker Compose stack
pnpm stack:logs  # Tail stack logs
```

### Testing And Quality

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm check-bundle
```

### Database

```bash
pnpm db:generate
pnpm db:migrate:dev
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

## Important URLs

- App: http://localhost:3000
- Health: http://localhost:3000/api/health
- Metrics: http://localhost:3000/api/metrics
- Setup: http://localhost:3000/setup
- Prisma Studio: http://localhost:5555

## Current Documentation

- [Project overview](../README.md)
- [Architecture](../ARCHITECTURE.md)
- [Documentation index](./README.md)
- [Deployment](./DEPLOYMENT.md)
- [API](./API.md)
- [Monitoring](./MONITORING.md)
- [Testing guide](./TESTING_GUIDE.md)
- [ADRs](./adr/)
- [Archived historical docs](./archive/)

## Production Essentials

Required production services:

- PostgreSQL
- Redis
- S3-compatible object storage

Required checks before shipping:

```bash
pnpm doctor
pnpm lint
pnpm type-check
pnpm test
pnpm build
pnpm smoke
```

## Environment Highlights

```env
DATABASE_URL="postgresql://..."
REDIS_URL="redis://..."
AUTH_URL="https://your-domain.example"
AUTH_SECRET="<32+ character random string>"
APP_BOOTSTRAP_TOKEN="<one-time setup token>"
UPLOAD_STORAGE="s3"
S3_BUCKET="memoria"
S3_REGION="us-east-1"
S3_ENDPOINT="https://s3-compatible-endpoint.example"
S3_ACCESS_KEY_ID="..."
S3_SECRET_ACCESS_KEY="..."
```

## Security And Observability

- CSP nonce middleware: `src/middleware/csp.ts`
- Security headers: `src/middleware/security-headers.ts`
- Rate limiting: `src/middleware/rate-limit.ts`
- Structured logging: `src/lib/logger/index.ts`
- Health endpoint: `src/app/api/health/route.ts`
- Metrics endpoint: `src/app/api/metrics/route.ts`

## Notes

- Historical slice checklists and point-in-time audits are in `docs/archive/`.
- `vercel.json` may exist for compatibility experiments, but the supported
  production runtime is the custom Node server.
