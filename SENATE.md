# SENATE.md: Master Project Guide for CanvasCollect (v3.0)

**Last Updated:** November 17, 2025
**Status:** Production Ready (90%)
**Latest Audit:** Comprehensive Deep Dive Complete

---

## 1. Project Overview & Core Principles

### 1.1. Introduction
This document is the single source of truth for the 'CanvasCollect' web application. It is a living specification, refined through a process of critique and consensus between the project owner and participating LLM assistants.

### 1.2. Core Principles
*   **Security First:** All design and implementation choices must prioritize security.
*   **Production Grade:** The goal is a robust, scalable, and maintainable application, not a throwaway prototype.
*   **Iterative & Sliced Delivery:** The project is built in phases, with the MVP delivered as end-to-end "vertical slices" of functionality.
*   **Explicit Over Implicit:** Ambiguities are resolved and decisions are documented before implementation.
*   **Test-Driven Mindset:** All new functionality must be accompanied by meaningful tests.

### 1.3. Consensus Protocol
A proposal is **ACCEPTED** when either (a) the User casts a final `Approve` vote, or (b) all three LLMs (Claude, Gemini, CodexCLI) unanimously `Approve`. Accepted proposals are integrated into this document, and a corresponding ADR is created.

---

## 2. Project Dashboard

### 2.1. Application Status

**Current Version:** Phase 3+ (Collaboration & Advanced Features)
**Production Readiness:** 🟢 **90% Ready** - Pending final items (see Section 2.4)
**Security Score:** 🟢 **8.1/10** (Improved from 7.5/10)
**Latest Commit:** `0cdfe8e` - Comprehensive app audit and critical fixes

### 2.2. Task Board

| Task | Status | Assignee | Notes |
|------|--------|----------|-------|
| **Slice 1:** Project Setup | ✅ DN | Claude | Dependencies, Scaffolding, Tooling |
| **Slice 2:** Auth & Data Model | ✅ DN | Claude | DB, Prisma Schema, Auth UI & API |
| **Slice 3:** The Blank Canvas | ✅ DN | Claude | Protected route, basic Konva stage |
| **Slice 4:** Note Item CRUD | ✅ DN | Claude | Create, Move, Resize, Delete Notes |
| **Slice 5:** Bookmark Item CRUD | ✅ DN | Claude | Create, Move, Resize, Delete Bookmarks |
| **Slice 6:** MVP Hardening | ✅ DN | Claude | Security Headers, Final Testing |
| **Phase 2:** Rich Content | ✅ DN | Claude | Images, Tiptap, Unfurling, Tags, Undo/Redo |
| **Phase 3:** Collaboration | 🟡 PARTIAL | Claude | Sharing ✅, Templates ✅, Real-time ⚠️ Frontend Only |
| **Phase 4:** Advanced Features | ✅ DN | Claude | Search, Command Palette, Activity Feed |
| **Nov 2025 Audit:** Deep Dive | ✅ DN | Claude | Security, API, Features, Refactoring |

*Legend: NS=Not Started, IP=In Progress, DN=Done, PARTIAL=Partially Complete*

---

### 2.3. Latest Audit Results (November 17, 2025)

**Comprehensive Audit Status:** ✅ **COMPLETE**

A full deep-dive audit was conducted covering authentication, API consistency, security vulnerabilities (OWASP Top 10), missing features, and code quality.

**Reference Documents:**
- `AUDIT_SUMMARY.md` - Executive summary with all findings
- `API_AUDIT_REPORT.md` - Detailed API endpoint analysis

#### Critical Issues Fixed ✅

| Issue | Status | Impact | Files Modified |
|-------|--------|--------|----------------|
| 🔴 Breaking Import Paths | ✅ FIXED | App crash on startup | 5 route files, created `auth-options.ts` |
| 🔴 Missing CRUD Endpoints | ✅ FIXED | Incomplete REST API | `canvases/[canvasId]/route.ts` |
| 🔴 SVG Upload XSS | ✅ FIXED | Stored XSS vulnerability | `upload/route.ts` |
| 🔴 Comments DoS Risk | ✅ FIXED | Performance degradation | `comments/route.ts` (added pagination) |
| 🟡 Error Handling | 🟡 PARTIAL | Inconsistent responses | Comments routes improved |

#### Audit Scores

| Category | Score | Status |
|----------|-------|--------|
| **Authentication & Authorization** | 72/100 | 🟢 Strong |
| **SQL Injection Prevention** | 10/10 | 🟢 Excellent |
| **XSS Prevention** | 8/10 | 🟢 Good (SVG fixed) |
| **CSRF Protection** | 9/10 | 🟢 Excellent |
| **Access Control** | 9/10 | 🟢 Excellent |
| **Security Configuration** | 6/10 | 🟡 Needs Work |
| **API Consistency** | Good | 🟢 Improved |
| **Feature Completeness** | 85% | 🟢 Strong |
| **Overall Security** | **8.1/10** | 🟢 Production Ready* |

