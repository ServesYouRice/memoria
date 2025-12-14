System Overview
- Next.js 15 app router app with custom HTTP server (`server.ts`) hosting both Next and a WS-based Yjs collaboration backend (`src/lib/collaboration/websocket-server.ts`). Backend uses Prisma/PostgreSQL, optional Redis for cache/rate limiting, NextAuth credentials auth, Pino logging, and Sentry instrumentation.
- Middleware pipeline (`src/middleware.ts`) applies CORS, security headers, CSP, API versioning, and rate limits. API layer mixes generic wrappers (`src/lib/api/route-handler.ts`, `src/lib/errors.ts`) with route-level try/catch and Prisma access.
- Frontend built on MUI/Emotion, Konva canvas, TanStack Query for server state, Zustand for UI state, and a large canvas surface (`src/features/canvas/components/CanvasBoard.tsx`) plus feature dialogs. Providers wire React Query, SessionProvider, and theming (`src/app/providers.tsx`).
- Configuration is split between `next.config.mjs` (bundle analyzer, security headers, TS/ESLint ignores) and a legacy `next.config.js`; env validation exists (`src/lib/env.ts`) but is not imported.

Architectural Review
- CSP/nonce mismatch: middleware sets a strict nonce-based CSP (`src/middleware/csp.ts`) but the layout and Emotion/MUI styles (`src/app/layout.tsx`) never receive or apply the nonce. Current policy blocks inline styles/scripts without a nonce, so styles can be rejected in production. Plumb the nonce into rendered `<style>`/`<Script>` or relax the policy to allow Emotion’s injected styles.
- Divergent security configuration spread across middleware (`src/middleware/security-headers.ts`), runtime helpers (`src/lib/security/headers.ts`), and Next headers (`next.config.mjs`). The duplication risks drift and double headers; consolidate to a single source of truth and reuse helpers.
- Error contract inconsistency: routes mix `withApiHandler`, manual try/catch with `errorResponse`, and raw `throw new Error` (e.g., unauthorized in `src/app/api/v1/canvases/route.ts`, validation throws in `src/app/api/v1/templates/route.ts`). This yields 500s instead of RFC7807/401/403 responses and breaks clients. Standardize on a single error helper and ApiError classes.
- Idempotency keys are keyed only by `key` (`src/lib/api/route-handler.ts`) and ignore method/path on replay; a reused key on a different endpoint can return the previous body/status. Add a composite uniqueness on (key, userId, method, path) and expire old keys.
- Collaboration backend assumes single-process state: in-memory maps in `src/lib/collaboration/websocket-server.ts` and `src/lib/collaboration/yjs-provider.ts` are not shared across instances, and persistence only updates existing rows. No auth secret reuse (`AUTH_SECRET` vs NextAuth’s `NEXTAUTH_SECRET`) or reconnection/backoff. Define a scaling story (Redis/Yjs provider, presence store) and align secrets.
- Build/config hygiene: both `next.config.mjs` and `next.config.js` exist; the active config ignores TypeScript and ESLint errors, undermining CI guarantees. Remove the legacy file and re-enable type/lint failures in builds.
- Environment validation (`src/lib/env.ts`) never runs because it is not imported. Invalid configs won’t fail fast; wire it into server/bootstrap.

Code Quality & Smells
- Schema/ID mismatch: cuid-based canvas IDs are validated as UUIDs in `src/lib/validation/extension.ts` and `src/lib/validation/ai.ts`, breaking `/api/v1/extensions/clip`, `/api/v1/webhooks/trigger`, and `/api/v1/ai/serendipity` for legitimate IDs. Update schemas to `cuid()`.
- Cache invalidation gap: canvas data is cached in `src/app/api/v1/canvases/[canvasId]/route.ts`, but item update/delete routes (`src/app/api/v1/canvas-items/[itemId]/route.ts`) and version restores never invalidate, returning stale canvases after edits. Add invalidation hooks on every mutation/version restore.
- Unauthorized errors are thrown as plain `Error` under `withApiHandler` (`src/app/api/v1/canvases/route.ts`), which are converted to 500. Use `UnauthorizedError`/`Problems.Unauthorized` consistently.
- API key handling stores plaintext keys and updates `lastUsedAt` without await (`src/lib/api/api-key-auth.ts`); no hashing, rotation, or rate limits. Keys can be exfiltrated from DB and reused. Hash keys and enforce expiry/quotas.
- Upload handler writes to `public/uploads` without ensuring the directory exists, quota enforcement, or content scanning (`src/app/api/v1/upload/route.ts`). A bad path causes runtime failure; untrusted files stay publicly served. Ensure directory creation, user scoping, and scanning/size accounting.
- Search endpoint lacks pagination and share-aware access (`src/app/api/v1/search/route.ts`); raw JSON ILIKE queries return owner-only data up to a fixed 50 results with no offset, and shared canvases are invisible.
- Monolithic canvas component (`src/features/canvas/components/CanvasBoard.tsx`) mixes gesture handling, data fetching, collaboration, and UI state in a single 600+ line file, which hurts maintainability and testability. Split into focused subcomponents/hooks.

Logic & UX/Flow Issues
- `useCollaboration` does not reconnect or surface connection errors (`src/lib/hooks/use-collaboration.ts`); if the socket drops the UI silently stays offline. Add retry/backoff and status feedback.
- Yjs persistence only updates existing items (`src/lib/collaboration/yjs-provider.ts`); new/deleted items created through the realtime doc are never persisted, so they disappear after a restart. Add create/delete handling and conflict checks.
- Canvas items GET without viewport params returns all items with no limit (`src/app/api/v1/canvas-items/route.ts`), which can freeze the client on large canvases. Provide sane defaults/pagination.
- CSP style-src allows only self+nonce, but Emotion/MUI inject nonce-less styles; pages may render unstyled under CSP enforcement. Either attach the nonce to Emotion or loosen the policy.
- Search/serendipity features ignore shared canvases; collaborators via share links cannot use them even with permissions. Align with `requireCanvasAccess` semantics.

