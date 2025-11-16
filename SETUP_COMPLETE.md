# CanvasCollect - Complete Setup Guide

## 🎯 Current Status

**✅ FULLY IMPLEMENTED:**
- All MVP features (6 slices complete)
- Phase 2 features (Search, Tags, Undo/Redo, Multi-select, Email verification, Password reset)
- Phase 3 features (Sharing, Comments, Templates)
- 18+ API endpoints
- Full database schema (9 tables)
- Security hardening (CSP, rate limiting, logging, metrics)
- ADR-0010 & ADR-0011 finalized

**Database:** PostgreSQL with complete schema
**Framework:** Next.js 15 (App Router)
**State:** Zustand + TanStack Query
**Canvas:** Konva.js + react-konva
**Auth:** NextAuth v5 (Auth.js)

---

## 📋 Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0
- **PostgreSQL** 14+ (running and accessible)

---

## 🚀 Quick Start (Full Setup)

### 1. Install Dependencies

```bash
cd /path/to/notes
pnpm install
```

### 2. Set Up Environment Variables

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/canvascollect"

# Auth.js (NextAuth)
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="<generate-with-openssl-rand-base64-32>"

# Node Environment
NODE_ENV="development"

# Optional: Logging level
LOG_LEVEL="info"

# Optional: Feature flags
FEATURE_BOOKMARK_UNFURLING="false"
```

Generate secure secret:
```bash
openssl rand -base64 32
```

### 3. Set Up Database

#### Option A: Using Docker (Recommended)

```bash
# Start PostgreSQL container
docker-compose up -d

# Wait for database to be ready
sleep 5
```

The `docker-compose.yml` is already configured with:
- PostgreSQL 16
- Database: `canvascollect`
- User: `canvascollect`
- Password: `devpassword` (default, override with `DATABASE_PASSWORD` env var)

#### Option B: Using Existing PostgreSQL

Create database and user:

```sql
CREATE USER canvascollect WITH PASSWORD 'your_secure_password';
CREATE DATABASE canvascollect OWNER canvascollect;
GRANT ALL PRIVILEGES ON DATABASE canvascollect TO canvascollect;
```

### 4. Run Database Migrations

```bash
# Generate Prisma Client
pnpm db:generate

# Run migrations
pnpm db:migrate:dev

