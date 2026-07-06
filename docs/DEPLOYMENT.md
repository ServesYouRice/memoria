# Deployment Guide

Memoria is deployed as a stateful Node application. The production path is a
container/VPS/self-host setup with PostgreSQL, Redis, and S3-compatible object
storage. Serverless platforms can serve parts of a Next.js app, but they are not
the supported v1 deployment target because the collaboration server depends on
WebSocket upgrades handled by `server.ts`.

## Local Development

```powershell
pnpm setup:dev
pnpm dev
```

`pnpm setup:dev`:

- prepares `.env` from `.env.example` without overwriting existing secrets;
- generates missing local secrets and a bootstrap token;
- starts PostgreSQL, Redis, and MinIO through Docker Compose;
- creates the configured object-storage bucket;
- runs Prisma generation and development migrations.

Open [http://localhost:3000](http://localhost:3000), then use `/setup` if the
database has not been initialized.

## Self-Hosted Deployment

```powershell
pnpm setup:selfhost
```

`pnpm setup:selfhost`:

- prepares `.env.selfhost`;
- generates production-oriented secrets and a one-time bootstrap token;
- builds and starts the Docker Compose stack;
- runs Prisma migrations in the app container;
- runs live smoke checks for HTTP and collaboration paths;
- prints the bootstrap URL for first-run setup.

The reference stack includes:

- app container running `node scripts/start-server.mjs`;
- PostgreSQL;
- Redis;
- MinIO for S3-compatible uploads.

## Production Requirements

Required environment:

- `DATABASE_URL`
- `REDIS_URL`
- `AUTH_URL`
- `AUTH_SECRET`
- `APP_BOOTSTRAP_TOKEN`
- `UPLOAD_STORAGE=s3`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Required production rules enforced by env validation:

- Redis must be configured.
- Local upload storage is rejected.
- S3-compatible storage must be complete.
- A bootstrap token must exist for first-run owner setup.

## Build And Start

```powershell
pnpm build
pnpm start
```

`pnpm build` validates environment configuration, builds the Next.js app, and
emits the compiled custom server bundle. `pnpm start` runs that custom server.

## Operations Commands

```powershell
pnpm doctor
pnpm smoke
pnpm stack:up
pnpm stack:down
pnpm stack:logs
```

`pnpm doctor` checks env configuration, database reachability, Redis
reachability, object-storage reachability, Prisma migration status, pgvector
availability, and, when the app is reachable, HTTP/WebSocket smoke paths.

`pnpm smoke` runs live app checks directly against the configured app URL.

## Health And Metrics

- `GET /api/health`: JSON health report for database and process memory.
- `GET /api/metrics`: Prometheus-compatible text metrics.

Configure uptime checks against `/api/health`. Configure metrics scraping
against `/api/metrics` from your private monitoring network or reverse proxy.

## Notes On Vercel

`vercel.json` may remain in the repository for compatibility experiments and
cron documentation, but Vercel is not the primary deployment story. A Vercel
deployment will not run the custom WebSocket server from `server.ts`, so
real-time collaboration is not complete there without a separate collaboration
service.
