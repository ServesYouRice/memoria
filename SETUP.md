# CanvasCollect Setup Guide

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Docker and Docker Compose (for PostgreSQL)

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and update the following values:

- `DATABASE_URL`: PostgreSQL connection string
- `NEXTAUTH_SECRET`: Generate with `openssl rand -base64 32`

### 3. Start PostgreSQL Database

```bash
docker compose up -d
```

Wait for the database to be ready (check with `docker compose logs -f`).

### 4. Run Database Migrations

```bash
# Create and apply migrations in development (creates migration files)
pnpm db:migrate:dev
```

For production deployments, use:
```bash
# Deploy existing migrations (does not create new migrations)
pnpm db:migrate
```

### 5. Seed the Database (Optional)

Populate the database with sample data:

```bash
pnpm db:seed
```

This creates two test users:
- Email: `alice@example.com`, Password: `TestPassword123!`
- Email: `bob@example.com`, Password: `TestPassword123!`

### 6. Start the Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint
- `pnpm format` - Format code with Prettier
- `pnpm type-check` - Run TypeScript type checking
- `pnpm test` - Run unit tests with Vitest
- `pnpm test:coverage` - Run tests with coverage
- `pnpm test:e2e` - Run end-to-end tests with Playwright
- `pnpm db:migrate:dev` - Create and apply migrations (development)
- `pnpm db:migrate` - Deploy migrations to production database
- `pnpm db:seed` - Seed database with sample data
- `pnpm db:studio` - Open Prisma Studio
- `pnpm ci` - Run full CI pipeline

## Project Structure

```
/home/user/notes/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── seed.ts                # Database seed script
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── api/              # API routes
│   │   │   ├── auth/         # Auth.js routes
│   │   │   └── v1/           # Versioned API endpoints
│   │   ├── auth/             # Auth pages (login, register)
│   │   ├── dashboard/        # Dashboard page
│   │   └── layout.tsx        # Root layout
│   ├── features/             # Feature modules
│   │   └── auth/             # Auth components
│   ├── lib/                  # Shared utilities
│   │   ├── auth/             # Auth configuration & utilities
│   │   ├── db/               # Prisma client
│   │   ├── errors/           # RFC 7807 error handling
│   │   └── validation/       # Validation utilities
│   └── __tests__/            # Test files
├── docker-compose.yml        # PostgreSQL container
├── .env.example              # Environment variables template
└── SENATE.md                 # Master project specification
```

## Authentication

### Registration

New users can register at `/auth/register`. The system enforces:

- Minimum password length: 10 characters
- Password strength: zxcvbn score >= 3
- Argon2id password hashing

### Login

Users can log in at `/auth/login` using their email and password.

### Sessions

- Sessions are stored in the database (Prisma adapter)
- Cookies are HttpOnly with SameSite=Lax
- Session duration: 30 days
- Session refresh: every 24 hours

## Database

### Migrations

CanvasCollect uses **Prisma Migrate** for production-ready database versioning (not `db:push`).

#### Development Workflow

Create a new migration after modifying `prisma/schema.prisma`:

```bash
# This will prompt for a migration name and create the migration file
pnpm db:migrate:dev
```

#### Production Deployments

Deploy existing migrations to production:

```bash
# This applies all pending migrations without prompting
pnpm db:migrate
```

### Schema Updates

After modifying `prisma/schema.prisma`:

1. Create and apply migration: `pnpm db:migrate:dev`
2. Regenerate Prisma Client: `pnpm db:generate` (usually automatic with migrate:dev)

### Migration Structure

Migrations are stored in `prisma/migrations/` with the following structure:

```
prisma/migrations/
├── migration_lock.toml          # Locks database provider to PostgreSQL
└── 20251110090734_init/         # Migration timestamp_name format
    └── migration.sql            # Generated SQL for this migration
```

Each migration contains the SQL needed to evolve the database schema forward.

### Prisma Studio

Explore and edit database data:

```bash
pnpm db:studio
```

## Testing

### Unit Tests

```bash
pnpm test
```

Run with UI:

```bash
pnpm test:ui
```

### Test Coverage

```bash
pnpm test:coverage
```

### E2E Tests

```bash
pnpm test:e2e
```

## Troubleshooting

### Database Connection Issues

1. Ensure PostgreSQL is running: `docker compose ps`
2. Check logs: `docker compose logs postgres`
3. Verify DATABASE_URL in `.env`

### Prisma Issues

If you encounter Prisma errors:

```bash
pnpm db:generate  # Regenerate Prisma Client
```

### Port Already in Use

If port 3000 or 5432 is already in use, either:
- Stop the conflicting service
- Update the port in `.env` and `docker-compose.yml`

## Next Steps

- Review [SENATE.md](./SENATE.md) for the complete project specification
- Check the [ADR documentation](./docs/adr/) for architectural decisions
- Explore the codebase starting with `src/app/layout.tsx`

## Security Notes

- Never commit `.env` file to version control
- Generate a strong `NEXTAUTH_SECRET` for production
- Use environment-specific database credentials
- Review security headers in `src/middleware/security-headers.ts`