# (Optional) Seed with sample data
pnpm db:seed
```

### 5. Start Development Server

```bash
pnpm dev
```

The application will be available at **http://localhost:3000**

---

## 🗄️ Database Schema

The following tables are created:

1. **User** - User accounts (email, password, profile)
2. **Canvas** - User canvases (with pan/zoom state, sharing, templates)
3. **CanvasItem** - Notes and Bookmarks (with tags, versioning, soft delete)
4. **Comment** - Comments on canvas items
5. **CanvasShare** - Canvas sharing permissions (VIEW/COMMENT/EDIT)
6. **Session** - Auth sessions
7. **Account** - OAuth accounts (for future providers)
8. **PasswordResetToken** - Password reset tokens
9. **EmailVerificationToken** - Email verification tokens

---

## 🔑 Available Scripts

### Development
```bash
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm start            # Start production server
pnpm type-check       # TypeScript check
```

### Code Quality
```bash
pnpm lint             # Run ESLint
pnpm format           # Format with Prettier
pnpm format:check     # Check formatting
```

### Testing
```bash
pnpm test             # Unit tests (Vitest)
pnpm test:ui          # Tests with UI
pnpm test:coverage    # Coverage report
pnpm test:e2e         # E2E tests (Playwright)
pnpm test:e2e:ui      # E2E with UI
```

### Database
```bash
pnpm db:generate      # Generate Prisma Client
pnpm db:migrate       # Deploy migrations (production)
pnpm db:migrate:dev   # Create & apply migrations (dev)
pnpm db:studio        # Open Prisma Studio (GUI)
pnpm db:seed          # Seed database
```

### CI/CD
```bash
pnpm audit            # Security audit
pnpm ci               # Full CI pipeline
```

---

## 🎨 Features Overview

### Authentication
- **Registration** with email verification
- **Login** with email/password (Argon2id hashing)
- **Password reset** flow with secure tokens
- **Session management** with Auth.js

### Canvas Management
- **Create/Edit/Delete** canvases
- **Pan & Zoom** with Konva.js
- **Multi-canvas** support per user

### Canvas Items
- **Notes** - Rich text notes with position/size
- **Bookmarks** - URL bookmarks with metadata
- **Tags** - Organize items with tags
- **Search** - Filter items by content/tags
- **Comments** - Collaborative commenting
- **Undo/Redo** - 50-command history
- **Multi-select** - Selection box + bulk operations

### Sharing & Collaboration
- **Public sharing** - Generate public links
- **User-specific sharing** - Share with specific emails
- **Permissions** - VIEW, COMMENT, or EDIT access
- **Public viewer** - Read-only canvas view at `/share/[token]`

### Templates
- **Save as Template** - Turn any canvas into a reusable template
- **Template Library** - Browse community templates
- **Use Template** - Create new canvas from template
- **Template Categories** - Organize by category

### Security
- ✅ Strict CSP (nonce-based, no unsafe-inline/eval)
- ✅ Security headers (X-Frame-Options, HSTS, etc.)
- ✅ Multi-tier rate limiting
- ✅ Structured logging (Pino + correlation IDs)
- ✅ PII redaction in logs
- ✅ Input validation (Zod)
- ✅ CSRF protection
- ✅ Optimistic concurrency (version-based)

### Observability
- `/api/health` - Health check endpoint
- `/api/metrics` - Prometheus metrics
- Structured JSON logs with correlation IDs

---

## 📁 Project Structure

```
notes/
├── docs/                           # Documentation
│   ├── adr/                       # Architectural Decision Records
│   ├── operations/                # Operational docs (backup, restore)
│   └── security/                  # Security audit reports
├── prisma/
│   ├── schema.prisma              # Database schema
│   ├── migrations/                # Database migrations
│   └── seed.ts                    # Database seed script
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── api/                   # API routes (/api/v1/*)
│   │   ├── auth/                  # Auth pages (login, register, etc.)
│   │   ├── canvas/[canvasId]/    # Canvas editor
│   │   ├── dashboard/             # Dashboard
│   │   ├── share/[token]/        # Public share viewer
│   │   └── templates/             # Template library
│   ├── components/                # Shared components
│   ├── features/                  # Feature modules
│   │   ├── auth/                  # Auth components
│   │   ├── canvas/                # Canvas components
│   │   └── dashboard/             # Dashboard components
│   ├── lib/                       # Utilities
│   │   ├── auth.ts               # Auth.js config
│   │   ├── db.ts                 # Prisma client
│   │   ├── errors.ts             # Error classes (RFC 7807)
│   │   ├── logger/               # Pino logger
│   │   └── validation/           # Zod schemas
│   ├── middleware/                # Next.js middleware
│   │   ├── csp.ts                # CSP headers
│   │   ├── rate-limit.ts         # Rate limiting
│   │   └── security-headers.ts   # Security headers
│   ├── stores/                    # Zustand stores
│   └── types/                     # TypeScript types
├── e2e/                           # Playwright E2E tests
├── .env.example                   # Environment template
├── docker-compose.yml             # PostgreSQL Docker setup
├── SENATE.md                      # Master specification
└── package.json
```

---

## 🔧 Environment-Specific Issues

### Prisma Client Generation Issues

If you see: `@prisma/client did not initialize yet`

**Cause:** Prisma engines cannot be downloaded (network restrictions, offline environment)

**Solutions:**

1. **Use a different environment** with normal internet access
2. **Pre-download engines:**
   ```bash
   # On a machine with internet access
   pnpm prisma generate

   # Copy the .prisma directory to the target machine
   cp -r node_modules/.prisma /path/to/target/node_modules/
   ```
3. **Use Prisma binary targets** (add to `schema.prisma`):
   ```prisma
   generator client {
     provider      = "prisma-client-js"
     binaryTargets = ["native", "debian-openssl-3.0.x"]
   }
   ```

---

## 🌐 API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login (via NextAuth)
- `POST /api/v1/auth/forgot-password` - Request password reset
- `POST /api/v1/auth/reset-password` - Reset password
- `POST /api/v1/auth/send-verification` - Send verification email
- `GET /api/v1/auth/verify-email` - Verify email

### Canvases
- `GET /api/v1/canvases` - List user's canvases
- `POST /api/v1/canvases` - Create canvas
- `GET /api/v1/canvases/[id]` - Get canvas details
- `PATCH /api/v1/canvases/[id]` - Update canvas
- `DELETE /api/v1/canvases/[id]` - Delete canvas

### Canvas Items
- `GET /api/v1/canvas-items?canvasId=[id]` - List items
- `POST /api/v1/canvas-items` - Create item (note/bookmark)
- `PATCH /api/v1/canvas-items/[id]` - Update item
- `DELETE /api/v1/canvas-items/[id]` - Delete item

### Sharing
- `POST /api/v1/canvases/[id]/share` - Create share
- `DELETE /api/v1/canvases/[id]/share/[shareId]` - Remove share
- `POST /api/v1/canvases/[id]/public` - Toggle public sharing
- `GET /api/v1/share/[token]` - Get public canvas

### Comments
- `GET /api/v1/items/[itemId]/comments` - List comments
- `POST /api/v1/items/[itemId]/comments` - Create comment
- `PATCH /api/v1/items/[itemId]/comments/[commentId]` - Update comment
- `DELETE /api/v1/items/[itemId]/comments/[commentId]` - Delete comment

### Templates
- `GET /api/v1/templates` - List templates
- `POST /api/v1/templates` - Create template from canvas
- `GET /api/v1/templates/[id]` - Get template
- `DELETE /api/v1/templates/[id]` - Remove template status
- `POST /api/v1/templates/[id]/use` - Create canvas from template

### Observability
- `GET /api/health` - Health check
- `GET /api/metrics` - Prometheus metrics

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 pnpm dev
```