*With documented caveats (see Section 2.4)

---

### 2.4. Remaining Critical Items

#### 🔴 Production Blockers (Must Fix Before Scale)

1. **Rate Limiting Infrastructure** - Priority: CRITICAL
   - **Current:** In-memory (Map-based) - Only works on single instance
   - **Problem:** Doesn't work in serverless/distributed deployments
   - **Fix:** Implement Redis-based rate limiting (Upstash recommended)
   - **Files:** `src/middleware/rate-limit.ts`
   - **Timeline:** 1 week

2. **Email Service Integration** - Priority: HIGH
   - **Current:** Email verification/password reset log to console
   - **Problem:** Critical auth features non-functional
   - **Fix:** Integrate SendGrid, AWS SES, or similar
   - **Files:** `src/app/api/v1/auth/forgot-password/route.ts`, `send-verification/route.ts`
   - **Timeline:** 2-3 days

#### 🟡 High Priority (Next Sprint)

3. **WebSocket Collaboration Backend** - Priority: HIGH
   - **Current:** Frontend 100% ready (Y.js, cursor rendering), backend missing
   - **Problem:** Real-time collaboration non-functional
   - **Fix:** Implement `/api/collaboration/[canvasId]` endpoint with Y.js server
   - **Impact:** Completes major feature (80% done)
   - **Timeline:** 1-2 weeks

4. **DOMPurify Installation** - Priority: HIGH
   - **Current:** Basic XSS sanitization only
   - **Problem:** Edge-case XSS vectors may exist
   - **Fix:** Install `isomorphic-dompurify` (requires build environment fix)
   - **Note:** Installation failed due to canvas/pangocairo dependencies
   - **Timeline:** Resolve in production environment

5. **Accessibility Enhancement** - Priority: MEDIUM-HIGH
   - **Current:** Only 3 ARIA labels in entire codebase
   - **Problem:** Poor screen reader support
   - **Fix:** Add ARIA labels to all interactive elements
   - **Timeline:** 1 week

6. **Console Logging Cleanup** - Priority: MEDIUM
   - **Current:** 17+ instances bypass structured logger
   - **Problem:** PII redaction bypassed
   - **Fix:** Replace all `console.log/error` with `logger`
   - **Timeline:** 1 day

#### 🟢 Medium Priority (Improvements)

7. **Zoom State Persistence** - `src/app/canvas/[canvasId]/page.tsx:430`
   - TODO in code to persist zoom changes to database
   - Single API call needed in `handleZoomChange()`

8. **Error Tracking Integration** - Multiple files
   - TODOs for Sentry/Datadog integration
   - Currently logs errors to console only

9. **Test Coverage Expansion**
   - Current: ~15%
   - Target: 80%+
   - Missing: E2E tests, API integration tests, hook tests

---

### 2.5. Previous Audit History

**First Code Audit (Pre-Nov 2025):** ✅ **100% COMPLETE** (45/45 issues resolved)

| Category | Issues | Status |
|----------|--------|--------|
| 🔴 Critical | 8 | ✅ Fixed |
| 🟡 High Priority | 12 | ✅ Fixed |
| 🟠 Medium Priority | 15 | ✅ Fixed |
| 🟢 Low Priority | 10 | ✅ Fixed |

**Key Achievements:**
- SQL injection fixes, XSS prevention, comprehensive CORS config
- Database indexes, viewport filtering, optimistic updates
- Error boundaries, global error handlers, memory leak fixes
- Dark mode, analytics, real-time updates (polling-based)
- Comprehensive documentation (15+ guides)

---

### 2.6. Architectural Decision Log (ADR)

| ID | Decision | Status | Link |
|----|----------|--------|------|
| ADR-0001 | API Versioning & Error Contract | Accepted | `docs/adr/ADR-0001-api-versioning-and-error-contract.md` |
| ADR-0002 | Nonce-Based Strict CSP | Accepted | `docs/adr/ADR-0002-csp-nonce-based-allowlists.md` |
| ADR-0003 | SSRF-Protected Unfurling | Accepted | `docs/adr/ADR-0003-ssrf-protected-unfurling.md` |
| ADR-0004 | Data Model (Multi-Canvas, Normalized) | Accepted | `docs/adr/ADR-0004-data-model-canvas-and-items.md` |
| ADR-0005 | State Management Policy | Accepted | `docs/adr/ADR-0005-state-management-policy.md` |
| ADR-0006 | Observability (Logging, Health, Metrics) | Accepted | `docs/adr/ADR-0006-observability-logging-and-metrics.md` |
| ADR-0007 | Performance Budgets & CI Guard | Accepted | `docs/adr/ADR-0007-performance-budgets-and-ci-guard.md` |
| ADR-0008 | Auth, Session & CSRF Policy | Accepted | `docs/adr/ADR-0008-auth-session-and-csrf-policy.md` |
| ADR-0009 | Autosave & Optimistic Concurrency | Accepted | `docs/adr/ADR-0009-autosave-delta-updates-and-concurrency.md` |
| ADR-0010 | Real-Time Collaboration Strategy (Y.js CRDT) | Accepted | `docs/adr/ADR-0010-realtime-collaboration-strategy.md` |
| ADR-0011 | Server-Side Caching Strategy (Deferred w/ Triggers) | Accepted | `docs/adr/ADR-0011-server-side-caching-strategy.md` |
| ADR-0012 | Security Headers & CORS Policy | Accepted | `docs/adr/ADR-0012-security-headers-and-cors.md` |

