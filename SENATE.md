# SENATE.md: Master Project Guide for CanvasCollect (v2.0)

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

### 2.1. Task Board
| Task | Status | Assignee | Notes |
|------|--------|----------|-------|
| **Slice 1:** Project Setup | DN | Claude | Dependencies, Scaffolding, Tooling ✅ |
| **Slice 2:** Auth & Data Model | DN | Claude | DB, Prisma Schema, Auth UI & API ✅ |
| **Slice 3:** The Blank Canvas | DN | Claude | Protected route, basic Konva stage ✅ |
| **Slice 4:** Note Item CRUD | DN | Claude | Create, Move, Resize, Delete Notes ✅ |
| **Slice 5:** Bookmark Item CRUD | DN | Claude | Create, Move, Resize, Delete Bookmarks ✅ |
| **Slice 6:** MVP Hardening | DN | Claude | Security Headers, Final Testing ✅ |

*Legend: NS=Not Started, IP=In Progress, DN=Done*

**MVP Status:** ✅ **COMPLETE** - All 6 slices delivered (Commit: 06d8339)

### 2.2. Pending Decisions
*(No pending decisions at this time.)*

### 2.3. Architectural Decision Log (ADR)
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

### 3.1. MVP Scope & Non-Goals
*   **MVP Scope:** A secure, multi-canvas application where a single user can perform full CRUD operations on Note and Bookmark items. The application must be performant, testable, and adhere to all specified policies.
*   **Explicit Non-Goals for MVP:** Real-time collaboration, AI features, image uploads, sharing, complex organization RBAC, payment systems, native mobile apps.

### 3.2. Phased Roadmap
*   **Phase 1 (MVP):** Core single-user functionality as defined here.
*   **Phase 2 (Enriching Content):** Image uploads, Rich Text (Tiptap), bookmark unfurling, tagging, Undo/Redo, Grid/Snapping.
*   **Phase 3 (Collaboration):** Sharing canvases, real-time multi-user editing (via chosen Real-Time Strategy).
*   **Phase 4 (Improving UX):** Advanced search, Command Palette (`cmdk`).

### 3.3. Technology Stack (Definitive)
*   **Package Manager:** pnpm
*   **Monorepo Strategy:** Single repository for MVP; may evolve to a pnpm workspace if needed.
*   **Node.js Runtime:** Current LTS
*   **Framework:** Next.js (App Router)
*   **Language:** TypeScript (strict mode)
*   **Styling:** Material UI (MUI) with `sx` prop (Emotion)
*   **Client State:** Zustand
*   **Server State:** TanStack Query (React Query)
*   **Forms:** react-hook-form + Zod
*   **Canvas:** Konva.js + react-konva
*   **Database:** PostgreSQL
*   **ORM:** Prisma
*   **Authentication:** Auth.js (v5) with Prisma adapter
*   **Testing:** Playwright (E2E) + Vitest (Unit/Integration)
*   **Logging:** pino
*   **Environment:** `dotenv-safe` + Zod for validation
*   **Date/Time:** `date-fns`

### 3.4. Database Schema (Prisma)
*This schema incorporates all accepted amendments: multi-canvas, normalized geometry, audit trails, versioning, and all required indexes.*
```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String?   // Argon2id hash
  name          String?
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  canvases      Canvas[]
  sessions      Session[]
  accounts      Account[]
  
  createdItems  CanvasItem[] @relation("ItemCreatedBy")
  updatedItems  CanvasItem[] @relation("ItemUpdatedBy")
  deletedItems  CanvasItem[] @relation("ItemDeletedBy")
}

model Canvas {
  id          String      @id @default(cuid())
  name        String      @default("Untitled Canvas")
  userId      String
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  items       CanvasItem[]
  
  zoomLevel   Float       @default(1.0)
  panX        Float       @default(0)
  panY        Float       @default(0)

  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([userId, createdAt])
}

model CanvasItem {
  id          String   @id @default(cuid())
  canvasId    String
  canvas      Canvas   @relation(fields: [canvasId], references: [id], onDelete: Cascade)
  type        ItemType

  positionX   Float
  positionY   Float
  width       Float
  height      Float
  zIndex      Int      @default(0)
  
  content     Json     // Type-specific payload, e.g., { "text": "..." }

  version     Int      @default(1)
  deletedAt   DateTime?

  createdById String
  updatedById String?
  deletedById String?
  createdBy   User     @relation("ItemCreatedBy", fields: [createdById], references: [id])
  updatedBy   User?    @relation("ItemUpdatedBy", fields: [updatedById], references: [id])
  deletedBy   User?    @relation("ItemDeletedBy", fields: [deletedById], references: [id])

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([canvasId, deletedAt])
  @@index([canvasId, type])
  @@index([canvasId, zIndex])
  @@index([canvasId, updatedAt])
}

enum ItemType {
  NOTE
  BOOKMARK
}

model Session {
  id           String    @id @default(cuid())
  sessionToken String    @unique
  userId       String
  expires      DateTime
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  deviceInfo   String?
  revokedAt    DateTime?
}

model Account {
  // Standard Auth.js Account model
  id                 String  @id @default(cuid())
  userId             String
  type               String
  provider           String
  providerAccountId  String
  refresh_token      String? @db.Text
  access_token       String? @db.Text
  expires_at         Int?
  token_type         String?
  scope              String?
  id_token           String? @db.Text
  session_state      String?
  user               User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}
```

