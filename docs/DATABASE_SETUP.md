# Database Setup Guide

This guide helps you set up the PostgreSQL database and Prisma client for CanvasCollect.

## Quick Start

```bash
# 1. Run the automated setup script
./scripts/setup-database.sh

# 2. Start the development server
pnpm run dev
```

---

## Manual Setup

If you prefer to set up manually or the script doesn't work, follow these steps:

### 1. Install PostgreSQL

**macOS (Homebrew):**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download and install from https://www.postgresql.org/download/windows/

**Docker (Recommended for Development):**
```bash
docker run --name canvas-postgres \
  -e POSTGRES_USER=canvasuser \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=canvas_collect \
  -p 5432:5432 \
  -d postgres:15-alpine
```

### 2. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database and user
CREATE DATABASE canvas_collect;
CREATE USER canvasuser WITH ENCRYPTED PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE canvas_collect TO canvasuser;
\q
```

### 3. Configure Environment Variables

```bash
# Copy example .env file
cp .env.example .env

# Edit .env and set:
DATABASE_URL="postgresql://canvasuser:yourpassword@localhost:5432/canvas_collect"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
NEXTAUTH_URL="http://localhost:3000"
```

### 4. Generate Prisma Client

```bash
# Standard generation
pnpm run db:generate

# If you're offline or behind a proxy:
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 pnpm run db:generate
```

**Troubleshooting Prisma Generation:**

If you get "403 Forbidden" errors:
```bash
# Option 1: Use offline mode
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 pnpm prisma generate

# Option 2: Set custom binary targets
# Add to prisma/schema.prisma:
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}

# Option 3: Use environment variable for custom engine path
PRISMA_QUERY_ENGINE_BINARY=/path/to/engine pnpm prisma generate
```

### 5. Run Migrations

```bash
# For development (creates migration files)
pnpm run db:migrate:dev

# For production (runs existing migrations)
pnpm run db:migrate
```

### 6. Seed Database (Optional)

```bash
pnpm run db:seed
```

---

## Environment Variables

Create a `.env` file in the project root with these variables:

```bash
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/canvas_collect"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# Optional
NODE_ENV="development"
LOG_LEVEL="info"
```

**Generate secure secrets:**
```bash
# For NEXTAUTH_SECRET
openssl rand -base64 32

# Alternative (Node.js)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Database Commands

### Prisma CLI Commands

```bash
# Generate Prisma Client
pnpm run db:generate

# Create and run migrations (development)
pnpm run db:migrate:dev

# Run existing migrations (production)
pnpm run db:migrate

# Reset database (WARNING: deletes all data)
pnpm prisma migrate reset

# Open Prisma Studio (GUI for database)
pnpm run db:studio

# Validate schema
pnpm prisma validate

# Format schema file
pnpm prisma format
```

### Useful PostgreSQL Commands

```bash
# Connect to database
psql -U canvasuser -d canvas_collect

# List all tables
\dt

# Describe table structure
\d "User"

# View table contents
SELECT * FROM "User";

# Check database size
SELECT pg_size_pretty(pg_database_size('canvas_collect'));

# Exit psql
\q
```

---

## Production Deployment

### Vercel + Vercel Postgres

1. Create a Vercel Postgres database:
   ```bash
   vercel postgres create
   ```

2. Link to your project:
   ```bash
   vercel link
   vercel env pull
   ```

3. Run migrations:
   ```bash
   pnpm run db:migrate
   ```

### Vercel + External PostgreSQL

1. Add environment variable in Vercel dashboard:
   ```
   DATABASE_URL="postgresql://..."
   ```

2. Add build command in `vercel.json`:
   ```json
   {
     "buildCommand": "pnpm prisma generate && pnpm build"
   }
   ```

### Railway

1. Create PostgreSQL database in Railway dashboard

2. Copy connection string to `.env`:
   ```
   DATABASE_URL="postgresql://postgres:..."
   ```

3. Deploy:
   ```bash
   railway up
   ```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["pnpm", "start"]
```

---

## Troubleshooting

### "Error: P1001: Can't reach database server"

**Causes:**
- PostgreSQL not running
- Wrong host/port in DATABASE_URL
- Firewall blocking connection

**Solutions:**
```bash
# Check if PostgreSQL is running
pg_isready