---

## 3. The Application Specification

### 3.1. Current Scope & Features

**Core Features (✅ Complete):**
- ✅ Multi-canvas management
- ✅ Full CRUD for Notes, Bookmarks, and Images
- ✅ Rich text editing (Tiptap)
- ✅ Bookmark URL unfurling with metadata
- ✅ Image uploads (secure, no SVG)
- ✅ Tagging system
- ✅ Undo/Redo with command pattern
- ✅ Grid/Snap functionality
- ✅ Canvas sharing with roles (VIEW/COMMENT/EDIT)
- ✅ Templates system with gallery
- ✅ Version history and snapshots
- ✅ Comments on canvas items
- ✅ Global search
- ✅ Command palette (Cmd+K)
- ✅ Activity feed
- ✅ Export (PNG, PDF, JSON)
- ✅ Dark mode
- ✅ Real-time updates (polling: 5s active, 30s inactive)

**Partial Features (🟡 Frontend Ready):**
- 🟡 Real-time collaboration (Y.js frontend complete, backend missing)
- 🟡 WebSocket presence/cursors (UI ready, no server)

**Explicit Non-Goals:**
- AI features
- Native mobile apps
- Payment systems
- Complex RBAC beyond current sharing model

---

### 3.2. Phased Roadmap

*   **Phase 1 (MVP):** ✅ Core single-user functionality
*   **Phase 2 (Enriching Content):** ✅ Images, Rich Text, Unfurling, Tags, Undo/Redo, Grid/Snap
*   **Phase 3 (Collaboration):** 🟡 **85% Complete**
    - ✅ Canvas sharing with permission roles
    - ✅ Templates system
    - ✅ Comments
    - ✅ Public share links
    - ✅ Activity tracking
    - ⚠️ Real-time multi-user editing (frontend ready, backend pending)
*   **Phase 4 (Improving UX):** ✅ Search, Command Palette, Activity Feed

---

### 3.3. Technology Stack (Definitive)

*   **Package Manager:** pnpm
*   **Node.js Runtime:** Current LTS (v22.21.1)
*   **Framework:** Next.js 15 (App Router)
*   **Language:** TypeScript 5 (strict mode)
*   **Styling:** Material UI v6 (MUI) with `sx` prop (Emotion)
*   **Client State:** Zustand 5
*   **Server State:** TanStack Query v5 (React Query)
*   **Forms:** react-hook-form 7 + Zod 3
*   **Canvas:** Konva.js 9 + react-konva 18
*   **Rich Text:** Tiptap (with extensions)
*   **Database:** PostgreSQL 16
*   **ORM:** Prisma 6
*   **Authentication:** Auth.js v5 (NextAuth) with credentials provider
*   **Real-time:** Yjs 13 + y-websocket 3 (frontend ready)
*   **Caching:** Redis 7 (optional, with fallback) - *Not yet implemented*
*   **Testing:** Playwright 1 (E2E) + Vitest 2 (Unit/Integration)
*   **Logging:** Pino 9 with structured JSON
*   **HTTP Client:** Native fetch with TanStack Query
*   **Environment:** dotenv-safe 9 + Zod validation
*   **Date/Time:** date-fns 4
*   **Analytics:** Vercel Analytics
*   **Command Palette:** cmdk 1
*   **PDF Export:** jsPDF 3
*   **HTML Parsing:** Cheerio 1 (bookmark unfurling)

---

### 3.4. Database Schema (Prisma)

**Current Schema includes:**
- User (with email verification, password reset tokens)
- Canvas (with sharing, templates, public links)
- CanvasItem (Notes, Bookmarks, Images with soft delete)
- Comment (on canvas items)
- CanvasShare (permission-based sharing)
- Template (reusable canvas patterns)
- Activity (audit trail)
- Session & Account (Auth.js)
- PasswordResetToken & EmailVerificationToken

**Key Indexes (Performance Optimized):**
- Canvas: `@@index([userId, updatedAt])`, `@@index([isTemplate])`
- CanvasItem: 8+ indexes for canvas/type/position/zIndex/creator/timestamp
- Comment: `@@index([itemId, deletedAt, createdAt])`
- Activity: `@@index([userId, canvasId])`
- Template: `@@index([templateCategory, usageCount])`