### 3.5. API & Data Handling
*   **API Versioning:** All API routes will be prefixed with `/api/v1`.
*   **Error Format:** Errors will conform to RFC 7807 `application/problem+json`.
*   **Autosave & Concurrency:** Client will send debounced updates (250-500ms). All `UPDATE` operations must include a `version` number in the `WHERE` clause to prevent stale writes. On a version mismatch, the client must refetch data.
*   **Real-Time Strategy:** The debounced autosave model is a placeholder for the single-user MVP. A formal ADR will be created to evaluate CRDTs (e.g., Y.js) for the future collaborative phase.

### 3.6. Security Policies
*   **Authentication:** Passwords must be hashed with **Argon2id**. Password strength will be enforced (e.g., zxcvbn score >= 3).
*   **Sessions:** Secure, `HttpOnly` cookies with `SameSite=Lax`. Sessions must support server-side revocation.
*   **Authorization:** All data-access APIs must perform ownership checks at the database query level.
*   **CSP:** A strict, nonce-based Content Security Policy will be enforced. `'unsafe-eval'` and `'unsafe-inline'` are forbidden.
*   **SSRF:** Bookmark unfurling (Phase 2) must be done in a sandboxed environment with strict validation on IPs, redirects, and response sizes.
*   **Rate Limiting:** A multi-layered strategy will be used: a gateway/WAF, plus specific limits on sensitive endpoints (login, register), and per-user limits.
*   **Input Validation:** All input from the client will be validated with Zod. This includes protection against prototype pollution.

### 3.7. Performance & Scalability
*   **Performance Budgets:**
    *   **Landing Page:** < 100KB gzipped JS.
    *   **Canvas Page (Initial Load):** < 150KB gzipped JS. Canvas libraries must be lazy-loaded.
*   **Data Loading:** The API will support viewport-based loading of canvas items to handle large canvases efficiently.
*   **Caching:** A Redis caching layer is deferred. The initial strategy relies on proper database indexing and TanStack Query's client-side caching. An ADR will define the triggers for implementing a server-side cache.

### 3.8. Operations & Observability
*   **CI/CD Pipeline:** The pipeline will run on every commit and must include: Linting -> Testing (Unit & Integration) -> Security Audit (`pnpm audit`) -> Build -> E2E Tests.
*   **Database Backups:** A policy must be in place for daily automated backups with a defined retention period and a tested Point-in-Time Recovery (PITR) procedure.
*   **Observability:** The application will expose a `/api/health` endpoint for deep health checks and a `/api/metrics` endpoint in Prometheus format. All logs will be structured JSON (via pino) and include a correlation ID.

---

## 4. Development Process & Standards

### 4.1. House Rules
*   **File Structure:** Code will be organized by feature. TypeScript path aliases (`@/features/*`) will be used.
*   **Code Style:** ESLint and Prettier will be enforced via pre-commit hooks.
*   **Commits:** All commits will follow the Conventional Commits specification.

### 4.2. Testing Strategy
*   A minimum of **80% test coverage** is required for all new API routes and critical business logic.
*   E2E tests must cover both "happy path" and key failure scenarios (e.g., authorization errors).

### 4.3. State Management Policy
*   **Server State (TanStack Query):** The canonical source of truth for all data persisted on the backend. This includes the user object, canvases, and canvas items.
*   **Client State (Zustand):** Strictly for ephemeral, non-persistent UI state. Examples: the ID of the currently selected item, the active tool ("select", "pan"), the current zoom level, the state of open/closed UI elements.

### 4.4. LLM Collaboration Protocol
*   Acknowledge this document before starting a task.
*   Propose a brief plan before writing code.
*   Submit changes in small, logical increments.

---

## 5. MVP Implementation Plan (Vertical Slices)

This plan executes the MVP by delivering testable, end-to-end value in each slice. Each task must have a "Definition of Done" checklist created before work begins, including items like: handles loading/error states, is responsive, includes tests, and meets security/accessibility standards.

