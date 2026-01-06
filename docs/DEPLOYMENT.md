# Deployment Guide

This guide covers local development and free cloud deployment for CanvasCollect (Memoria).

---

## Quick Start (Local)

```powershell
# 1. Start databases
docker-compose up -d

# 2. Configure environment
cp .env.example .env
# Edit .env with local settings (see below)

# 3. Setup database
pnpm install
pnpm db:generate
pnpm db:migrate:dev

# 4. Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 1. Local Development (Docker)

### Prerequisites

- **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop/)
- **Node.js 20+** - [Download](https://nodejs.org/)
- **pnpm 8+** - `npm install -g pnpm`

### Start Services

```powershell
cd c:\Users\V\notes
docker-compose up -d
```

This starts:
- **PostgreSQL 16** on port `5432`
- **Redis 7** on port `6379`

### Local `.env` Configuration

```env
# Database (Docker)
DATABASE_URL="postgresql://canvascollect:devpassword@localhost:5432/canvascollect"

# Redis (Docker)
REDIS_URL="redis://localhost:6379"

# Auth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="<generate-with: openssl rand -base64 32>"

# Environment
NODE_ENV="development"
```

### Useful Commands

```powershell
# View container logs
docker-compose logs -f postgres
docker-compose logs -f redis

# Stop services
docker-compose down

# Reset database (delete all data)
docker-compose down -v
docker-compose up -d
pnpm db:migrate:dev
```

---

## 2. Free Cloud Deployment (Vercel + Neon)

### Overview

| Service | Free Tier | Purpose |
|---------|-----------|---------|
| **Vercel** | Hobby plan | Next.js hosting |
| **Neon** | 512MB, 0.25 vCPU | PostgreSQL database |
| **Upstash** | 10K commands/day | Redis (optional, for rate limiting) |

### Step 1: Create Neon Database

1. Go to [neon.tech](https://neon.tech) and sign up
2. Create a new project (e.g., "canvascollect")
3. Copy the connection string:
   ```
   postgresql://USER:PASSWORD@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

### Step 2: Deploy to Vercel

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) and sign up
3. Click "New Project" → Import your GitHub repo
4. Add environment variables:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Neon connection string |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |
| `NEXTAUTH_SECRET` | Generate: `openssl rand -base64 32` |
| `NODE_ENV` | `production` |

5. Click "Deploy"

### Step 3: Run Database Migration

After first deploy, run migrations via Vercel CLI:

```powershell
# Install Vercel CLI
npm i -g vercel

# Link project
vercel link

# Run migration
vercel env pull .env.local
pnpm db:migrate
```

Or use the Vercel dashboard → Functions → run migration command.

### Step 4: (Optional) Add Upstash Redis

For rate limiting in production:

1. Go to [upstash.com](https://upstash.com) and sign up
2. Create a Redis database
3. Copy the connection URL
4. Add to Vercel environment:
   ```
   REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
   ```

---

## 3. Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `NEXTAUTH_URL` | App URL | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Session encryption key | (32+ char random string) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | - | Redis connection (enables caching) |
| `NODE_ENV` | `development` | `development` or `production` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `OPENAI_API_KEY` | - | AI features |
| `SENTRY_DSN` | - | Error tracking |

### Cloud-Specific Formats

```env
# Neon PostgreSQL (includes SSL)
DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# Upstash Redis (uses rediss:// for TLS)
REDIS_URL="rediss://default:token@xxx.upstash.io:6379"

# Production
NEXTAUTH_URL="https://your-app.vercel.app"
NODE_ENV="production"
```

---

## 4. Troubleshooting

### Docker won't start

```powershell
# Check if Docker Desktop is running
docker info

# Check port conflicts
netstat -an | findstr "5432"
netstat -an | findstr "6379"
```

### Database connection fails

```powershell
# Test PostgreSQL
docker exec canvascollect-postgres pg_isready -U canvascollect

# Reset if corrupted
docker-compose down -v
docker-compose up -d
```

### Vercel build fails

1. Check build logs in Vercel dashboard
2. Common issues:
   - Missing environment variables
   - TypeScript errors (run `pnpm type-check` locally)
   - Prisma client not generated (ensure `prisma generate` runs in build)

### Neon connection timeout

- Neon free tier has cold starts (~1-2s first request)
- Check connection string has `?sslmode=require`
- Verify IP is not blocked (Neon allows all IPs by default)

---

## 5. Production Recommendations

Before launching to users:

- [ ] Enable Sentry for error tracking
- [ ] Set up database backups (Neon has point-in-time recovery)
- [ ] Configure custom domain in Vercel
- [ ] Add Upstash Redis for reliable rate limiting
- [ ] Review security headers at [securityheaders.com](https://securityheaders.com)

---

*Last updated: 2026-01-06*
