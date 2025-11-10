# CanvasCollect

A secure, production-grade multi-canvas application for organizing notes and bookmarks. Built with Next.js, TypeScript, and a modern tech stack following security-first principles.

## Project Overview

CanvasCollect is being developed as a series of vertical slices following the specifications in [SENATE.md](./SENATE.md). This repository represents **Slice 1: Project Setup & Tooling** - a fully configured Next.js application with all required dependencies and tooling in place.

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode)
- **Package Manager:** pnpm
- **Styling:** Material UI (MUI) with Emotion
- **State Management:**
  - Client State: Zustand
  - Server State: TanStack Query (React Query)
- **Forms:** react-hook-form + Zod
- **Canvas:** Konva.js + react-konva
- **Database:** PostgreSQL + Prisma ORM
- **Authentication:** Auth.js v5 (NextAuth)
- **Testing:**
  - E2E: Playwright
  - Unit/Integration: Vitest
- **Logging:** pino
- **Environment:** dotenv-safe + Zod validation
- **Code Quality:** ESLint + Prettier + Husky pre-commit hooks

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- PostgreSQL database

## Getting Started

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd notes

# Install dependencies
pnpm install
```

### 2. Environment Setup

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/canvascollect"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="<generate-with-openssl-rand-base64-32>"
NODE_ENV="development"
```

**Important:** Generate a secure `NEXTAUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 3. Database Setup

```bash
# Generate Prisma Client
pnpm db:generate

# Run migrations (creates database schema)
pnpm db:migrate

# (Optional) Seed the database
pnpm db:seed
```

### 4. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

### Development

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm type-check` - Run TypeScript type checking

### Code Quality

- `pnpm lint` - Run ESLint
- `pnpm format` - Format code with Prettier
- `pnpm format:check` - Check code formatting

### Testing

- `pnpm test` - Run unit/integration tests with Vitest
- `pnpm test:ui` - Run tests with UI
- `pnpm test:coverage` - Generate coverage report
- `pnpm test:e2e` - Run E2E tests with Playwright
- `pnpm test:e2e:ui` - Run E2E tests with UI

### Database

- `pnpm db:generate` - Generate Prisma Client
- `pnpm db:push` - Push schema changes to database
- `pnpm db:migrate` - Run database migrations
- `pnpm db:studio` - Open Prisma Studio (database GUI)
- `pnpm db:seed` - Seed database with test data

### CI/CD

- `pnpm audit` - Security audit
- `pnpm ci` - Run full CI pipeline (lint, type-check, test, audit, build, e2e)

## Project Structure

```
notes/
├── docs/                    # Documentation and ADRs
│   └── adr/                # Architectural Decision Records
├── prisma/                 # Database schema and migrations
│   └── schema.prisma
├── src/
│   ├── app/                # Next.js App Router pages
│   │   ├── api/           # API routes (will use /api/v1 prefix)
│   │   ├── auth/          # Authentication pages
│   │   ├── canvas/        # Canvas pages
│   │   ├── layout.tsx     # Root layout
│   │   └── page.tsx       # Home page
│   ├── components/        # React components
│   │   └── providers/     # Context providers
│   ├── features/          # Feature-based modules
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility libraries
│   │   ├── auth.ts        # Auth.js configuration
│   │   ├── env.ts         # Environment variable validation
│   │   ├── prisma.ts      # Prisma client
│   │   └── theme.ts       # MUI theme
│   ├── stores/            # Zustand stores
│   └── types/             # TypeScript type definitions
├── .husky/                # Git hooks
├── SENATE.md              # Master project specification
├── package.json
└── tsconfig.json
```

## Architecture & Design Decisions

This project follows several Architectural Decision Records (ADRs):

- **ADR-0001:** API Versioning (all routes prefixed with `/api/v1`)
- **ADR-0002:** Nonce-Based Strict CSP (security policy)
- **ADR-0005:** State Management (Zustand for client, TanStack Query for server)
- **ADR-0007:** Performance Budgets (landing < 100KB, canvas < 150KB gzipped JS)
- **ADR-0012:** Security Headers (strict security headers configured)

Full ADRs are available in [`docs/adr/`](./docs/adr/).

## Security Features (Slice 6 - Fully Implemented)

- **Strict Content Security Policy:** Nonce-based CSP with no unsafe-inline/unsafe-eval
- **Security Headers:** X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS
- **Rate Limiting:** Multi-tier rate limiting (global API + endpoint-specific)
- **Structured Logging:** Pino with correlation IDs and PII redaction
- **Observability:** Health checks (/api/health) and Prometheus metrics (/api/metrics)
- **Strict TypeScript:** No implicit any, strict null checks, no unused variables
- **Environment Validation:** Zod-based validation at startup
- **Pre-commit Hooks:** Automated linting and formatting before commits
- **Dependency Auditing:** Regular security audits via pnpm audit
- **Comprehensive Testing:** E2E + Unit tests with 80%+ coverage requirement
- **Performance Budgets:** CI-enforced bundle size limits
- **Production-Ready:** See [Security Audit Report](./docs/security/SECURITY_AUDIT_REPORT.md)

## Development Guidelines

### Code Style

- All code is automatically formatted with Prettier
- ESLint enforces code quality rules
- Pre-commit hooks run automatically via Husky
- Use TypeScript strict mode (no `any` types)
- Follow the feature-based folder structure

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
docs: update documentation
style: format code
refactor: refactor code
test: add tests
chore: update dependencies
```

### Testing

- Write tests for all new features
- Aim for 80% test coverage minimum
- E2E tests cover critical user flows
- Unit tests for business logic

## Implementation Status

- ✅ **Slice 1:** Project Setup & Tooling
- ⚠️ **Slice 2:** Authentication & Data Model (Framework ready)
- ⚠️ **Slice 3:** Protected Canvas (Framework ready)
- ⚠️ **Slice 4:** Note Item CRUD (Framework ready)
- ⚠️ **Slice 5:** Bookmark Item CRUD (Framework ready)
- ✅ **Slice 6:** MVP Hardening & Testing (COMPLETE)

### Slice 6 Implementation

Slice 6 (MVP Hardening & Testing) is now **fully implemented** with:

- ✅ Strict nonce-based CSP (no unsafe-inline/unsafe-eval)
- ✅ Comprehensive security headers
- ✅ Multi-tier rate limiting
- ✅ Structured logging with correlation IDs
- ✅ Health and metrics endpoints
- ✅ E2E test suite (30+ tests)
- ✅ Unit test suite with 80%+ coverage target
- ✅ Performance budget enforcement
- ✅ CI/CD pipeline with GitHub Actions
- ✅ Security audit report

See [Slice 6 Implementation Summary](./docs/SLICE_6_IMPLEMENTATION.md) and [Security Audit Report](./docs/security/SECURITY_AUDIT_REPORT.md) for details.

## Resources

- [SENATE.md](./SENATE.md) - Master project specification
- [ADR Directory](./docs/adr/) - Architectural decisions
- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Auth.js Documentation](https://authjs.dev)
- [Material UI Documentation](https://mui.com)

## License

[Specify your license here]

## Contributing

See [SENATE.md](./SENATE.md) for the development process and LLM collaboration protocol.