*   **Slice 1: Project Setup & Tooling**
    *   **Goal:** A runnable, empty Next.js project with all tooling configured.
    *   **Tasks:** Perform dependency audit, scaffold the Next.js app, install and configure MUI, Zustand, Prettier, ESLint, and Husky.
*   **Slice 2: Authentication & Data Model**
    *   **Goal:** A user can register, log in, and log out. The database is set up.
    *   **Tasks:** Set up Docker and Prisma. Apply the initial schema migration. Build the auth UI and API routes. Implement the database seed script.
*   **Slice 3: The Protected Canvas**
    *   **Goal:** A logged-in user can access a protected page that renders a blank, pannable, zoomable canvas.
    *   **Tasks:** Create the protected canvas route. Build the basic `<Canvas />` component with Konva, implementing only pan and zoom functionality.
*   **Slice 4: Note Item CRUD**
    *   **Goal:** A user can create, move, resize, and delete Note items on their canvas.
    *   **Tasks:** Build the API endpoints for Note CRUD. Build the `<NoteItem />` component. Integrate with TanStack Query for data fetching and mutations.
*   **Slice 5: Bookmark Item CRUD**
    *   **Goal:** A user can create, move, resize, and delete Bookmark items.
    *   **Tasks:** Extend the API and UI to support the Bookmark item type.
*   **Slice 6: MVP Hardening & Testing**
    *   **Goal:** The MVP is secure and well-tested.
    *   **Tasks:** Implement the strict CSP and other security headers. Write the final E2E tests covering all MVP functionality.

---

## 6. Known Issues & Technical Debt

### 6.1. Critical Issues (P0) - Production Blockers