Performance & Optimization Opportunities
- Search uses `$queryRaw` with multiple `ILIKE` JSON probes and no full-text/GIN indexes (`src/app/api/v1/search/route.ts`), leading to full scans. Consider Postgres full-text or trigram indexes and pagination.
- Collaboration persistence runs updateMany per item every 30s (`src/lib/collaboration/yjs-provider.ts`) without batching/upsert or debounce on idle; heavy canvases will write frequently. Buffer changes, upsert, and batch.
- Cache remains warm but stale because mutations skip invalidation; users pay for extra fetches or see outdated data. Add cache busting in item/version mutations and when duplicating/restoring canvases.
- React Query fetchers throw generic errors without HTTP context (`src/lib/hooks/use-canvas-items.ts`), so the UI cannot differentiate auth vs validation vs server failures; map status codes to typed errors for better UX and retries.

Dependencies & Stack Analysis
- NextAuth v5 beta is in use; instrumentation warns but the WS server uses `AUTH_SECRET` instead of `NEXTAUTH_SECRET` (`src/lib/collaboration/websocket-server.ts`). Align secrets and monitor beta changes.
- Redis optionality logs a warning on every cache call when unset (`src/lib/cache/redis-client.ts`), adding noise. Log once or gate initialization.
- Duplicate Next configs (`next.config.js`, `next.config.mjs`); only one should remain. Current config disables TS/ESLint at build time—restore enforcement.

Testing & Best Practices
- Coverage gaps for collaboration server, upload, AI routes, and API-key auth; existing tests focus on rate limiting/cache/email. Add integration tests around these critical paths.
- No automated runtime env validation because `src/lib/env.ts` is unused; introduce a startup hook in `server.ts`/middleware to fail fast on misconfigurations.
- Build pipeline permits type and lint errors (`next.config.mjs`), weakening CI gates. Reinstate TS/ESLint checks in CI and builds.

Priority Action Plan
- High impact / High urgency
  - Fix CSP/nonce integration so MUI/Emotion styles load under CSP (`src/middleware/csp.ts`, `src/app/layout.tsx`).
  - Correct ID validation to cuid in extension/AI schemas (`src/lib/validation/extension.ts`, `src/lib/validation/ai.ts`).
  - Standardize error handling to ApiError/Problems for all routes and unauthorized flows (`src/app/api/v1/canvases/route.ts`, `src/app/api/v1/templates/route.ts`).
  - Add cache invalidation on all canvas mutations/version restores (`src/app/api/v1/canvas-items/[itemId]/route.ts`, version routes).
  - Secure API keys (hash at rest, enforce expiry/limits) and align WS auth secret with NextAuth (`src/lib/api/api-key-auth.ts`, `src/lib/collaboration/websocket-server.ts`).
  - Remove `next.config.js`, re-enable TS/ESLint failures in `next.config.mjs`, and run env validation on startup.

- High impact / Lower urgency
  - Add reconnection/backoff and status handling to collaboration client plus multi-instance persistence/upsert support (`src/lib/hooks/use-collaboration.ts`, `src/lib/collaboration/yjs-provider.ts`).
  - Redesign idempotency key uniqueness/expiry to include method/path/user (`src/lib/api/route-handler.ts`).
  - Implement pagination/indexing for search and limit default item fetches (`src/app/api/v1/search/route.ts`, `src/app/api/v1/canvas-items/route.ts`).
  - Harden upload handling with directory creation, quotas, and scanning (`src/app/api/v1/upload/route.ts`).

- Nice to have / Future improvements
- Refactor `src/features/canvas/components/CanvasBoard.tsx` into smaller units with isolated tests.
- Reduce Redis warning noise and centralize security header configuration.
- Expand test coverage for collaboration, uploads, AI, and API key flows; add contract tests for RFC7807 responses.

## Consolidated Actions (incorporating OPUS/GEMINI critiques)
- Idempotency reality check: `withIdempotency` is defined but not applied to any route. Either wire it into the write endpoints that need idempotence (e.g., AI generate, uploads, mutations) with composite key/expiry, or remove the model to avoid dead schema.
- Reactivity bug: Fix the `useCanvasStore.getState()` usage in `CanvasBoard.tsx` render paths to selector-based reads to restore updates.
- Missing failure states: Add visible error/retry states for canvas fetches instead of swallowing errors in CanvasBoard/use-canvas hooks.
- Missing UIs: If Workspaces/SavedView/API-key UI are in scope, add basic pages and CRUD; otherwise drop the models/endpoints to trim debt.
- Docs drift: Update ARCHITECTURE/README to reflect real-time via WebSockets (not “polling by default”) and the intended use of idempotency/versioning.
- Apply CSP fix in tandem with Emotion/MUI nonce handling to avoid unstyled flashes noted in critiques.

## Updated Action Plan (cross-LLM synthesis)

1) Platform stability
- Wire `env.ts` validation into startup; delete `next.config.js`; re-enable TS/ESLint failures.
- Fix CSP/nonce with Emotion/MUI, unify security headers, and align `AUTH_SECRET`/`NEXTAUTH_SECRET`.

2) Data/API correctness
- Fix cuid/uuid schema mismatches; standardize error handling to ApiError/Problems.
- Add cache invalidation on all canvas mutations/version restores; add pagination/limits to canvas-items/search.
- Decide on idempotency: either apply `withIdempotency` to write endpoints with scoped keys+expiry or drop the model.

3) Collaboration reliability
- Add WS reconnect/backoff + status UI; implement cross-instance Yjs persistence (create/delete/upsert) and reduce write churn.

4) Security & uploads
- Hash API keys, enforce expiry/quotas, and add rate limits; harden upload handler (ensure dir, quota, scanning, user scoping).

5) UI/UX and docs
- Fix CanvasBoard reactivity (`useCanvasStore` selector), add visible error/retry states for canvas fetches.
- Update docs to reflect real-time WS (not polling) and current feature set.
- Implement or drop orphaned features (Workspaces/SavedView/API-key UI); refactor CanvasBoard into smaller units.

6) Testing focus
- Add integration tests for collaboration, upload, AI, and API-key flows; contract tests for RFC7807 responses; avoid swallowing errors in fetchers.

# Technical Debt Register (from TECHNICAL_DEBT.md)

**Last Updated:** December 11, 2025  
**Project:** CanvasCollect (Memoria)  
**Status:** All critical issues resolved - remaining items are improvements

---

## Overview