*See `prisma/schema.prisma` for complete schema*

---

### 3.5. API Architecture

**API Version:** `/api/v1/*`
**Error Format:** RFC 7807 `application/problem+json`
**Authentication:** Session-based with database storage
**Rate Limiting:** Multi-layered (global, auth endpoints, per-user)

**Complete API Endpoints:**

**Authentication:**
- `POST /api/v1/auth/register` - User registration with password validation
- `POST /api/v1/auth/verify-email` - Email verification
- `POST /api/v1/auth/send-verification` - Resend verification
- `POST /api/v1/auth/forgot-password` - Request password reset
- `POST /api/v1/auth/reset-password` - Reset with token
- `POST /api/auth/[...nextauth]` - NextAuth routes

**Canvas Management:**
- `GET /api/v1/canvases` - List user canvases (paginated) ✅
- `POST /api/v1/canvases` - Create canvas ✅
- `GET /api/v1/canvases/[canvasId]` - Get single canvas ✅ **NEW**
- `PATCH /api/v1/canvases/[canvasId]` - Update canvas ✅
- `DELETE /api/v1/canvases/[canvasId]` - Delete canvas ✅ **NEW**
- `POST /api/v1/canvases/[canvasId]/duplicate` - Duplicate canvas ✅
- `POST /api/v1/canvases/[canvasId]/thumbnail` - Generate thumbnail ✅
- `POST /api/v1/canvases/[canvasId]/public` - Toggle public sharing ✅

**Canvas Items:**
- `GET /api/v1/canvas-items` - List items (with viewport filtering) ✅
- `POST /api/v1/canvas-items` - Create item ✅
- `PATCH /api/v1/canvas-items/[itemId]` - Update item (optimistic locking) ✅
- `DELETE /api/v1/canvas-items/[itemId]` - Delete item ✅

**Comments:**
- `GET /api/v1/items/[itemId]/comments` - List comments ✅ **IMPROVED** (pagination added)
- `POST /api/v1/items/[itemId]/comments` - Create comment ✅
- `PATCH /api/v1/items/[itemId]/comments/[commentId]` - Update comment ✅
- `DELETE /api/v1/items/[itemId]/comments/[commentId]` - Delete comment ✅

**Sharing:**
- `POST /api/v1/canvases/[canvasId]/share` - Share canvas ✅
- `PATCH /api/v1/canvases/[canvasId]/share/[shareId]` - Update permissions ✅
- `DELETE /api/v1/canvases/[canvasId]/share/[shareId]` - Revoke access ✅
- `GET /api/v1/shared-canvases` - List shared with user ✅
- `GET /api/v1/share/[token]` - Access public canvas ✅

**Templates:**
- `GET /api/v1/templates` - List templates ✅
- `POST /api/v1/templates` - Save as template ✅
- `PATCH /api/v1/templates/[templateId]` - Update template ✅
- `DELETE /api/v1/templates/[templateId]` - Delete template ✅
- `POST /api/v1/templates/[templateId]/use` - Create from template ✅

**Version History:**
- `GET /api/v1/canvases/[canvasId]/versions` - List versions ✅
- `POST /api/v1/canvases/[canvasId]/versions` - Create snapshot ✅
- `POST /api/v1/canvases/[canvasId]/versions/[versionId]/restore` - Restore version ✅

**Utilities:**
- `GET /api/v1/search` - Global search ✅
- `POST /api/v1/upload` - Image upload ✅ **SECURED** (SVG removed)
- `POST /api/v1/unfurl` - Bookmark metadata ✅
- `GET /api/v1/activities` - Activity feed ✅
- `GET /api/health` - Health check ✅
- `GET /api/metrics` - Prometheus metrics ✅

**Missing/Planned:**
- `GET /api/v1/items/[itemId]/comments/[commentId]` - Get single comment
- `PUT /api/v1/templates/[templateId]` - Full template update
- `/api/collaboration/[canvasId]` - WebSocket endpoint for real-time

---

### 3.6. Security Policies

**Authentication & Sessions:**
- ✅ Passwords: Argon2id hashing (memory: 19456 KiB, time: 2, parallelism: 1)
- ✅ Password Strength: zxcvbn score >= 3, minimum 10 characters
- ✅ Sessions: Database-backed, HttpOnly cookies, SameSite=Lax, 30-day max age
- ✅ CSRF Protection: SameSite cookies + NextAuth built-in tokens
- ⚠️ Token Validation: Should use constant-time comparison (timing attack risk)

**Authorization:**
- ✅ Ownership checks at database query level
- ✅ Permission hierarchy: OWNER > EDIT > COMMENT > VIEW
- ✅ Canvas access verification before all operations
- ✅ Public canvas read-only enforcement

