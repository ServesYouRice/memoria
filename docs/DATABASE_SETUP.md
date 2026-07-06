# Database Setup Guide

Memoria uses PostgreSQL through Prisma. The supported local path is the project
setup script, which starts PostgreSQL, Redis, and MinIO through Docker Compose.

## Quick Start

```powershell
pnpm setup:dev
pnpm dev
```

The setup command prepares `.env`, starts required services, generates Prisma,
runs development migrations, and ensures object storage is ready.

## Manual Commands

```powershell
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed
pnpm db:studio
```

For production/self-host containers:

```powershell
pnpm db:migrate
```

## Required Connection

Development and production both require:

```env
DATABASE_URL="postgresql://user:password@host:5432/database"
```

Production also requires Redis and S3-compatible upload configuration. See
[`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full environment list.

## Schema Areas

The Prisma schema currently includes:

- users, sessions, accounts, verification tokens, and reset tokens;
- workspaces, canvases, canvas items, comments, shares, versions, and item
  connections;
- templates through `Canvas` template fields;
- activity feed records;
- API keys and idempotency keys;
- agent profiles, model credentials, integration accounts, actions, change
  sets, suggestions, knowledge entities, knowledge relations, checkpoints,
  canvas views, and jobs;
- item embeddings.

See `prisma/schema.prisma` for the complete source of truth.

## Validation And Drift Checks

```powershell
pnpm prisma validate
pnpm db:generate
pnpm doctor
```

`pnpm doctor` checks database reachability and Prisma migration status in
addition to Redis, object storage, and live smoke paths when available.

## Backup And Restore

Operational backup scripts are available:

```powershell
scripts/backup-database.sh --environment prod --dry-run
scripts/restore-database.sh --backup-date 2026-07-04 --dry-run
```

See [`operations/DATABASE_BACKUP_POLICY.md`](./operations/DATABASE_BACKUP_POLICY.md)
and [`operations/RESTORE_PROCEDURES.md`](./operations/RESTORE_PROCEDURES.md).

## Troubleshooting

- Run `pnpm doctor` first; it catches most environment and service issues.
- If Prisma client types are missing, run `pnpm db:generate`.
- If a development migration fails while experimenting, inspect the failed
  migration before using `pnpm prisma migrate reset`, which deletes local data.
- If production migrations fail, resolve the migration state deliberately with
  Prisma's migration commands; do not reset production data.