This document tracks technical debt items that don't block functionality but should be addressed for long-term maintainability.

---

## 1. Architectural Refactoring

### 1.1 God Component: `CanvasBoard.tsx`

**Lines:** ~1437  
**Handles:** Canvas rendering, 35+ state variables, keyboard shortcuts, mouse events, drawing, collaboration, CRUD, 13 dialogs, context menu, selection, versioning, AI, export, AR, Whisper, templates

**Recommended Split:**
```
CanvasBoard.tsx           ~200 lines (orchestrator)
CanvasStage.tsx           Konva rendering
CanvasDialogs.tsx         Dialog composition
hooks/use-canvas-keyboard.ts
hooks/use-canvas-selection.ts
```

**Effort:** HIGH  
**Priority:** Low - works fine, just hard to maintain

---

### 1.2 Inconsistent Error Handling Patterns

Three parallel patterns exist:
1. Class-based: `throw new NotFoundError()`
2. Factory: `throw notFoundError('Canvas', id)`
3. Problems object: `return Problems.NotFound()`

**Recommendation:** Standardize on class-based errors  
**Effort:** MEDIUM

---

## 2. Type Safety

### 2.1 `as any` Casts

| Location | Count |
|----------|-------|
| `route-handler.ts` | 14 |
| `CanvasBoard.tsx` | Multiple |
| `websocket-server.ts` | Multiple |
| **Total** | 32+ |

**Effort:** MEDIUM  
**Priority:** Low - TypeScript strict mode is enabled

### 2.2 `@ts-ignore` Comments

| File | Count |
|------|-------|
| `password.ts` | 1 |
| `export-utils.ts` | 1 |
| `CanvasBoard.tsx` | 3 |

---

## 3. Code Smells

### 3.1 Magic Numbers in CanvasBoard.tsx

```typescript
width: 300, height: 200  // Default note dimensions - should use constants.ts
setTimeout(..., 3000)     // Thumbnail delay
setTimeout(..., 5000)     // Message timeout
```

### 3.2 React Rendering Issues

| Issue | Location |
|-------|----------|
| `useCanvasStore.getState()` in render | CanvasBoard.tsx:989 |
| Inline arrow functions in props | Throughout |
| Memory leak potential with timeouts | CanvasBoard.tsx:177 |

---

## 4. Dependencies

### 4.1 Beta/New Dependencies

| Dependency | Version | Risk |
|------------|---------|------|
| `next-auth` | 5.0.0-beta.25 | BETA in production |
| `react` | ^19.0.0 | Very recent |
| `next` | 15.0.3 | Very recent |
| `zxcvbn` | ^4.4.2 | Old package |

**Action:** Upgrade NextAuth when stable release is available

---

## 5. Testing Gaps

### 5.1 Coverage Summary

| Category | Files | Status |
|----------|-------|--------|
| Unit tests | 8 | Low - only utilities |
| E2E tests | 8 | Medium - core flows |
| Integration | 0 | None |

### 5.2 Missing Test Coverage

- [ ] Canvas CRUD operations
- [ ] Optimistic updates
- [ ] Collaboration sync
- [ ] AI integrations
- [ ] Visual regression tests

---

## 6. UI/UX Improvements

### 6.1 Missing States

| Component | Missing State |
|-----------|---------------|
| Canvas | Error boundary for crashes |

---

## Priority Matrix

| Priority | Items | Effort |
|----------|-------|--------|
| **Do if time permits** | Split CanvasBoard | HIGH |
| **Do if time permits** | Remove `as any` | MEDIUM |
| **Do if time permits** | Add integration tests | MEDIUM |
| **Do if time permits** | Standardize error handling | MEDIUM |
| **Wait for stable** | Upgrade NextAuth | LOW |
| **Nice to have** | Visual regression tests | HIGH |
| **Nice to have** | Error boundary | LOW |

---

## Completed Items

These were identified during the code review and have been resolved:

- Settings APIs (profile, password, account deletion)
- console.log -> logger replacement
- Autopilot version bug fix
- Canvas fetch efficiency
- zxcvbn/jspdf lazy loading
- Time Machine reload -> queryClient.invalidateQueries()
- N+1 queries in yjs-provider.ts -> prisma.$transaction()

---

*Generated from OPUS.md code review (December 08, 2025)*
## Gemini Validation & Critique

**Date**: December 11, 2025
**Reviewer**: Antigravity (Google DeepMind)

###  Validated Findings
1.  **God Component**: Strong agreement that CanvasBoard.tsx (1,400+ lines) is the primary maintainability bottleneck.
2.  **Missing UI**: Confirmed absence of /profile, /workspaces, and notification systems.
3.  **Beta Risk**: Validated that 
ext-auth@beta is a critical production risk.
4.  **Orphaned Models**: Confirmed Workspace and SavedView are completely unused.

###  Corrections & Nuances
1.  **IdempotencyKey**: While CODEX.md notes this is used in oute-handler.ts, my scan confirms that the wrapper withIdempotency is **never actually applied to any API route**. Therefore, OPUS.md is effectively correct: the model is dead code in the runtime application, even if referenced in a utility file.
2.  **Real-time Collaboration**: OPUS.md states 'Polling is default' based on docs. My code scan confirms a fully implemented WebSocket server (websocket-server.ts), but it lacks robust error handling and reconnection logic (as noted by CODEX.md). The documentation is stale.

###  Critical Additions
1.  **React Anti-Pattern**: The use of useCanvasStore.getState() inside the render loop of CanvasBoard.tsx is a severe reactivity bug that breaks the core 'Flux' pattern of React/Zustand.
2.  **Silent Failures**: The application lacks 'Failed to load' states for Canvases. If etchCanvas fails, it swallows the error, potentially leading to data loss fears.

---

## Antigravity Meta-Review: CODEX.md + Gemini Validation

**Date**: December 11, 2025  
**Reviewer**: Antigravity (Google DeepMind)

###  What CODEX.md Gets Right

1. **CSP/Nonce Deep Dive**  This is the most detailed security analysis across all reviews. The explanation of how Emotion/MUI inject nonce-less styles and the specific middleware files involved is actionable and correct. This is a **real production issue**.

2. **cuid-vs-uuid Schema Mismatch**  Excellent catch. The validation schemas in extension.ts and ai.ts expecting UUIDs when the DB uses cuids would cause every legitimate request to fail validation. This is **silent breakage**.

