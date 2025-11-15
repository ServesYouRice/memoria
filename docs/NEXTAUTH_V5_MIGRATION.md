# NextAuth v5 Migration Guide

**FIXED: Issue #6 - NextAuth v5 Beta Status & Migration Planning**

## Current Status

This project currently uses **NextAuth v5 Beta** (`next-auth@5.0.0-beta.25`).

⚠️ **Important:** Beta versions may have breaking changes between releases. Monitor the [NextAuth releases page](https://github.com/nextauthjs/next-auth/releases) for updates.

## Why NextAuth v5?

NextAuth v5 (also known as Auth.js) brings significant improvements:

- **Better Next.js 13+ App Router support**: Designed for Server Components and Server Actions
- **Simplified configuration**: More intuitive API and easier setup
- **Enhanced TypeScript support**: Better type inference and autocomplete
- **Improved security**: Updated security practices and session handling
- **Better edge runtime support**: Works well with Vercel Edge Functions and Middleware

## When to Migrate to Stable v5

Monitor for the v5 stable release announcement. When released:

1. **Read the official migration guide**: https://authjs.dev/getting-started/migrating-to-v5
2. **Review the CHANGELOG**: Check for breaking changes since beta.25
3. **Plan migration time**: Budget 2-4 hours for migration and testing
4. **Test in development first**: Never migrate directly in production

## Migration Checklist

### Pre-Migration

- [ ] Backup your database (especially `User`, `Session`, `Account` tables)
- [ ] Document current auth flows (login, register, OAuth providers)
- [ ] Note any custom auth logic in `src/lib/auth.ts` and `src/lib/auth/config.ts`
- [ ] Review current environment variables in `.env`

### Update Dependencies

```bash
# Check for latest stable version
npm view next-auth version

# Update to stable v5
pnpm update next-auth@^5.0.0
pnpm update @auth/prisma-adapter@^2.0.0

# Regenerate lockfile
pnpm install
```

### Configuration Changes

Files to review and potentially update:

#### 1. `src/lib/auth.ts`

Current beta.25 structure:
```typescript
import NextAuth from 'next-auth';
import { authConfig } from './auth/config';

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
```

Check stable v5 docs for any API changes.

#### 2. `src/lib/auth/config.ts`

Review:
- Session strategy (JWT vs Database)
- Provider configurations
- Callbacks (jwt, session, signIn)
- Pages configuration

Potential changes in stable v5:
```typescript
// Beta approach
import { NextAuthConfig } from 'next-auth';

export const authConfig: NextAuthConfig = {
  // ...config
};

// Stable v5 might use different types or structure
// Check official docs when migrating
```

#### 3. Middleware (`src/middleware.ts`)

Current implementation:
```typescript
import { auth } from './lib/auth';

// Used in middleware for auth checks
const session = await auth();
```

Verify this pattern still works in stable v5.

#### 4. Environment Variables

Check if any env var names changed:
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- OAuth provider vars (Google, GitHub, etc.)

### Database Schema

Check if Prisma adapter requires schema changes:

```bash
# After updating @auth/prisma-adapter
pnpm prisma migrate dev --name nextauth-v5-stable-migration

# Review the generated migration before applying
```

### Testing Plan

#### Automated Tests

```bash
# Run full test suite
pnpm test

# Run E2E tests
pnpm test:e2e

# Check TypeScript compilation
pnpm type-check
```

#### Manual Testing Checklist

- [ ] **Login Flow**
  - [ ] Email/password login works
  - [ ] Error messages display correctly
  - [ ] Session persists after login
  - [ ] Session expires correctly

- [ ] **Registration Flow**
  - [ ] New user registration works
  - [ ] Email verification works (if enabled)
  - [ ] Validation errors display correctly

- [ ] **OAuth Providers** (if enabled)
  - [ ] Google OAuth login works
  - [ ] GitHub OAuth login works
  - [ ] Account linking works correctly
  - [ ] Existing OAuth users can still log in

- [ ] **Session Management**
  - [ ] Session persists across page reloads
  - [ ] Session data is correct in API routes
  - [ ] Session data is correct in Server Components
  - [ ] Logout works and clears session

- [ ] **Password Reset** (if implemented)
  - [ ] Request password reset works
  - [ ] Reset token email sent
  - [ ] Reset token works
  - [ ] Password successfully updated

- [ ] **API Protection**
  - [ ] Protected API routes require authentication
  - [ ] Unauthenticated requests return 401
  - [ ] Authorization checks work (canvas ownership, etc.)

- [ ] **Edge Cases**
  - [ ] Expired sessions handled gracefully
  - [ ] Invalid tokens rejected
  - [ ] Concurrent sessions work (if allowed)
  - [ ] Session refresh works

### Rollback Plan

If migration causes issues:

```bash
# Revert to beta version
pnpm install next-auth@5.0.0-beta.25 @auth/prisma-adapter@^2.7.4

# Restore database backup (if schema changed)
# ... restore commands depend on your hosting provider
```

## Known Issues with Beta

Document any issues encountered with the beta version here:

### Issue: [Description]

- **Symptom**: What goes wrong
- **Workaround**: How we currently handle it
- **Expected in stable**: How stable v5 should fix it

## Helpful Resources

### Official Documentation

- NextAuth v5 Docs: https://authjs.dev/
- Migration Guide: https://authjs.dev/getting-started/migrating-to-v5
- GitHub Releases: https://github.com/nextauthjs/next-auth/releases

### Community

- Discord: https://authjs.dev/discord
- GitHub Discussions: https://github.com/nextauthjs/next-auth/discussions

### Our Implementation

Key files in this project:

```
src/lib/auth.ts              # Main NextAuth configuration
src/lib/auth/config.ts       # Auth configuration (providers, callbacks)
src/lib/auth/middleware.ts   # Auth middleware helpers
src/middleware.ts            # Next.js middleware (uses auth)
src/app/api/v1/auth/         # Auth API routes (login, register, etc.)
prisma/schema.prisma         # User, Session, Account models
```

## Version History

| Date       | Version        | Notes                          |
|------------|----------------|--------------------------------|
| 2024-XX-XX | 5.0.0-beta.25  | Initial implementation (beta)  |
| TBD        | 5.0.0          | Migration to stable v5         |

## Post-Migration

After successfully migrating to stable v5:

- [ ] Update this document with actual migration experience
- [ ] Document any gotchas encountered
- [ ] Update package.json to pin to stable version
- [ ] Remove beta warning from `instrumentation.ts`
- [ ] Update CODE_AUDIT_REPORT.md to mark Issue #6 as resolved
- [ ] Celebrate! 🎉
