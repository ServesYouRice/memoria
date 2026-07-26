# Architecture Review — Memoria

A structural assessment of how the system is put together, independent of specific bugs. Overall: the architecture is coherent and the major decisions are defensible. The risks are concentration (a few very large modules) and a couple of dual-path seams that should be unified.

---

## 1. Runtime shape

The choice of a **custom stateful Node server** (`server.ts`) hosting both the Next.js App Router and the `ws` collaboration server in one process is the correct call for this product — realtime presence needs sticky, stateful connections that serverless fights. The consequence, correctly documented, is that serverless deploy is a non-goal. Two loose ends:

- `vercel.json` still exists and advertises serverless functions + cron. It contradicts the runtime model and should be removed or clearly quarantined (someone *will* try to deploy it to Vercel, where WebSockets and the in-process scheduler assumptions break).
- The scheduler is a **separate container** running a bare `setTimeout` loop for one job. Fine for one job; it will not scale to the several background jobs the roadmap needs (retention sweep, thumbnail generation, backoff-aware refresh, webhook retry). Adopt a minimal DB- or Redis-backed job runner before adding the 2nd and 3rd job, not after.

## 2. Layering

The `app / features / lib` split is clean and consistently applied:
- `src/app` — routes and API handlers
- `src/features/{auth,canvas,dashboard,agents}` — feature UI + feature hooks
- `src/lib` — cross-cutting infra (auth, rate-limit, cache, collaboration, agents, validation, errors)

State ownership is disciplined (ADR-0005): TanStack Query owns server state, Zustand owns ephemeral UI state, with the separation actually respected in `use-canvas-items.ts` vs `canvasStore`. Validation lives at API boundaries via Zod, and the shared `withApiHandler`/`withAuthValidation` stack gives centralized error mapping, idempotency, and request-scoped session caching.

**The main layering weakness is incomplete adoption of that stack.** ~6 older routes (canvas share, public, share-by-token, change-password) hand-roll try/catch and skip idempotency/session-cache/correlation. This is tracked as MNT-06; the practical cost is that any cross-cutting change (e.g. the S-1 IP fix, correlation-ID unification) must be applied in two idioms.

## 3. Module concentration risk

A small number of modules carry disproportionate complexity:

| Module | Lines | Concern |
|---|---:|---|
| `src/lib/agents/service-core.ts` | 1,556 | God-module; tracked MNT-01. Hard to test in units, high change-risk. |
| `src/features/canvas/components/CanvasBoard.tsx` | 1,387 | Orchestrates data, interaction, keyboard, history, collaboration, dialogs, organizer. Tracked MNT-01. |
| `src/lib/collaboration/websocket-server.ts` | 830 | Auth + authz + transport + rate-limit + fanout in one file, **zero tests** (T-4). |
| `src/lib/agents/mcp.ts` | 814 | External tool transport surface. |

These are not bugs, but they are where bugs will hide (S-4 lives in the untested WebSocket module; the routing bug L-1 sits just outside CanvasBoard's data path). Decomposition should be prioritized by *test-difficulty*, not line count: the collaboration server is the one to break apart first because it is security-sensitive and currently untestable as written.

## 4. Data model

Well-indexed (composite indexes on the hot `CanvasItem` access patterns, `shareToken`, share email, idempotency keys). Soft deletes + version fields support the autosave/restore/trash flows coherently. Two structural observations:

- **Shares are keyed by email string, not user ID** (`CanvasShare.email`). This drives L-7 (email-change orphaning) and the missing invitation lifecycle (PRODUCT-01). A future `userId`-backed membership model is the cleaner long-term shape; avoid deepening the email-as-identity assumption.
- **Single-owner workspaces** (`Workspace.userId`). Correct for v1, but team accounts will eventually need membership. The agent slice already scopes at canvas level, which is compatible with a future membership layer.
- **Full-snapshot versions + row-by-row restore** (PERF-23) — the versioning model stores whole snapshots and restores sequentially. Acceptable at bounded sizes with a hard guard; revisit if canvases grow large.

## 5. Sync architecture

The decision to keep **item writes on validated REST and use WebSockets only for ephemeral presence/cursors/chat** is a strong, security-conscious choice (avoids trusting Yjs documents for persistence). The trade-off is that non-presence sync falls back to **full-item polling every 5 s** (P-4), which is the least scalable part of the system. The right evolution — already implied by the tracked PERF-01 viewport work — is a `itemChanged(id, version)` notification over the existing socket plus HTTP delta fetch, preserving the "REST is write authority" invariant while removing the full refetch. This is the single highest-leverage architectural improvement post-launch.

## 6. Security architecture

Layered and mostly excellent (see `security-issues.md`). The one architectural flaw is the **client-IP trust model** (S-1): keying all abuse controls to `socket.remoteAddress` with a deliberate refusal to read forwarding headers is only correct for a directly-exposed server, which contradicts the HTTPS self-host reality. This is an architecture decision, not a bug — it needs a trusted-proxy abstraction, not a patch. Relatedly, the rate-limit system has **two designs** (the live IP-keyed middleware and the dead per-user `endpoint-limits.ts`); converging on the per-user-capable design solves both S-1's user-scoping need and the L-2 dead-code problem.

## 7. Observability

Strong foundation: Pino with request IDs and redaction, Sentry across client/edge/server, Prometheus `/api/metrics`, health endpoint, CSP reporting. The gap is **correlation** (L-12): the proxy's `x-request-id` and the handler's `x-correlation-id` are never joined, so a production incident can't be traced end-to-end with one identifier. Unifying on `x-request-id` through `withApiHandler` (and into Sentry tags) is a small change with large operational payoff.

## 8. Summary of architectural recommendations

1. **Unify the two rate-limit designs** around per-user keys + trusted-proxy IP (fixes S-1 architecturally, retires dead code).
2. **Decompose the collaboration server first** (security-sensitive + untestable), then `service-core.ts` and `CanvasBoard.tsx` (MNT-01).
3. **Finish adopting the shared route-handler stack** across the legacy routes (MNT-06); unify correlation IDs (L-12).
4. **Evolve sync** from full polling to socket-notified HTTP deltas (P-4 → PERF-01), keeping REST as the write authority.
5. **Introduce a real job runner** before the background-job count grows.
6. **Remove/quarantine `vercel.json`**; the serverless story is dead and its presence is an architectural landmine.
7. Keep the email-as-share-identity model from spreading; plan a `userId`-backed membership layer for team use.