3. **Idempotency Key Design Flaws**  CODEX correctly identifies the real problem: keys aren't scoped to method/path/user and have no expiry. This is a **design issue**, not dead code.

4. **Cache Invalidation Gap**  Detailed and correct. Mutations updating items without invalidation means the cache serves stale data.

5. **Collaboration Persistence Gaps**  Correctly identifies that YJS persistence only handles updates, not creates/deletes. New items vanish on restart.

###  Where CODEX.md Could Be Stronger

1. **Action Plan Prioritization**  The High urgency section has 6+ items. That's not urgency, that's a backlog. True high urgency should be 2-3 items max. CSP fix and cuid/uuid mismatch are the **only** items that break the app immediately.

2. **API Key Security**  Correctly flags plaintext storage, but understates severity. This isn't high urgencyit's **critical security vulnerability**. Exfiltrated DB = complete API takeover.

3. **Monolithic Canvas Component**  Listed as Nice to have at the end, but this directly impacts every other fix. You can't safely add error boundaries in a 1,400-line file without refactoring first. This should be **higher priority**.

###  Where Gemini's Validation Adds Value

1. **IdempotencyKey Clarification**  The statement that withIdempotency is never actually applied to any API route is a crucial correction. If true, the infrastructure exists but isn't wired upworse than dead code, it's **false confidence** that idempotency works.

2. **getState() Anti-Pattern**  Correctly elevated to a severe reactivity bug. This is more than a code smell; it breaks React's mental model.

3. **Documentation Staleness**  Confirms that ARCHITECTURE.md claiming polling default is outdated vs. the actual WS implementation.

###  What's Missing From CODEX.md

1. **Upload Security Beyond Quotas**  CODEX mentions directory ensure/quota/scan, but doesn't flag **path traversal**. A filename like ../../etc/passwd could write outside the uploads folder. This is a textbook vulnerability.

2. **Rate Limit Fallback Behavior**  If Redis is unavailable, what happens? Does rate limiting fail open (unsafe) or closed (denial of service)? Neither is addressed.

3. **WebSocket Handshake Auth**  CODEX notes secret misalignment, but doesn't audit whether the handshake validates tokens at all. An unauthenticated user could potentially connect.

4. **Error Surface for Clients**  The RFC7807 recommendation is good, but there's no mention of whether error responses leak stack traces or internal paths in production.

###  CODEX vs GEMINI Accuracy

| Category | CODEX Accuracy | GEMINI Accuracy | Notes |
|----------|---------------|-----------------|-------|
| Security (CSP, API keys) |  High |  Missed most | CODEX far more thorough |
| Architectural (God component) |  Correct |  Correct | Agreement |
| Dead Code Claims |  Accurate |  Overstated | GEMINI wrong on IdempotencyKey |
| Real-time Implementation |  Detailed |  Surface-level | CODEX understands the gaps |
| Testing Priorities |  Practical |  Visual regression misplaced | CODEX focuses on right tests |

###  Final Verdict on CODEX.md

- **Strengths**: Deep technical understanding, actionable file paths, correct security priorities. The CSP and cuid/uuid findings alone justify this review.
- **Weaknesses**: Action plan is too long for high urgency. Some critical security items (path traversal, WS auth) are missing.
- **Gemini Validation**: Adds value by confirming findings and catching the IdempotencyKey non-usage. The never applied to any route insight is important.
- **Overall**: CODEX.md is the more **technically rigorous** review. GEMINI.md provides good structure but makes errors on dead code analysis. Combined, they cover ~90% of what matters.

---

# Deep Production Readiness Review v2 (2025-12-14)

This is a second-pass audit focused purely on production readiness. It is intentionally critical: if something is ambiguous, assume it will break in production or be abused.

## System Overview

### Main runtime pieces (what talks to what)

- **Web entrypoint**: `server.ts` runs a custom Node HTTP server via `tsx`, forwards requests to Next (`next` handler), and also handles WebSocket upgrades for collaboration.
- **Web app**: Next.js App Router under `src/app/**` (pages + layouts + server components) and API routes under `src/app/api/**`.
- **API**: REST-ish endpoints under `src/app/api/v1/**` backed by Prisma (`src/lib/db.ts`) and Postgres (`prisma/schema.prisma`).
- **Auth**: Auth.js/NextAuth handlers exposed at `src/app/api/auth/[...nextauth]/route.ts`, implemented in `src/lib/auth.ts` (Credentials + Prisma adapter + JWT sessions).
- **Collaboration**: WS server in `src/lib/collaboration/websocket-server.ts` + in-memory Yjs doc store/persistence in `src/lib/collaboration/yjs-provider.ts`.
- **Middleware**: `src/middleware.ts` applies CORS, security headers, CSP, API version gating, and rate limiting before the request hits routes.
- **Caching**: Optional Redis via `src/lib/cache/redis-client.ts` powering canvas snapshot cache (`src/lib/cache/canvas-cache.ts`) and unfurl cache (`src/lib/cache/unfurl-cache.ts`).
- **Background jobs**: Vercel cron (`vercel.json`) calling `src/app/api/cron/refresh-bookmarks/route.ts`.
- **UI stack**: React + MUI/Emotion (`src/app/providers.tsx`) with TanStack Query hooks under `src/lib/hooks/**`, plus a very large Konva canvas surface `src/features/canvas/components/CanvasBoard.tsx`.

### Data flow (happy path)

- **UI → API**: components call `fetch('/api/v1/...')` via hooks (e.g. `src/lib/hooks/use-canvases.ts`) → route handler in `src/app/api/v1/.../route.ts` → `prisma.*` → Postgres.
- **UI → Collaboration**: client connects to `ws(s)://<host>/api/collaboration/<canvasId>` (`src/lib/hooks/use-collaboration.ts`) → `server.ts` upgrade → `src/lib/collaboration/websocket-server.ts` → Yjs doc (`src/lib/collaboration/yjs-provider.ts`) → periodic persistence to Postgres.

## Architectural Review

### 1) Deployment model is internally contradictory (Vercel vs custom server)