1. **Rate Limiting (Issue #24)** - `src/middleware/rate-limit.ts`
   - **Problem**: In-memory rate limiting won't work in multi-instance deployments
   - **Impact**: Bypass rate limiting in production clusters
   - **Fix**: Implement Redis-based rate limiting (see ADR-0011 triggers)
   - **Workaround**: Deploy as single instance until Redis implemented

2. **Email Service Integration (Issue #36)** - Auth API routes
   - **Problem**: Email verification and password reset log to console instead of sending emails
   - **Impact**: Critical auth features non-functional
   - **Fix**: Integrate SendGrid, AWS SES, or similar email service
   - **Files**:
     - `src/app/api/v1/auth/forgot-password/route.ts:59`
     - `src/app/api/v1/auth/send-verification/route.ts:60`

3. **Missing E2E Tests (Issue #28)**
   - **Problem**: No end-to-end test coverage for critical flows
   - **Impact**: Cannot verify production readiness
   - **Fix**: Add Playwright tests for:
     - User registration and login
     - Canvas CRUD and item manipulation
     - Sharing and collaboration
     - Undo/redo functionality

4. **N+1 Query in Comments (Issue #11)** - `src/app/api/v1/items/[itemId]/comments/route.ts:42-52`
   - **Problem**: Loads unnecessary data with multiple joins
   - **Impact**: Performance degradation with active canvases
   - **Fix**: Use selective `select` instead of full `include`

### 6.2. High Priority Issues (P1) - Type Safety & Performance

5. **Type Safety Issues (Issues #1-3)**
   - **Files**:
     - `src/app/api/v1/canvas-items/route.ts:43` - `content: data.content as any`
     - `src/app/api/v1/canvas-items/[itemId]/route.ts:91` - `content: body.content as any`
     - `src/app/api/v1/templates/route.ts:82` - `const where: any = {}`
   - **Fix**: Use proper Prisma types (`Prisma.JsonValue`, `Prisma.CanvasWhereInput`)

6. **Session Type Guard Missing (Issue #5)** - `src/lib/api/auth.ts:22`
   - **Problem**: Type assertion without runtime validation
   - **Impact**: Potential runtime errors if session.user.id is undefined
   - **Fix**: Add proper type guard before accessing session.user.id

7. **Templates Route N+1 (Issue #12)** - `src/app/api/v1/templates/route.ts:94-112`
   - **Problem**: Loads all items for all templates
   - **Impact**: Large payloads, slow response times
   - **Fix**: Return item count only or add pagination

8. **Viewport Filtering Limitation (Issue #16)** - `src/app/api/v1/canvas-items/route.ts:116-145`
   - **Problem**: Fetches all items then filters in memory
   - **Impact**: Performance degrades with large canvases (10k+ items)
   - **Note**: Current implementation is acceptable; future enhancement requires PostGIS

9. **Inconsistent Auth Patterns (Issue #23)**
   - **Problem**: Some routes use `requireAuth()`, others use `auth()` directly
   - **Fix**: Standardize on `requireAuth()` helper across all routes

10. **Missing API Tests (Issue #29)**
    - **Problem**: API routes lack unit tests
    - **Impact**: Cannot verify contract, error handling, validation
    - **Fix**: Add Jest/Vitest tests for all API routes

11. **Missing Hook Tests (Issue #30)**
    - **Problem**: React hooks lack unit tests
    - **Impact**: Cannot verify behavior, edge cases
    - **Fix**: Add React Testing Library tests for all custom hooks

### 6.3. Medium Priority Issues (P2) - Code Quality

12. **Inconsistent Error Handling (Issue #6)**
    - **Problem**: Mix of `errorResponse()` helper and manual error responses
    - **Fix**: Migrate all routes to use `errorResponse()` for consistency

13. **Console Logging (Issue #9)**
    - **Problem**: 15+ occurrences of `console.error` instead of structured logger
    - **Fix**: Replace with `logger` from `@/lib/logger`

14. **Missing Memoization (Issues #13-14)** - Canvas components
    - **Files**:
      - `src/app/canvas/[canvasId]/page.tsx:253-305` - Event handlers
      - `src/features/canvas/components/Canvas.tsx:107-121` - Item rendering
    - **Fix**: Wrap handlers in `useCallback` and items in `useMemo`

15. **QueryClient Instantiation (Issue #15)** - `src/app/canvas/[canvasId]/page.tsx:29`
    - **Problem**: Created at module level
    - **Fix**: Use singleton pattern at app level

16. **Business Logic in Components (Issue #21)** - `src/app/canvas/[canvasId]/page.tsx:126-240`
    - **Problem**: Keyboard handlers and delete logic in page component
    - **Fix**: Extract to `useCanvasKeyboardShortcuts` hook

### 6.4. Low Priority Issues (P3) - Polish

17. **Debug Console Logs (Issue #8)**
    - **Files**:
      - `src/app/api/v1/auth/send-verification/route.ts:52-58`
      - `src/app/api/v1/auth/forgot-password/route.ts:51-54`
    - **Fix**: Remove or replace with proper logger before production

18. **Missing Zoom Persistence (Issue #18)** - ADR-0009 Violation
    - **File**: `src/app/canvas/[canvasId]/page.tsx:337`
    - **Problem**: Zoom level not saved to database
    - **Fix**: Implement debounced zoom persistence

19. **Missing Component Tests (Issue #31)**
    - **Problem**: No tests for Canvas, NoteItem, BookmarkItem, auth forms
    - **Fix**: Add component tests with Testing Library

20. **Code Duplication (Issue #38)** - Delete logic
    - **File**: `src/app/canvas/[canvasId]/page.tsx:142-228, 355-393`
    - **Fix**: Extract to `createDeleteCommand` utility

21. **Missing JSDoc (Issue #39)**
    - **Problem**: Inconsistent API documentation
    - **Fix**: Add JSDoc to all public APIs

### 6.5. Architectural Notes

**Database Indexes:**
- Missing composite index for comments: `@@index([itemId, deletedAt, createdAt])`

**Performance Budgets (ADR-0007):**
- Current implementation: Unknown (needs measurement)
- Target: Landing <100KB, Canvas <150KB gzipped JS
- Action: Add bundle size checks to CI

**Test Coverage:**
- Current: ~15% (estimated)
- Target: 80%+ for API routes and business logic
- Gap: E2E tests, hook tests, component tests

**Security:**
- ✅ CSP implemented (ADR-0012)
- ✅ Security headers configured
- ⚠️ Rate limiting not production-ready (single instance only)
- ⚠️ CSRF protection needs verification

### 6.6. Future Enhancements (Post-MVP)

These features are deferred per ADR decisions:

1. **Redis Caching (ADR-0011)** - Implement when triggers met:
   - P95 latency > 500ms for 3+ days
   - Database CPU > 70% for 24+ hours
   - Total items > 100,000
   - Concurrent users > 500

2. **Real-Time Collaboration (ADR-0010)** - Phase 3:
   - Y.js CRDT implementation
   - WebSocket infrastructure
   - Presence indicators
   - Conflict resolution

3. **Production Infrastructure:**
   - Multi-instance deployment with Redis
   - Database read replicas
   - CDN for static assets
   - Log aggregation (CloudWatch, Datadog)
   - Error tracking (Sentry)

### 6.7. Prisma Client Workaround (Development Only)

**Issue**: Prisma engines cannot be downloaded in restricted network environments

**Current Workaround** (development):
- Manual SQL migration execution
- Symlink to `@prisma/client` for imports
- Not suitable for production

**Production Solution**:
- Use environment with normal internet access
- Pre-bundle Prisma engines in Docker image
- Or use Prisma binary targets in `schema.prisma`