**Input Validation & Sanitization:**
- ✅ Zod validation on all API inputs
- ✅ Prototype pollution protection
- ✅ HTML/XSS sanitization (sanitize-html)
- ✅ URL validation (blocks javascript:, data:, vbscript:)
- ✅ Filename sanitization (path traversal prevention)
- ⚠️ DOMPurify not installed (edge-case XSS risk)

**Content Security Policy:**
- ✅ Strict nonce-based CSP (no unsafe-inline/eval)
- ✅ X-Frame-Options: DENY
- ✅ X-Content-Type-Options: nosniff
- ✅ Referrer-Policy: strict-origin-when-cross-origin
- ⚠️ HSTS only in production (should be always-on)

**Rate Limiting:**
- ✅ API endpoints: 100 requests / 15 minutes
- ✅ Auth endpoints: 5 requests / 15 minutes
- ⚠️ In-memory implementation (not production-ready for scale)
- 🔴 **Must replace with Redis before multi-instance deployment**

**File Upload Security:**
- ✅ MIME type validation
- ✅ File extension validation
- ✅ File size limits (5MB max)
- ✅ Unique filename generation (timestamp + crypto.randomBytes)
- ✅ Path traversal prevention
- ✅ **SVG uploads blocked** (XSS prevention)
- ⚠️ No virus/malware scanning