- **Where**: `server.ts`, `vercel.json`, `src/app/layout.tsx` (Vercel Analytics), `src/components/PWARegister.tsx` (service worker).
- **What’s wrong**: The system simultaneously assumes a custom long-lived Node process (required for `/api/collaboration/*` WebSockets) and Vercel platform features (cron + analytics). Vercel does not run your `server.ts` (serverless/edge model); a custom Node HTTP server + WS upgrades implies self-hosting.
- **Why it matters**: This is not a “later” issue—your deployment target changes runtime constraints (WebSockets, filesystem writes, Redis clients, long-lived memory). Without deciding, you will ship something that works only in dev.
- **Concrete fix**:
  - If you want **Vercel**: move collaboration to a separate WS service (Hocuspocus/Liveblocks/custom ws service on Fly/Render), move uploads to object storage (S3/R2), remove/disable any assumption of local disk persistence.
  - If you want **self-hosted Node**: keep `server.ts`, remove Vercel-only features or clearly mark them as optional, and implement operational requirements (process manager, metrics, log shipping, health checks, graceful shutdown for WS/Yjs).

### 2) Cross-cutting concerns are implemented 2–3 different ways (architecture drift)

This repo has “multiple competing standards” for the same concerns, which is a bigger production risk than any single bug.

- **Error handling (3 systems)**:
  - Canonical RFC7807-ish: `src/lib/errors.ts` (Problem+json + ApiError classes).
  - Another RFC-ish handler: `src/lib/api/error-handler.ts` (Problems/createErrorResponse/withErrorHandler).
  - A third handler: `src/lib/api/route-handler.ts` (returns `{ error: ... }`, not Problem+json).
  - **Impact**: clients cannot reliably parse errors; routes return different shapes/status codes; “Unauthorized” can become 500.
- **Rate limiting (2 systems)**:
  - Actual middleware: `src/middleware/rate-limit.ts` (Map fallback, ioredis dynamic import).
  - Library + tests: `src/lib/rate-limit/**` (sliding window stores/limiters), but it is not wired into runtime middleware.
  - **Impact**: tests can pass while production rate limiting behaves differently or fails open.
- **Auth helpers (duplicated + inconsistent)**:
  - `src/lib/auth.ts` (active): JWT sessions + Redis lockout attempts.
  - `src/lib/auth/config.ts` + `src/lib/auth/index.ts` (appears unused): database sessions + different behavior.
  - `src/lib/api/auth.ts` (API helpers) vs `src/lib/auth/middleware.ts` (different helpers throwing stringly errors).
  - **Impact**: hard to reason about “the” auth rules; easy to accidentally import the wrong module.
- **Theming (2 incompatible contexts)**:
  - `src/contexts/ThemeContext.tsx` exports `ThemeProvider` + `useThemeMode`.
  - `src/lib/theme-context.tsx` exports `ThemeModeProvider` + `useThemeMode`.
  - **Impact**: runtime crashes (details below).

**Recommendation**: Pick one implementation per concern (errors/auth/rate-limit/theme). Delete or fully wire the rest. Right now the repo has “dead standards” that create false confidence.

### 3) CSP/nonce design is not integrated (likely breaks styles/scripts in production)

- **Where**: `src/middleware/csp.ts`, `src/app/layout.tsx`, `src/app/providers.tsx`.
- **What’s wrong**: Middleware sets a nonce (`x-nonce`) and enforces `script-src 'nonce-...'` and `style-src 'nonce-...'`, but the app never applies that nonce to:
  - Next’s inline scripts, and/or
  - Emotion/MUI-generated `<style>` tags.
- **Why it matters**: In a strict CSP, your UI can ship “unstyled/blank/broken” in production while still looking fine in dev (where CSP is often looser or bypassed).
- **Concrete fix**:
  - Either plumb nonce from middleware into the render tree and into Emotion cache + Next Script usage, or stop using nonce-based CSP until you can guarantee nonce propagation.
  - If you insist on strict CSP: implement an end-to-end test that loads the app with CSP enforced and asserts MUI styles apply.

### 4) Collaboration subsystem is not production-ready (and has an authorization bypass)

- **Where**: `src/lib/collaboration/websocket-server.ts`, `src/lib/collaboration/yjs-provider.ts`, `src/lib/hooks/use-collaboration.ts`, `server.ts`.
- **What’s wrong (critical)**:
  1. **Secret mismatch**: WS JWT decode uses `process.env['AUTH_SECRET']` (`src/lib/collaboration/websocket-server.ts`), but env/docs use `NEXTAUTH_SECRET` (`.env.example`, `src/lib/env.ts`). If the wrong secret is set, collaboration auth is dead.
  2. **Role not enforced**: WS authorization checks only “share exists” and does not enforce share role. A `VIEW` share can still connect and send `type: 'update'` messages that mutate the Yjs doc and get persisted. This is a permission bypass.
     - File: `src/lib/collaboration/websocket-server.ts` (authorization logic + `handleMessage` applying updates).
  3. **Initial sync bug**: initial sync uses `Y.encodeStateVector(doc)` then `Y.encodeStateAsUpdate(doc, stateVector)`, which can produce an empty update when you likely wanted the full document state.
  4. **Inefficient protocol**: Yjs updates are serialized as `Array<number>` in JSON. That is extremely bandwidth/CPU heavy versus binary frames.
  5. **Rate limit is unrealistic**: `RATE_LIMIT_MAX = 60` messages/minute will disconnect active canvases (cursor and CRDT updates are chatty by nature).
  6. **Persistence conflicts with your own concurrency rules**: `src/lib/collaboration/yjs-provider.ts` writes to DB via `updateMany` without bumping `CanvasItem.version` or applying optimistic locking. This undermines ADR-0009 optimistic concurrency (`src/app/api/v1/canvas-items/[itemId]/route.ts`).
  7. **Not horizontally scalable**: in-memory maps (`connections`, `documents`) mean multi-instance deployment breaks collaboration and persistence correctness.
- **Why it matters**: This is both a correctness and security problem—shared viewers can mutate data, and collaboration can silently “work in dev” but collapse in prod.
- **Concrete fix**:
  - Enforce access level in WS: only allow `update` messages for `EDIT`/`OWNER`. Consider separate channels for presence vs mutations.
  - Align secrets (pick one env var name; prefer Auth.js standard if you’re truly on v5).
  - Use binary WS frames for Yjs updates (or adopt `y-websocket` / Hocuspocus instead of custom protocol).
  - Decide on a scaling model (single instance only, or shared doc store via Redis/DB snapshots).