### Database Connection Issues
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Test connection
psql -h localhost -U canvascollect -d canvascollect

# Check DATABASE_URL in .env matches your setup
```

### Prisma Issues
```bash
# Reset Prisma Client
rm -rf node_modules/.prisma
pnpm db:generate

# Reset database (WARNING: destroys data)
pnpm prisma migrate reset
```

### Build Errors (Konva)
If you see Konva module resolution errors:

The `next.config.ts` has been configured to handle this. If issues persist:
- Check `transpilePackages: ['konva', 'react-konva']` in config
- Ensure `canvas` package is installed as optional dependency

---

## 📚 Documentation References

- **SENATE.md** - Master project specification
- **docs/adr/** - Architectural Decision Records (12 ADRs)
- **docs/operations/** - Backup/restore procedures
- **docs/security/** - Security audit reports
- **docs/TESTING_GUIDE.md** - Testing strategy and examples
- **docs/QUICK_REFERENCE.md** - Quick command reference

---

## 🚢 Production Deployment

### Pre-Deployment Checklist

- [ ] Set secure `NEXTAUTH_SECRET` (32+ characters)
- [ ] Configure `DATABASE_URL` with SSL (`?sslmode=require`)
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS (via reverse proxy or platform)
- [ ] Configure monitoring (Prometheus)
- [ ] Set up log aggregation (e.g., CloudWatch, Datadog)
- [ ] Configure automated database backups
- [ ] Review security audit report (`docs/security/SECURITY_AUDIT_REPORT.md`)
- [ ] Set up error tracking (e.g., Sentry)
- [ ] Configure CDN for static assets

### Build for Production

```bash
# Build
pnpm build

# Run production server
pnpm start
```

### Database Migration (Production)

```bash
# Deploy pending migrations
pnpm db:migrate

# Verify
pnpm prisma migrate status
```

---

## 🎓 Development Workflow

### Adding a New Feature

1. Review SENATE.md for architectural decisions
2. Create/update ADR if needed
3. Write tests first (TDD approach)
4. Implement feature
5. Run linter and formatter
6. Ensure 80%+ test coverage
7. Create conventional commit
8. Push and create PR

### Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add bookmark sorting feature
fix: correct canvas zoom calculation
docs: update API documentation
style: format code with prettier
refactor: simplify auth middleware
test: add E2E tests for sharing
chore: update dependencies
```

---

## 💡 Future Phases (Roadmap)

### Phase 4 - Planned Features
- **Real-time collaboration** (Y.js CRDT - see ADR-0010)
- **Rich text editing** (Tiptap integration)
- **Image uploads** (S3/CloudFront)
- **Bookmark unfurling** (SSRF-protected metadata fetch)
- **Advanced search** (Full-text search with PostgreSQL)
- **Command palette** (cmdk library)
- **Grid & snapping** (Canvas alignment tools)
- **Export/Import** (JSON, PDF exports)

### When to Add Caching (ADR-0011 Triggers)
- P95 latency > 500ms for 3+ days
- Database CPU > 70% for 24+ hours
- Total items > 100,000
- Concurrent users > 500

---

## 🤝 Contributing

This project follows strict architectural principles:

- **Security First** - All changes must maintain security posture
- **Production Grade** - No shortcuts, proper error handling
- **Test Coverage** - 80%+ coverage for new code
- **Documentation** - Update ADRs for architectural changes

See SENATE.md for full development guidelines.

---

## 📞 Support

- **Issues:** Check GitHub Issues
- **Documentation:** Start with SENATE.md
- **Architecture:** Review docs/adr/ for decisions
- **Security:** See docs/security/SECURITY_AUDIT_REPORT.md

---

## ✅ What's Been Completed

- ✅ All 6 MVP slices delivered
- ✅ Phase 2 features (tags, search, undo/redo, etc.)
- ✅ Phase 3 features (sharing, comments, templates)
- ✅ Security hardening (Slice 6)
- ✅ 18+ API endpoints
- ✅ Full database schema (9 tables)
- ✅ E2E and unit test suites
- ✅ CI/CD pipeline with GitHub Actions
- ✅ Comprehensive documentation (12 ADRs)
- ✅ Import path fixes (all routes use correct @/lib/db and @/lib/auth)
- ✅ ADR-0010 finalized (Y.js CRDT strategy)
- ✅ ADR-0011 finalized (Redis caching strategy)

**The codebase is production-ready and feature-complete!**