**SSRF Protection (Bookmark Unfurling):**
- ✅ IP validation (blocks private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
- ✅ Size limits (2MB max download)
- ✅ Timeout limits (10s max)
- ✅ Redirect validation
- ✅ Protocol restrictions (HTTP/HTTPS only)

**SQL Injection Prevention:**
- ✅ Prisma ORM with parameterized queries
- ✅ No raw SQL (except safe viewport filtering with Prisma.sql + escaped params)

**Logging Security:**
- ✅ Structured JSON logging (Pino)
- ✅ PII redaction (password, token, apiKey, etc.)
- ✅ Correlation IDs for request tracking
- ⚠️ Console.log instances bypass redaction (17+ occurrences to fix)

---

### 3.7. Performance & Scalability

**Performance Budgets (ADR-0007):**
- Landing Page: < 100KB gzipped JS
- Canvas Page (Initial Load): < 150KB gzipped JS
- Canvas libraries: Lazy-loaded
- Bundle analysis: Available via `ANALYZE=true pnpm build`

**Optimization Strategies:**
- ✅ Viewport-based canvas item loading
- ✅ Database indexes on frequently queried fields
- ✅ TanStack Query client-side caching (1 min stale time)
- ✅ Debounced autosave (300ms)
- ✅ Optimistic updates for UI responsiveness
- ✅ Pagination on list endpoints (canvases, comments, activities)
- ✅ Lazy loading of heavy components
- ⚠️ Redis server-side caching deferred (ADR-0011 triggers not yet met)

**Scalability Considerations:**
- Single-instance deployment: ✅ Ready
- Multi-instance deployment: ⚠️ Requires Redis for rate limiting and caching
- Database connection pooling: ✅ Configured (5 serverless, 20 traditional)
- Read replicas: Not yet needed (current scale)

---

### 3.8. Operations & Observability

**CI/CD Pipeline:**
- ✅ Linting (ESLint + Prettier)
- ✅ Type checking (TypeScript)
- ✅ Unit tests (Vitest)
- ✅ Security audit (`pnpm audit`)
- ✅ Build verification
- ⚠️ E2E tests configured but incomplete
- ✅ Bundle size analysis available

**Health & Monitoring:**
- ✅ `/api/health` - Deep health checks (database, cache connectivity)
- ✅ `/api/metrics` - Prometheus format metrics
- ✅ Structured logging with correlation IDs
- ⚠️ Error tracking integration incomplete (Sentry TODOs)
- ⚠️ Log aggregation not configured (CloudWatch/Datadog pending)

**Database Operations:**
- ✅ Prisma migrations
- ✅ Database seed script
- ⚠️ Backup policy defined but not automated
- ⚠️ Point-in-Time Recovery (PITR) procedure not tested

**Environment Configuration:**
- ✅ Environment variable validation (Zod)
- ✅ `.env.example` with all required variables
- ✅ Separate configs for dev/staging/prod
- ✅ Feature flags (e.g., FEATURE_BOOKMARK_UNFURLING)

---

## 4. Development Process & Standards

### 4.1. House Rules

**File Structure:**
- ✅ Feature-based organization (`src/features/*`)
- ✅ TypeScript path aliases (`@/*`, `@/features/*`, `@/lib/*`)
- ✅ API routes in `/app/api/v1/*`
- ✅ Shared components in `/components/*`
- ✅ Documentation in `/docs/*` with ADRs in `/docs/adr/*`

**Code Style:**
- ✅ ESLint enforced via pre-commit hooks
- ✅ Prettier for formatting
- ✅ Husky + lint-staged for pre-commit validation
- ✅ Conventional Commits specification

**Code Quality Standards:**
- ✅ TypeScript strict mode
- ✅ No `any` types (exceptions documented)
- ✅ Zod validation on all API boundaries
- ✅ Error boundaries for React components
- ✅ JSDoc on public APIs (improving)

---

### 4.2. Testing Strategy

**Coverage Requirements:**
- Target: 80%+ for API routes and critical business logic
- Current: ~15% (needs expansion)

**Test Types:**
- Unit Tests (Vitest): Auth, validation, utilities
- Integration Tests: API routes (incomplete)
- E2E Tests (Playwright): Critical flows (incomplete)
- Component Tests: React components (minimal)

**Testing Gaps to Address:**
- E2E: User flows (registration, login, canvas CRUD, collaboration)
- API: Integration tests for all endpoints
- Hooks: Custom React hooks (use-canvases, use-autosave, etc.)
- Components: Canvas, dialogs, forms

---

### 4.3. State Management Policy (ADR-0005)

**Server State (TanStack Query):**
- Canonical source of truth for all persisted data
- Includes: users, canvases, canvas items, comments, templates, shares, activities
- Caching with configurable stale time (default 1 min)
- Automatic refetching on window focus/reconnect

**Client State (Zustand):**
- Strictly for ephemeral, non-persistent UI state
- Examples: selected item ID, active tool, zoom level, open/closed dialogs, theme mode
- Never used for data that should persist to backend

**Real-Time Updates:**
- Current: Polling-based (5s active, 30s inactive)
- Future: WebSocket + Y.js CRDT (frontend ready, backend pending)

---

### 4.4. LLM Collaboration Protocol

- ✅ Acknowledge this document before starting a task
- ✅ Propose a brief plan before writing code
- ✅ Submit changes in small, logical increments
- ✅ Update SENATE.md when architectural decisions are made
- ✅ Create ADRs for significant technical decisions
- ✅ Document known issues and technical debt

---

## 5. Known Issues & Technical Debt

### 5.1. Critical Issues (P0) - Production Blockers

**See Section 2.4 for complete list**

Key items:
1. Rate limiting infrastructure (in-memory → Redis)
2. Email service integration (console → SendGrid/SES)
3. WebSocket collaboration backend (85% done, needs server)
4. DOMPurify installation (system dependency issues)

---

### 5.2. Security Findings (From Latest Audit)

**FIXED:**
- ✅ SVG upload XSS vulnerability
- ✅ Import path issues (would crash app)
- ✅ Missing pagination (DoS risk)
- ✅ Inconsistent error handling (partial)

**REMAINING:**
- ⚠️ Token timing attacks (use constant-time comparison)
- ⚠️ Console logging bypasses PII redaction (17 instances)
- ⚠️ Rate limiting not production-ready (Redis needed)
- ⚠️ DOMPurify missing (edge-case XSS)
- ⚠️ HSTS only in production (should be always-on)

---

### 5.3. API Improvements Needed

**FIXED:**
- ✅ GET /api/v1/canvases/[canvasId] (was missing)
- ✅ DELETE /api/v1/canvases/[canvasId] (was missing)
- ✅ Comments pagination (was unlimited)

**REMAINING:**
- GET /api/v1/items/[itemId]/comments/[commentId] (individual comment)
- PUT /api/v1/templates/[templateId] (full update)
- Standardize all error responses to use errorResponse() helper
- Add rate limiting to upload/unfurl endpoints

---

### 5.4. Code Quality Issues

**Type Safety:**
- `src/app/api/v1/canvas-items/route.ts:43` - `content: data.content as any`
- `src/app/api/v1/canvas-items/[itemId]/route.ts:91` - `content: body.content as any`
- `src/app/api/v1/templates/route.ts:82` - `const where: any = {}`
- Fix: Use proper Prisma types (`Prisma.JsonValue`, `Prisma.CanvasWhereInput`)

**Performance:**
- N+1 queries in comments route
- Templates route loads all items (should paginate or count only)
- Missing memoization in canvas components
- QueryClient instantiation at module level

**Consistency:**
- Mix of auth() vs requireAuth() patterns
- Console logging instead of structured logger
- Inconsistent error handling

---

### 5.5. Testing Gaps

- E2E tests: Critical flows not covered
- API tests: Routes lack integration tests
- Hook tests: Custom hooks untested
- Component tests: Minimal coverage

---

### 5.6. Feature Completeness

**85% Complete - Outstanding Items:**

1. **WebSocket Collaboration** (15% remaining)
   - Frontend: ✅ 100% (Y.js, cursors, presence)
   - Backend: ❌ 0% (needs server implementation)

2. **Zoom Persistence** (95% complete)
   - UI: ✅ Works
   - Backend: ⚠️ Not saved to database (TODO comment exists)

3. **SVG Export** (0% complete)
   - UI: Disabled with "Coming Soon" label
   - Decision: Implement or remove from UI

4. **Error Tracking** (0% complete)
   - TODOs in code for Sentry integration
   - Currently logs to console only

---

## 6. Documentation Map

### 6.1. Primary Documentation

- **SENATE.md** (this file) - Master project guide
- **README.md** - Quick start and overview
- **AUDIT_SUMMARY.md** - Latest comprehensive audit (Nov 2025)
- **API_AUDIT_REPORT.md** - Detailed API analysis
- **QUICKSTART.md** - Getting started guide

### 6.2. Implementation Summaries

- **IMPLEMENTATION_COMPLETE.md** - Phase 1-4 completion
- **PHASE_2_COMPLETE.md** - Rich content features
- **PHASE_3_SUMMARY.md** - Collaboration features
- **SHARING_FEATURE_SUMMARY.md** - Sharing implementation

### 6.3. Technical Guides

- **docs/API.md** - Complete API reference
- **docs/MONITORING.md** - Observability guide
- **docs/LOGGING.md** - Structured logging
- **docs/ACCESSIBILITY.md** - A11y guidelines
- **docs/TESTING_GUIDE.md** - Testing strategies
- **docs/DATABASE_INDEXES.md** - Performance optimization
- **docs/REAL_TIME_UPDATES.md** - Update strategies

### 6.4. Architectural Decision Records (ADRs)

- **docs/adr/README.md** - ADR index
- **ADR-0001 to ADR-0012** - All accepted decisions

### 6.5. Operations

- **docs/operations/DATABASE_BACKUP_POLICY.md** - Backup procedures
- **docs/operations/RESTORE_PROCEDURES.md** - Recovery steps

---

## 7. Future Vision & Roadmap

> *This section incorporates findings from the December 2025 deep-dive analysis, competitive research, and innovative feature brainstorming. See `IMPROVEMENTS.md` for detailed technical specifications.*

---

### 7.1. Immediate Actions (Week 1-2) 🔴

**Critical Security & Stability:**

| Task | Priority | Effort | Status |
|------|----------|--------|--------|
| Install `isomorphic-dompurify` for XSS protection | CRITICAL | 1 day | ⬜ |
| Implement Redis-based rate limiting | CRITICAL | 3 days | ⬜ |
| WebSocket authentication (session validation) | CRITICAL | 2 days | ⬜ |
| Replace console.log with structured logger | HIGH | 1 day | ⬜ |
| Account lockout after failed attempts | HIGH | 1 day | ⬜ |

---

### 7.2. Short Term (Week 3-4) 🟡

**Performance & Quality:**

| Task | Priority | Effort |
|------|----------|--------|
| Redis caching layer for canvas data | HIGH | 3 days |
| Fix `useCreateCanvasItem` hook usage in Canvas.tsx | HIGH | 1 hour |
| Remove duplicate `useDebounce` hooks | MEDIUM | 30 min |
| Add Error Boundaries to Canvas components | MEDIUM | 2 hours |
| Implement code splitting for dialogs | MEDIUM | 1 day |
| Add ARIA labels for accessibility | MEDIUM | 2 days |

---

### 7.3. Medium Term - Catch Up to Competitors (Week 5-8) 🟢

**Features competitors have that we don't:**

#### AI Features (CRITICAL GAP)
- [ ] AI note generation (GPT-4/Claude integration)
- [ ] Smart summarization of canvas contents
- [ ] Auto-tagging based on content
- [ ] Bookmark insights extraction

#### Integration Ecosystem
- [ ] Browser extension for quick capture
- [ ] Slack integration (share canvases, notifications)
- [ ] Zapier connector for automation

#### Drawing & Diagramming
- [ ] Freehand drawing tools
- [ ] Arrow connectors between items
- [ ] Shape library (rectangles, circles, etc.)
- [ ] Grouping/frames

#### Collaboration Enhancements
- [ ] Quick reactions (emoji stamps)
- [ ] Cursor chat
- [ ] Follow mode
- [ ] Presentation mode

#### Mobile & Offline
- [ ] PWA improvements (touch gestures)
- [ ] Offline mode with Y.js persistence
- [ ] Native mobile app (React Native)

#### Templates
- [ ] 10+ starter templates
- [ ] Template categories (brainstorming, planning, etc.)
- [ ] Template marketplace

---

### 7.4. Long Term - Differentiation Features (Month 3+) 💡

**Innovative features NO competitor has:**

#### 🥇 Priority 1 - High Impact, Medium Effort

| Feature | Description | Tagline |
|---------|-------------|---------|
| **Living Bookmarks** | Bookmarks auto-update when source page changes | *"Your bookmarks update themselves"* |
| **Canvas Time Machine** | Visual time-lapse of canvas evolution | *"Watch your ideas evolve"* |
| **AI Personas** | 5 AI assistants (Critic, Dreamer, Analyst, Connector, Simplifier) | *"Think with 5 different minds"* |

#### 🥈 Priority 2 - Unique Value Propositions

| Feature | Description |
|---------|-------------|
| **Serendipity Engine** | Surfaces forgotten connections between items |
| **Canvas Rituals** | Built-in morning pages, weekly review, gratitude prompts |
| **Canvas Autopilot** | AI continuously organizes your canvas |

#### 🥉 Priority 3 - Future Innovation

| Feature | Description |
|---------|-------------|
| **Canvas Genetics** | Fork and evolve canvases like GitHub repos |
| **Spatial Audio** | Hear collaborators based on canvas position |
| **AR Canvas Layer** | Overlay canvas on physical world |

---

### 7.5. Competitive Positioning

**Current:** Basic infinite canvas for notes & bookmarks

**Target Position (choose one):**

1. **"The Developer's Canvas"**
   - GitHub integration, code blocks, Markdown support
   - Competition: Obsidian, Notion

2. **"The Simple Collaboration Board"**
   - Simpler than Miro, cheaper, faster
   - Competition: FigJam, tldraw

3. **"The AI-First Visual Workspace"**
   - Best-in-class AI features
   - Competition: Notion AI, AFFiNE

---

### 7.6. Testing & Quality Roadmap

| Phase | Coverage | Timeline |
|-------|----------|----------|
| Current | ~15% | - |
| Phase 1 | 40% (unit tests for utils) | 1 week |
| Phase 2 | 60% (API integration tests) | 2 weeks |
| Phase 3 | 80% (E2E + visual regression) | 1 month |

---

### 7.7. DevOps & Infrastructure

- [ ] OpenTelemetry distributed tracing
- [ ] GitHub Actions CI/CD workflow
- [ ] Multi-stage Docker builds
- [ ] Database read replicas (when needed)
- [ ] Multi-region deployment (when global)

---

## 8. Deployment Readiness Checklist

### 8.1. Single-Instance Deployment

- ✅ Application builds successfully
- ✅ All critical bugs fixed
- ✅ Security headers configured
- ✅ Authentication working
- ✅ Database migrations ready
- ✅ Environment variables documented
- ✅ Health checks implemented
- ⚠️ Email service integration needed
- ⚠️ Error tracking recommended

**Status:** 🟢 Ready for single-instance production deployment

### 8.2. Multi-Instance/Scaled Deployment

- ❌ Redis-based rate limiting **REQUIRED**
- ❌ WebSocket authentication **REQUIRED**
- ⚠️ Redis caching
- ⚠️ Log aggregation service

**Status:** 🔴 NOT ready for multi-instance without Redis

---

## 9. Documentation Structure

**Consolidated Documentation (6 files):**

| File | Purpose |
|------|---------|
| **SENATE.md** | Master project guide (this file) |
| **README.md** | Quick start and project overview |
| **IMPROVEMENTS.md** | Deep-dive analysis, competitive research, feature specs |
| **ARCHITECTURE.md** | System architecture diagrams and data flows |
| **QUICKSTART.md** | Getting started guide |
| **SETUP.md** | Environment setup instructions |

**Additional Documentation:**
- `docs/adr/` - Architectural Decision Records (ADR-0001 to ADR-0012)
- `docs/API.md` - Complete API reference
- `docs/operations/` - Backup and recovery procedures

---

## 10. Change Log

### v4.0 (December 4, 2025)
- **Consolidated:** Reduced documentation from 32 files to 6 files
- **Added:** Comprehensive competitive analysis (Miro, FigJam, Obsidian, etc.)
- **Added:** 20 innovative feature ideas (Living Bookmarks, AI Personas, etc.)
- **Restructured:** Future roadmap with competitor-aware prioritization
- **Identified:** Critical gaps (AI, integrations, drawing tools, mobile)

### v3.0 (November 17, 2025)
- **Fixed:** 5 critical issues (imports, endpoints, XSS, pagination, errors)
- **Improved:** Security score from 7.5/10 to 8.1/10
- **Added:** GET and DELETE endpoints for Canvas

### v2.0 (Previous)
- Completed Phase 1-4 implementation
- Code audit with 45/45 issues resolved
- Added sharing, templates, rich text, search

### v1.0 (MVP)
- Initial MVP with 6 slices complete

---

## 11. Glossary

| Term | Definition |
|------|------------|
| **ADR** | Architectural Decision Record |
| **CRDT** | Conflict-free Replicated Data Type |
| **CSP** | Content Security Policy |
| **CSRF** | Cross-Site Request Forgery |
| **Y.js** | CRDT library for real-time collaboration |

---

**Document Version:** 4.0
**Last Updated:** December 4, 2025
**Next Review:** When AI features are implemented
**Maintained By:** Project Owner + AI Assistants

---

*See `IMPROVEMENTS.md` for detailed technical specifications, code examples, and implementation guides.*

