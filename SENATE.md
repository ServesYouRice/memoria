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
| ADR-0010 | Real-Time Collaboration Strategy | Proposed | `docs/adr/ADR-0010-realtime-collaboration-strategy.md` |
| ADR-0011 | Server-Side Caching Strategy | Proposed | `docs/adr/ADR-0011-server-side-caching-strategy.md` |
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