### 5) Caching is not consistent with mutation paths (stale reads are guaranteed)

- **Where**: `src/lib/cache/canvas-cache.ts`, `src/app/api/v1/canvases/[canvasId]/route.ts`, `src/app/api/v1/canvas-items/[itemId]/route.ts`, `src/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route.ts`.
- **What’s wrong**:
  - Canvas GET serves cached snapshot but **item PATCH/DELETE does not invalidate** cache.
  - Version restore deletes/recreates items but **does not invalidate** cache.
- **Why it matters**: Users will see stale canvas state after edits/restores. This is the type of bug users report as “data loss”.
- **Concrete fix**: Either remove this cache until invalidation is proven correct, or add invalidation in every mutation path that affects the cached payload (items, versions, thumbnails, restore, duplicate, etc.).

## Code Quality & Smells

### Stop-ship correctness bugs (will crash or break core UI)

- **Broken theme context wiring (runtime crash)**  
  - **Where**: `src/app/providers.tsx`, `src/contexts/ThemeContext.tsx`, `src/lib/theme-context.tsx`, `src/features/dashboard/components/DashboardContent.tsx`, `src/components/ThemeToggle.tsx`, `src/app/settings/SettingsContent.tsx`
  - **What’s wrong**: App wraps with `ThemeModeProvider` from `src/lib/theme-context.tsx`, but UI imports `useThemeMode` from `src/contexts/ThemeContext.tsx`. That hook throws unless wrapped by `ThemeProvider` from the contexts module.
  - **Why it matters**: Dashboard/settings/theme toggle will throw at runtime (“must be used within ThemeProvider”).
  - **Fix**: Delete one theme system. Recommended: keep `ThemeModeProvider` as the single source of mode + persist, and integrate MUI theme creation in one place. Update all imports to a single `useThemeMode`.

- **Client/API contract mismatch for canvases list (runtime break)**  
  - **Where**: `src/app/api/v1/canvases/route.ts`, `src/lib/hooks/use-canvases.ts`, `src/features/dashboard/components/DashboardContent.tsx`
  - **What’s wrong**: API returns `{ canvases, pagination }`, but `useCanvases()` asserts `Promise<Canvas[]>` and `DashboardContent` treats query data as an array.
  - **Why it matters**: `.map`/`.length` calls will break at runtime; pagination metadata is ignored.
  - **Fix**: Define a typed response shape (e.g. `CanvasesListResponse`) and make both route + hook match it. Add a contract test.

- **Comments UI implements edit/delete but API does not**  
  - **Where**: `src/lib/hooks/use-comments.ts`, `src/features/canvas/components/CommentsPanel.tsx`, `src/app/api/v1/items/[itemId]/comments/route.ts`, `src/app/api/v1/items/[itemId]/comments/[commentId]/route.ts`
  - **What’s wrong**: Hooks call PATCH/DELETE, but routes only implement GET/POST (and commentId route only GET).
  - **Why it matters**: UI offers actions that always fail; this destroys trust.
  - **Fix**: Either implement PATCH/DELETE with proper access control + sanitization, or remove those UI controls.

- **Templates hooks and routes do not match**  
  - **Where**: `src/lib/hooks/use-templates.ts`, `src/app/api/v1/templates/route.ts`, `src/app/api/v1/templates/[templateId]/route.ts`
  - **What’s wrong**: Hook expects GET `/api/v1/templates/:id` and DELETE `/api/v1/templates/:id`, but the route only implements PUT. Additionally `src/app/api/v1/templates/route.ts` throws errors without a handler (no `withApiHandler`/`try/catch`), so many failures will become 500.
  - **Fix**: Implement missing GET/DELETE routes, and standardize error responses for template routes.

### Security bugs / footguns

- **CRON_SECRET auth fails open when missing**  
  - **Where**: `src/app/api/cron/refresh-bookmarks/route.ts`
  - **What’s wrong**: If `CRON_SECRET` is unset, the check becomes `authorization === "Bearer undefined"`; an attacker can send that and run your cron logic.
  - **Fix**: If the secret is missing, return 500 and do not execute. Also require a non-empty secret and consider IP allowlisting if on Vercel.

- **API keys are stored and compared in plaintext**  
  - **Where**: `src/lib/api/api-key-auth.ts`, `prisma/schema.prisma` (`ApiKey.key`), `src/app/api/v1/extensions/clip/route.ts`, `src/app/api/v1/webhooks/trigger/route.ts`
  - **What’s wrong**: DB exfiltration = immediate API-key takeover. No hashing, no prefix/suffix scheme, no rotation story, no rate limit/quotas. `lastUsedAt` update is fire-and-forget.
  - **Fix**: Store only a hashed key (e.g. SHA-256 with per-key salt or HMAC with server secret), show the raw key only once at creation, support rotation, enforce expiry, and rate-limit API-key endpoints.

- **Extension/webhook validation rejects real canvas IDs**  
  - **Where**: `src/lib/validation/extension.ts`, `prisma/schema.prisma`
  - **What’s wrong**: `canvasId` is validated as UUID but DB uses `cuid()` IDs. Passing a real canvas ID will fail validation.
  - **Fix**: Use `z.string().cuid()` (or accept both if you truly have mixed IDs).

- **SSRF protection is hostname-string based (DNS rebinding risk)**  
  - **Where**: `src/lib/utils/ssrf-protection.ts`, used by `src/app/api/v1/unfurl/route.ts` and `src/app/api/cron/refresh-bookmarks/route.ts`
  - **What’s wrong**: Blocking `10.*`/`127.*` patterns on the hostname does not prevent resolving a public hostname to a private IP (DNS rebinding) or other resolution tricks.
  - **Fix**: Resolve DNS and block private ranges on the resolved IPs (and re-check after redirects). Consider using a dedicated SSRF-safe fetcher library/policy.

### Maintainability / correctness debt