# Check PostgreSQL status
sudo systemctl status postgresql  # Linux
brew services list  # macOS

# Restart PostgreSQL
sudo systemctl restart postgresql  # Linux
brew services restart postgresql@15  # macOS
```

### "Error: P3009: migrate found failed migrations"

**Solution:**
```bash
# Mark failed migration as rolled back
pnpm prisma migrate resolve --rolled-back <migration-name>

# Then run migrations again
pnpm run db:migrate:dev
```

### "Error: P2002: Unique constraint failed"

**Causes:**
- Duplicate data
- Seeding database multiple times

**Solution:**
```bash
# Reset database and reseed
pnpm prisma migrate reset
```

### "Module not found: @prisma/client"

**Solution:**
```bash
# Regenerate Prisma Client
pnpm run db:generate

# If still failing, clean install
rm -rf node_modules .next
pnpm install
pnpm run db:generate
```

### "Prisma engine binaries download fails (403)"

This is Issue #3 from the audit report. **Solutions:**

```bash
# Option 1: Ignore checksums (development only)
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 pnpm prisma generate

# Option 2: Use pre-downloaded engines
# Download from: https://github.com/prisma/prisma-engines/releases
# Then set environment variable:
PRISMA_QUERY_ENGINE_BINARY=/path/to/query-engine pnpm prisma generate

# Option 3: Use Docker with pre-built image
docker run --rm -v $(pwd):/app -w /app node:20-alpine sh -c "
  npm install -g pnpm &&
  pnpm install &&
  pnpm prisma generate
"
```

---

## Database Schema

The current schema includes:

- **User** - User accounts with email/password
- **Canvas** - Canvas workspaces
- **CanvasItem** - Notes and bookmarks on canvas
- **Comment** - Comments on canvas items
- **CanvasShare** - Canvas sharing with roles (VIEW/COMMENT/EDIT)
- **Session** - User sessions for NextAuth
- **Account** - OAuth provider accounts
- **PasswordResetToken** - Password reset tokens
- **EmailVerificationToken** - Email verification tokens

See `prisma/schema.prisma` for full schema definition.

---

## Performance Tips

### Connection Pooling

For production, use connection pooling:

```typescript
// src/lib/db.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Connection pool settings
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Add connection pool limits to DATABASE_URL
// Example: postgresql://user:pass@host:5432/db?connection_limit=10
```

### Database Indexes

The schema includes optimized indexes for:
- User lookups by email
- Canvas items by canvas ID and deletion status
- Comments by item ID and creation date
- Share permissions by email

### Query Optimization

```typescript
// ❌ Bad: N+1 query problem
const canvases = await prisma.canvas.findMany();
for (const canvas of canvases) {
  const items = await prisma.canvasItem.findMany({ where: { canvasId: canvas.id } });
}

// ✅ Good: Single query with include
const canvases = await prisma.canvas.findMany({
  include: {
    items: { where: { deletedAt: null } },
  },
});
```

---

## Backup and Restore

### Backup

```bash
# Create backup
pg_dump -U canvasuser canvas_collect > backup.sql

# Create compressed backup
pg_dump -U canvasuser canvas_collect | gzip > backup.sql.gz

# Backup specific tables
pg_dump -U canvasuser -t '"User"' -t '"Canvas"' canvas_collect > backup.sql
```

### Restore

```bash
# Restore from backup
psql -U canvasuser canvas_collect < backup.sql

# Restore from compressed backup
gunzip -c backup.sql.gz | psql -U canvasuser canvas_collect
```

---

## Next Steps

After setting up the database:

1. ✅ **Start development server:**
   ```bash
   pnpm run dev
   ```

2. ✅ **Open Prisma Studio to view data:**
   ```bash
   pnpm run db:studio
   ```

3. ✅ **Run tests:**
   ```bash
   pnpm test
   ```

4. ✅ **Read the audit report:**
   See `CODE_AUDIT_REPORT.md` for optimization opportunities

---

## Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)
- [NextAuth.js with Prisma](https://next-auth.js.org/adapters/prisma)
- [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)

---

**Need help?** Check the troubleshooting section or create an issue on GitHub.
