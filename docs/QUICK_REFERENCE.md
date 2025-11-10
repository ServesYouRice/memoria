# Quick Reference - CanvasCollect

## Essential Commands

### Development
```bash
pnpm dev          # Start dev server (http://localhost:3000)
pnpm build        # Build for production
pnpm start        # Start production server
```

### Testing
```bash
pnpm test              # Run unit tests
pnpm test:coverage     # Run tests with coverage
pnpm test:e2e          # Run E2E tests
pnpm ci                # Run full CI pipeline
```

### Database
```bash
pnpm db:migrate        # Run migrations
pnpm db:studio         # Open Prisma Studio
pnpm db:seed           # Seed test data
```

### Code Quality
```bash
pnpm lint              # Run linter
pnpm format            # Format code
pnpm type-check        # TypeScript check
```

---

## Project Structure

```
/home/user/notes/
├── src/
│   ├── app/api/           # API routes
│   │   ├── health/        # Health check endpoint
│   │   └── metrics/       # Prometheus metrics
│   ├── lib/logger/        # Structured logging
│   ├── middleware/        # Security middleware
│   │   ├── csp.ts         # Content Security Policy
│   │   ├── rate-limit.ts  # Rate limiting
│   │   └── security-headers.ts
│   └── __tests__/         # Unit tests
├── e2e/                   # E2E tests (Playwright)
├── docs/                  # Documentation
│   ├── adr/               # Architectural decisions
│   ├── security/          # Security audit report
│   ├── SLICE_6_IMPLEMENTATION.md
│   └── TESTING_GUIDE.md
└── scripts/               # Build scripts
    └── check-bundle-size.mjs
```

---

## Important URLs

### Development
- **App:** http://localhost:3000
- **Health:** http://localhost:3000/api/health
- **Metrics:** http://localhost:3000/api/metrics
- **Database UI:** http://localhost:5555 (Prisma Studio)

---

## Environment Variables

Required in `.env`:

```env
DATABASE_URL="postgresql://..."
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="<32+ character random string>"
NODE_ENV="development"
```

Generate secret:
```bash
openssl rand -base64 32
```

---

## Security Features

### CSP
- Nonce-based (unique per request)
- No unsafe-inline/unsafe-eval in production
- Location: `/src/middleware/csp.ts`

### Rate Limiting
- API: 100 req/15min
- Auth: 5 req/15min
- Location: `/src/middleware/rate-limit.ts`

### Headers
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: restrictive

---

## Testing Coverage

### E2E Tests (30+ tests)
- ✅ Security headers
- ✅ Authentication flows
- ✅ Canvas operations
- ✅ Health/metrics endpoints

### Unit Tests
- ✅ CSP middleware
- ✅ Logger utilities
- ✅ 80% coverage target

### Performance
- Landing: < 100KB gzipped
- Auth: < 125KB gzipped
- Canvas: < 150KB gzipped

---

## CI/CD Pipeline

Runs on every push/PR:

1. Lint (ESLint + Prettier)
2. Type Check (TypeScript)
3. Unit Tests (with coverage)
4. Security Audit (pnpm audit)
5. Build (Next.js)
6. Bundle Check (performance budgets)
7. E2E Tests (Playwright)

Pipeline file: `/.github/workflows/ci.yml`

---

## Troubleshooting

### Tests failing?
```bash
# Ensure database is running and migrated
pnpm db:migrate

# Clear cache
rm -rf .next

# Reinstall dependencies
rm -rf node_modules
pnpm install
```

### Build failing?
```bash
# Check types
pnpm type-check

# Check for errors
pnpm lint

# Check bundle size
pnpm run check-bundle
```

### Database issues?
```bash
# Reset database (WARNING: deletes all data)
pnpm db:push --force-reset

# View database
pnpm db:studio
```

---

## Key Documentation

- [SENATE.md](../SENATE.md) - Master specification
- [Slice 6 Implementation](./SLICE_6_IMPLEMENTATION.md) - Implementation details
- [Security Audit](./security/SECURITY_AUDIT_REPORT.md) - Security review
- [Testing Guide](./TESTING_GUIDE.md) - Testing practices
- [ADRs](./adr/) - Architecture decisions

---

## Production Checklist

Before deploying to production:

- [ ] Set secure NEXTAUTH_SECRET (32+ chars)
- [ ] Configure DATABASE_URL with SSL
- [ ] Set NODE_ENV=production
- [ ] Enable HTTPS
- [ ] Configure monitoring (Prometheus)
- [ ] Set up log aggregation
- [ ] Configure automated backups
- [ ] Review security audit report
- [ ] Run full test suite
- [ ] Check bundle sizes

---

**Last Updated:** 2025-11-10  
**Version:** 1.0.0