- **Auth config duplication (two different NextAuth configs)**  
  - **Where**: `src/lib/auth.ts` vs `src/lib/auth/config.ts` + `src/lib/auth/index.ts` + `src/lib/auth-options.ts`
  - **What’s wrong**: There are two incompatible auth configurations (JWT vs DB sessions, different callbacks/cookies). Only one should exist.
  - **Fix**: Delete the unused config or refactor so there is a single exported auth configuration used everywhere (routes, WS auth, tests).

- **Rate limiting duplication + false test confidence**  
  - **Where**: `src/middleware/rate-limit.ts` (runtime), `src/lib/rate-limit/**` (library), `tests/unit/rate-limit.test.ts` (tests), `tests/unit/rate-limit-redis.test.ts`
  - **What’s wrong**: Tests cover `src/lib/rate-limit/**`, but runtime uses `src/middleware/rate-limit.ts`. Also `tests/unit/rate-limit-redis.test.ts` has a broken import (`../../lib/...`) and fails to run.
  - **Fix**: Consolidate to one rate limit implementation and test the one you actually deploy.

- **CanvasBoard is a god component + has a real reactivity bug**  
  - **Where**: `src/features/canvas/components/CanvasBoard.tsx` (1433 lines; e.g. line ~986 uses `useCanvasStore.getState().activeTool` inside render)
  - **What’s wrong**: Non-reactive store read inside render breaks UI updates. The file is too large to safely evolve and too interwoven to test.
  - **Fix**: Replace `getState()` reads with selector hooks and split the component into isolated units (interaction controller, rendering layer, dialogs, collaboration adapter).

- **Version restore destroys identities and related data**  
  - **Where**: `src/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route.ts`, `prisma/schema.prisma` (`ItemConnection`, `Comment`)
  - **What’s wrong**: Restore hard-deletes all items and recreates them with new IDs. This will cascade-delete comments and connections, and any ID-based references break.
  - **Fix**: Store item IDs in the snapshot and restore by upserting by ID (create missing, update existing, soft-delete removed). Invalidate cache after restore.

- **Multiple unused/unfinished subsystems** (maintenance drag)
  - **Where**: `src/lib/api/idempotency.ts`, `src/lib/api/route-handler.ts` (`withIdempotency`), `src/lib/audit/audit-log.ts`, `src/lib/export/canvas-export.ts`, `src/lib/utils/event-emitter.ts`, `src/app/api/metrics/*` (empty), plus unused deps (see Dependencies section)
  - **Why it matters**: Every unused “standard” increases cognitive load and reduces confidence that the wired path is correct.
  - **Fix**: Delete dead code or wire it end-to-end with tests. Right now it’s neither.

## Logic & UX/Flow Issues

- **Theme toggle and theme-dependent UI will crash** due to provider mismatch (`src/components/ThemeToggle.tsx`, `src/features/dashboard/components/DashboardContent.tsx`, `src/app/settings/SettingsContent.tsx`).
- **Dashboard canvases list will break** because the data shape is wrong (`src/lib/hooks/use-canvases.ts` expects array; API returns object).
- **Edit/delete comment flows are dead ends**: UI provides actions, API does not implement them, and failures are mostly `console.error` with no user-facing recovery (`src/features/canvas/components/CommentsPanel.tsx`).
- **Templates browsing and “remove template” are broken** because GET/DELETE routes are missing (`src/lib/hooks/use-templates.ts`, `src/app/api/v1/templates/[templateId]/route.ts`).
- **Collaboration UX has no resilience**:
  - No reconnect/backoff (`src/lib/hooks/use-collaboration.ts`).
  - Likely disconnections under normal usage due to low WS rate limit (`src/lib/collaboration/websocket-server.ts`).
  - No visible “read-only vs editable” enforcement at the WS layer (VIEW can mutate).
- **AR feature is self-disabled by policy**: permissions policy forbids camera in both middleware and Next headers (`src/middleware/security-headers.ts`, `next.config.mjs`) while AR UI needs camera (e.g. `src/features/canvas/components/ARCanvasLayer.tsx`).
- **Account/profile flows assume RFC7807 but routes often return `{ error }`**: many UI fetches read `error.detail` but `src/lib/api/route-handler.ts` returns `{ error: string }` (example: settings page calls `/api/v1/users/profile` expecting `detail` on failure).

## Performance & Optimization Opportunities

- **WS/Yjs update encoding is expensive**: JSON encoding `Array.from(update)` bloats payloads and CPU (`src/lib/collaboration/websocket-server.ts`, `src/lib/hooks/use-collaboration.ts`). Switch to binary WS frames or base64 at minimum.
- **Yjs persistence is write-amplifying**: every 30s it loops all Yjs items and runs `updateMany` per item (`src/lib/collaboration/yjs-provider.ts`). For large canvases this is heavy and can thrash DB.
  - Improve by buffering incremental updates, persisting only changed items, and using upsert/create for new items.
- **Search is not scalable**: JSON `ILIKE` scanning without robust indexing will degrade quickly (`src/app/api/v1/search/route.ts`). Consider Postgres full-text search or trigram indexes + pagination.
- **Canvas rendering performance**: the 1433-line CanvasBoard likely re-renders too much; also `getState()` reads bypass React’s update model (`src/features/canvas/components/CanvasBoard.tsx`). Split and memoize; consider viewport culling for Konva layers.
- **DB bloat risks**:
  - Base64 thumbnails in `Canvas.thumbnail` (`prisma/schema.prisma`) will grow DB quickly; prefer object storage or separate table with compression.
  - Version snapshots store “complete canvas state” in JSON (`CanvasVersion.snapshot`) without size controls; for real canvases this becomes expensive.

## Dependencies & Stack Analysis

### Major stack choices (and blunt critique)

- **Next.js 15 + React 19 + NextAuth v5 beta** (`package.json`) is a high-risk production combo unless you have strong regression coverage and fast upgrade discipline. Some of your ecosystem deps are not clearly React 19-ready (notably `react-konva`).
- **Custom WebSocket server** (`ws`, `server.ts`) is a big commitment. If you’re not ready to own real-time infra, use a managed collab service or a battle-tested Yjs server (Hocuspocus). Right now the implementation is incomplete and unsafe (permission bypass).
- **Filesystem uploads** (`src/app/api/v1/upload/route.ts`) implies a persistent disk. That does not exist on most serverless platforms (including Vercel). If Vercel is the target, this must move to object storage.

### Dependency hygiene (unused/duplicated)

These dependencies appear unused in `src/**` and should be removed or actually wired:

- `prom-client` (metrics folder exists but `src/app/api/metrics` is empty)
- `y-websocket` (custom WS server implemented instead)
- `jose`
- `next-pwa` (PWA registration is manual via `src/components/PWARegister.tsx`)
- `pino-pretty` (logger doesn’t configure transport in `src/lib/logger/index.ts`)
- `@tanstack/react-virtual`

Also: you have duplicate API endpoints with different shapes (`src/app/api/ai/generate/route.ts` vs `src/app/api/v1/ai/generate/route.ts`).

### Stack change suggestions (based on current scope/scale)

- If you want **production soon**: strongly consider stabilizing to **Next 14.x + React 18.2 + stable auth** (or lock to known-good v5 + enforce contract tests). Your current CI/lint/test state does not support bleeding-edge upgrades safely.
- If you want **real collaboration**: replace the custom protocol with **Hocuspocus** (or Liveblocks) and run it as a separate service; remove `y-websocket` if not used.
- If you want **Vercel**: split the system: Next app on Vercel + WS service elsewhere + object storage uploads + Upstash REST rate limiting/caching.

## Testing & Best Practices

### Current CI reality check (this repo is not green)

- `pnpm type-check` passes.
- `pnpm test:coverage` fails (22 failing test files in this environment). Examples:
  - `tests/api/auth-helpers.test.ts` mocks `next-auth` but the code under test uses `auth()` from `@/lib/auth` (`src/lib/api/auth.ts`) — tests are out of date.
  - `src/__tests__/lib/validation/password.test.ts` calls `validatePasswordStrength()` synchronously, but it is async (lazy-loads zxcvbn) in `src/lib/validation/password.ts`.
  - `tests/unit/rate-limit-redis.test.ts` does not run due to a broken import path (`../../lib/...`).
- `pnpm lint` fails because `next lint` is incompatible with the current ESLint flat config setup (`eslint.config.mjs`). Even running `pnpm exec eslint .` yields hundreds of errors, including in `tests/**` and scripts.

### Structural issues

- Duplicate/unused test roots: `e2e/*.spec.ts` exists but Playwright runs `tests/e2e` (`playwright.config.ts`). This is confusing and invites untested code paths.
- Multiple setup files: `tests/setup.ts` (used by Vitest), `src/__tests__/setup.ts` (not wired in Vitest config), `src/test/setup.ts` (unclear usage), and `vitest.setup.ts` (present but not referenced).
- CI workflow (`.github/workflows/ci.yml`) does not run Playwright E2E tests, despite a `ci` script in `package.json` that would.
- Playwright dev server command uses `npm run dev` (`playwright.config.ts`) while the repo is pnpm-based. That’s a DX footgun.

### Best-practice recommendations

- Make CI green before shipping: fix the test suite, fix lint runner, and enforce one error contract across APIs.
- Add contract tests for the highest-risk breakpoints:
  - Theme provider wiring (`src/app/providers.tsx` + components using theme hook).
  - API response shapes vs client hooks (canvases, templates, comments).
  - WebSocket permission enforcement (VIEW cannot mutate).
  - Cron auth (secret required).

## Priority Action Plan

### High impact / High urgency (stop-ship)

1. **Fix runtime crashers and broken contracts**
   - Unify theme provider/hook (`src/app/providers.tsx`, `src/contexts/ThemeContext.tsx`, `src/lib/theme-context.tsx`, `src/components/ThemeToggle.tsx`).
   - Fix canvases list response contract (`src/app/api/v1/canvases/route.ts`, `src/lib/hooks/use-canvases.ts`, `src/features/dashboard/components/DashboardContent.tsx`).
   - Fix comments/templates API mismatches or remove the UI actions until implemented (`src/lib/hooks/use-comments.ts`, `src/lib/hooks/use-templates.ts`).

2. **Fix critical security failures**
   - Make cron auth fail closed when secret missing (`src/app/api/cron/refresh-bookmarks/route.ts`).
   - Hash API keys at rest + add quotas/rate limiting (`src/lib/api/api-key-auth.ts`, `prisma/schema.prisma`).
   - Fix WS auth secret alignment and enforce share roles (VIEW must not be able to send updates) (`src/lib/collaboration/websocket-server.ts`).

3. **Make CSP actually compatible with the app**
   - Either plumb nonce through Emotion/MUI/Next scripts, or stop using nonce-based CSP until the plumbing exists (`src/middleware/csp.ts`, `src/app/layout.tsx`, `src/app/providers.tsx`).

4. **Restore release gates**
   - Fix `pnpm lint` (either stop using `next lint` with flat config or revert to an ESLint setup Next supports).
   - Fix failing tests and remove broken/unused ones; add minimal contract coverage.

### High impact / Lower urgency

- Consolidate to one standard per concern:
  - One error handler (`src/lib/errors.ts` vs `src/lib/api/error-handler.ts` vs `src/lib/api/route-handler.ts`).
  - One auth configuration (`src/lib/auth.ts` vs `src/lib/auth/config.ts`).
  - One rate limit implementation (middleware vs lib).
  - One idempotency implementation (DB vs Redis vs unused).
- Redesign version restore to preserve item IDs and related entities (`src/app/api/v1/canvases/[canvasId]/versions/[versionId]/restore/route.ts`).
- Fix cache invalidation or remove cache (`src/lib/cache/canvas-cache.ts` + all mutations).
- Replace filesystem uploads with object storage if not self-hosting (`src/app/api/v1/upload/route.ts`).
- Harden SSRF properly (DNS resolution + private IP blocking) (`src/lib/utils/ssrf-protection.ts`).

### Nice to have / Future improvements

- Refactor `src/features/canvas/components/CanvasBoard.tsx` into testable modules (rendering, interactions, collaboration adapter, dialogs).
- Remove unused deps (`prom-client`, `y-websocket`, `jose`, `next-pwa`, `pino-pretty`, `@tanstack/react-virtual`) and delete dead folders (`src/app/api/metrics` if unused).
- Fix documentation drift and encoding issues in `ARCHITECTURE.md`; ensure docs reflect reality (custom WS server exists; polling docs are outdated).
