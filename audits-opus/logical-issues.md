# Logic, Data & Implementation Issues

Scope: correctness, concurrency, async lifecycle, state management, data
integrity, API contracts, resource management. Inspection only.

Legend: **B** = blocker before production.

---

## LOG-01 — Item lists silently drop items; `hasMore` is computed before truncation

| | |
| --- | --- |
| **Severity** | **Critical** |
| **Location** | [bounded-response.ts:8-25](src/lib/api/bounded-response.ts#L8-L25), [canvas-items/route.ts:324-329](src/app/api/v1/canvas-items/route.ts#L324-L329), [use-canvas-items.ts:109-141](src/lib/hooks/use-canvas-items.ts#L109-L141) |
| **Blocker** | **B** |

**Problem.** Three correct-looking pieces combine into silent data loss.

1. `boundedItemsResponse` enforces a 512 KB budget by *dropping* items and
   setting `truncatedByBytes: true`.
2. The route computes its metadata **before** that truncation:
   `hasMore: offset + items.length < total`, where `items` is the full,
   untruncated array.
3. The client trusts `hasMore` to decide whether to keep paging, and never reads
   `truncatedByBytes`.

**Failure scenario (concrete).** `limit` defaults to `MAX_VIEWPORT_ITEMS = 1000`
([constants.ts:130](src/lib/constants.ts#L130)). A canvas has 600 notes averaging
~1 KB of content.

- Route fetches 600 items, `total = 600`.
- `hasMore` = `0 + 600 < 600` = **false**.
- `boundedItemsResponse` serialises until it crosses 512 KB and stops at ~500,
  returning `items.length = 500`, `truncatedByBytes: true`, `hasMore: false`.
- Client sees `hasMore: false`, stops paging, renders **500 of 600 items**.

The user's canvas is missing ~100 items with no error, no warning, and no way to
discover it. Reload produces the same result. `LAUNCH_LIMITS.itemsPerCanvas` is
2000, so this is reachable well inside supported limits.

**Why it matters.** This is the worst class of bug in a notes product: durable
data exists in PostgreSQL and the application refuses to show it while reporting
success. Users will conclude the app ate their work.

**Fix.** Compute metadata from what is actually returned. `boundedItemsResponse`
should own the pagination fields:

```ts
return boundedItemsResponse(items, { total, offset, limit });
// inside: hasMore = offset + accepted.length < total
```

Then have the client treat `truncatedByBytes` as "more to fetch" and continue
from `offset + accepted.length`. Add a test that asserts a byte-truncated page
still reports `hasMore: true`.

**Related.** PERF-01 (the same function is O(n²)). UI-04 is a *different*
truncation on the public share path — fix both.

---

## LOG-02 — Live cursors stop working after a few seconds of mouse movement

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [CanvasBoard.tsx:1134-1142](src/features/canvas/components/CanvasBoard.tsx#L1134-L1142), [websocket-server.ts:41-42, 903-925](src/lib/collaboration/websocket-server.ts#L41-L42) |
| **Blocker** | **B** |

**Problem.** The client sends a `cursor` frame on **every** `onMouseMove` with no
throttle or rAF batching:

```ts
onMouseMove={(event) => {
  ...
  updateCursor((pointer.x - position.x) / zoom, (pointer.y - position.y) / zoom);
}}
```

The server budget is `RATE_LIMIT_MAX = 600` per `RATE_LIMIT_WINDOW = 60000` ms —
10 messages/second. A pointer on a 120 Hz display emits ~120 moves/second.

**Failure scenario.** ~5 seconds of continuous mouse movement exhausts the
minute's budget. `applyRateLimit` then returns `false` for `cursor` **without**
closing the socket (L915), so the connection stays healthy while every
subsequent cursor frame is dropped for the rest of the window. Presence, chat,
and reactions share the same counter and are also starved.

**Why it matters.** Real-time collaboration is a headline feature. It degrades
to nothing within seconds of normal use, silently, and recovers only at the next
window boundary — behaviour that is nearly impossible for a user to report
coherently.

**Fix.** Throttle client-side to the server's own broadcast cadence — the server
already coalesces cursors at `CURSOR_TICK_MS = 50` (L51), so sending faster than
20/s is pure waste. Emit from a `requestAnimationFrame` loop with a 50 ms floor.
Separately, give cursor frames their own budget so they cannot starve chat.

**Note.** The comment at L40 says "6000 messages per minute" while the constant
is `600` — one of the two is wrong; resolve before tuning.

---

## LOG-03 — Account lockout is checked only after the password is verified

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [auth.ts:62-96](src/lib/auth.ts#L62-L96) |
| **Blocker** | **B** |

**Problem.** In `authorize()`, `isAccountLocked` appears only inside the two
*failure* branches (L73, L89). The expensive `argon2.verify` at L83 runs first,
on every attempt, regardless of lockout state.

**Consequences.**
1. **The lockout does not reduce work.** A locked account still costs a full
   argon2id verification per request. argon2id is deliberately expensive (memory-
   hard); this converts the login endpoint into a CPU/memory amplification
   target. `authRateLimit` is the only real brake, and it is keyed per IP (SEC-07).
2. **A locked account with a correct password still signs in.** The success path
   (L88 → L96) never consults the lockout, so the lock only rejects *wrong*
   guesses — the opposite of a lockout's purpose during a credential-stuffing
   attempt.

**Fix.** Check `isAccountLocked(email, clientId)` immediately after resolving
`email`, before the user lookup and before any hashing, and fail closed for both
outcomes. Keep the dummy-hash timing equalisation for the *unknown user* case
only.

**Related.** SEC-11 (lockout keyed to email+IP, so distributed attempts bypass
it), SEC-09 (Redis outage makes this path throw in production).

---

## LOG-04 — Undoing a delete creates new rows, orphaning comments and connections

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [use-canvas-item-handlers.ts:60-76, 97-109](src/features/canvas/hooks/use-canvas-item-handlers.ts#L60-L76) |
| **Blocker** | No (but data-loss adjacent) |

**Problem.** The undo closure calls `createItem({...})` with the deleted item's
geometry and content. It does not restore the original row — it inserts a new
one with a **new cuid**.

**Consequences.**
- `Comment.itemId`, `ItemConnection`, `ItemEntityLink`, and `ItemEmbedding` all
  referenced the old id. After "undo" the note is back but its comment thread and
  its arrows are gone.
- `version` resets to 1, so any other client holding the old version now gets
  confusing conflict behaviour.
- The command is pushed to the undo stack *after* execution (L79), but the
  recreated ids are never written back, so a subsequent redo/undo cycle operates
  on stale ids.

**Why it matters.** Undo that silently discards relational data is worse than no
undo — users trust it and lose thread history.

**Fix.** The schema already has soft delete (`deletedAt`, `deletedById`).
Implement undo as a restore endpoint (`PATCH .../restore` clearing `deletedAt`
and bumping `version`) rather than a create. That preserves ids and every
relation.

---

## LOG-05 — Every item update triggers a full canvas refetch (invalidation storm)

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [use-canvas-items.ts:588-663](src/lib/hooks/use-canvas-items.ts#L588-L663) |
| **Blocker** | No |

**Problem.** `useUpdateCanvasItem` invalidates three times per mutation:

```ts
onMutate:   cancelQueries({ queryKey: canvasItemKeys.all })      // L590-592
onSuccess:  invalidateQueries({ queryKey: list(canvasId) })      // L638-640
onSettled:  invalidateQueries({ queryKey: canvasItemKeys.lists() }) // L661
```

`onSettled` invalidates **all** list queries for **all** canvases, and `onMutate`
cancels every in-flight item query globally — including for canvases open in
other tabs sharing the same `QueryClient`.

**Failure scenario.** Dragging one note fires a geometry commit. That refetches
the whole canvas item list (which, per LOG-01's paging loop, may be several
sequential HTTP requests). Multi-select drag of 20 items fires 20 mutations →
20 full refetches, each racing the optimistic state.

**Why it matters.** It burns the `itemsRateLimit` budget (200/min), makes the
canvas feel laggy under exactly the interaction users perform most, and creates
the window in which LOG-06 corrupts state.

**Fix.** Drop `onSettled` entirely — `onSuccess` already writes authoritative
server data into the cache at L632-635. Scope the `onMutate` cancel to
`canvasItemKeys.list(canvasId)`. Rely on the committed-event WebSocket stream
(which already exists) for cross-client convergence rather than blanket
invalidation.

---

## LOG-06 — Concurrent optimistic updates roll back to each other's state

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [use-canvas-items.ts:594-628, 642-659](src/lib/hooks/use-canvas-items.ts#L594-L628) |
| **Blocker** | No |

**Problem.** `onMutate` snapshots `previousListQueries` — the cache *as it is
right now*, which already contains earlier in-flight optimistic edits. `onError`
restores that snapshot wholesale.

**Failure scenario.** User drags item A (mutation 1 applies optimistic A′), then
immediately drags item B (mutation 2 snapshots a cache containing A′, applies
B′). Mutation 1 fails with a 409. Its rollback restores the pre-A snapshot —
**discarding B′**, which was valid and is still in flight. When mutation 2
succeeds, its `onSuccess` only rewrites B's detail entry; the list cache has
already lost B's optimistic position until the next refetch.

**Why it matters.** Multi-item drag is a primary canvas interaction, and version
conflicts are expected in a collaborative product — so both halves of this race
occur in normal use.

**Fix.** Roll back per-entity rather than per-cache: snapshot only the single
item being mutated and restore just that entry, leaving concurrent optimistic
edits intact. TanStack's recommended pattern is a per-mutation-key optimistic
layer; alternatively serialise geometry commits through the existing
`serialized-delta-queue` (there is already a test for one at
`tests/unit/serialized-delta-queue.test.ts`).

---

## LOG-07 — Optimistic ids collide for items created in the same millisecond

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [use-canvas-items.ts:510](src/lib/hooks/use-canvas-items.ts#L510) |
| **Blocker** | No |

`id: \`temp-${Date.now()}\`` — paste-multiple, template application, or any
batch create issued in one tick produces duplicate React keys and one optimistic
row overwriting another. Use `nanoid()` (already a dependency) or `crypto.randomUUID()`.

---

## LOG-08 — Canvas deletion is an unrecoverable hard cascade, driven by a bulk UI

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [canvases/[canvasId]/route.ts:123-155](src/app/api/v1/canvases/[canvasId]/route.ts#L123-L155), [DashboardContent.tsx:180-203](src/features/dashboard/components/DashboardContent.tsx#L180-L203) |
| **Blocker** | **B** |

**Problem.** `DELETE` calls `tx.canvas.delete()`. Prisma cascades remove every
`CanvasItem`, `CanvasShare`, `CanvasVersion`, `Comment`, `ItemConnection`, and
`CanvasEvent`. There is no soft delete, no trash entry, no restore window —
despite the product shipping a `/trash` route (which covers *items* only).

The dashboard exposes this as a multi-select bulk action, and the client-side
implementation is weak:

```ts
await Promise.all(selectedIds.map(async (id) => {
  const response = await fetch(`/api/v1/canvases/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete canvas");
}));
```

- Raw `fetch`, bypassing `apiFetch` and its error contract.
- `Promise.all` — first rejection abandons the rest; some canvases are destroyed
  and some aren't, and the toast reports a flat "Failed to delete canvases".
- On failure the cache is **not** invalidated (invalidate only runs on the
  success path, L197), so deleted canvases keep rendering until a manual reload.

**Why it matters.** One mis-click in selection mode permanently destroys an
arbitrary number of canvases and all their history. Recovery requires a database
restore.

**Fix.** Soft-delete canvases (`deletedAt` + the existing retention job, which
already has `trashRetentionDays: 30`), and have `/trash` cover canvases too.
Meanwhile: use `apiFetch`, switch to `Promise.allSettled`, report partial
outcomes, and always invalidate.

---

## LOG-09 — A failed idempotency journal write wedges the key for 24 hours

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [route-handler.ts:289-308, 253-261](src/lib/api/route-handler.ts#L289-L308) |
| **Blocker** | No |

**Problem.** After the handler succeeds, the response is journalled with
`.catch()` that only logs:

```ts
await prisma.idempotencyKey.update({...}).catch((error) =>
  logger.error({...}, "Mutation succeeded but idempotency response journaling failed"));
```

If that write fails (connection blip, timeout), the row keeps `responseCode = null`.
A client retry with the same key then hits L260 and throws
`ConflictError("Request is currently being processed")` — forever, because the
row is only cleaned up lazily after `IDEMPOTENCY_TTL_MS` (24 h).

**Why it matters.** The mutation *did* succeed, but the client is told it is
still processing and cannot confirm. Well-behaved clients that retry with a
stable key are punished for a full day.

**Fix.** Add a `startedAt` and treat rows older than a short lease (say 60 s)
with a null `responseCode` as abandoned — re-run or return a definitive result.
Also add a scheduled cleanup; `IdempotencyKey` currently only shrinks on
same-key reuse, so the table grows unboundedly.

---

## LOG-10 — A transient DB error disconnects every collaborator on a canvas

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [websocket-server.ts:587-595](src/lib/collaboration/websocket-server.ts#L587-L595) |
| **Blocker** | No |

```ts
void revalidateCanvasConnections(canvasId, clients).catch((error) => {
  logger.error({...});
  clients.forEach((client) => client.ws.close(1011, "Authorization refresh failed"));
});
```

This runs on the 30 s heartbeat. Any query failure — a failover, a pool
exhaustion spike, a statement timeout — closes **all** sockets for that canvas.
Every client then enters the reconnect backoff (LOG-13) simultaneously,
producing a thundering herd against the database that just failed.

**Fix.** Fail *open* on transient errors: keep the existing lease
(`AUTHORIZATION_LEASE_MS`), count consecutive failures, and only close after N
attempts or once the lease is meaningfully stale. Distinguish "authorization
revoked" (close) from "could not check" (retry).

---

## LOG-11 — Unbounded in-memory maps in the WebSocket server

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [websocket-server.ts:125, 139-149, 123-124, 355-372](src/lib/collaboration/websocket-server.ts#L125) |
| **Blocker** | No |

Three leaks in a long-lived process:

1. **`upgradeBudgets`** gains an entry per distinct client IP and is **never**
   pruned — entries are only overwritten, never deleted. Over weeks of uptime
   this grows with unique visitor count.
2. **`remotePresence` / `remoteCursors`** store a `Map` keyed by remote
   `instanceId`. If a peer instance dies, its entry persists until the canvas
   drops to zero local subscribers — so `getRemoteUsers` keeps reporting **ghost
   collaborators** who left when their instance did.
3. **Empty `Set` leak.** `handleConnection` creates `connections.set(canvasId, new Set())`
   at L653-655, then may reject the connection at L656-671 and `return` — before
   registering the `close` handler that would clean up. The empty `Set` stays
   keyed by `canvasId` forever.

**Fix.** Sweep `upgradeBudgets` on the existing heartbeat (drop entries past
`resetAt`). Expire remote instance entries on a TTL refreshed by presence
publishes. Delete the canvas key in the rejection paths.

**Note.** These matter specifically because `ARCHITECTURE.md` commits to a
long-running stateful process — there is no serverless recycle to paper over
leaks.

---

## LOG-12 — Clients reconnect forever after access is revoked

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [use-collaboration.ts:287-297, 227-243](src/lib/hooks/use-collaboration.ts#L287-L297) |
| **Blocker** | No |

`ws.onclose` always calls `scheduleReconnect()` while `shouldReconnectRef` is
true. There is no terminal state and no attempt ceiling — backoff caps at
`MAX_RECONNECT_DELAY_MS = 15000`.

When the server closes with `1008 "Session or canvas access was revoked"`
(websocket-server.ts L773) or rejects the upgrade with 403, the browser retries
every 15 s indefinitely, for as long as the tab stays open.

**Why it matters.** A user removed from a shared canvas generates a permanent
4/minute authenticated request stream. Multiply by every revoked share that
leaves a tab open.

**Fix.** Inspect `event.code` in `onclose`: treat `1008` and `1003` as terminal,
set status `"disconnected"`, and surface "You no longer have access to this
canvas" in the UI. Cap total attempts for other codes.

---

## LOG-13 — Two parallel authorization helper modules with different error contracts

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [lib/auth/middleware.ts](src/lib/auth/middleware.ts) vs [lib/api/auth.ts](src/lib/api/auth.ts) |
| **Blocker** | No |

Two modules export overlapping names (`requireAuth`, `requireCanvasOwnership`,
`withAuth`) with incompatible semantics:

| | `lib/auth/middleware.ts` | `lib/api/auth.ts` |
| --- | --- | --- |
| Auth source | `auth()` directly | `getCachedSession()` |
| Errors | `throw new Error("Unauthorized")` — **string matching** | Typed `UnauthorizedError` / `ForbiddenError` |
| Share-aware | No | Yes (`requireCanvasAccess`) |

The string-matching handler is actively dangerous:

```ts
if (error.message.includes("not found")) {
  return problemToResponse(Problems.NotFound(error.message));
}
```

Any internal error whose message happens to contain "not found" — a Prisma
message, a module resolution failure, a third-party library string — is
converted into a 404 **and its raw message is returned to the client**. That is
both an incorrect status and an information-disclosure path.

**Fix.** Delete `lib/auth/middleware.ts`; migrate all callers to `lib/api/auth.ts`.
If it has no callers, it is dead code — remove it outright.

---

## LOG-14 — Viewport state has two competing sources of truth

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [canvasStore.ts:71-73, 128-130](src/stores/canvasStore.ts#L71-L73) vs [use-canvas-data.ts:57-58](src/features/canvas/hooks/use-canvas-data.ts#L57-L58) |
| **Blocker** | No |

`canvasStore` declares `currentZoom` / `currentPanX` / `currentPanY` with
`setZoom` / `setPan` / `resetView`, documented as the viewport source of truth.
`CanvasBoard` instead uses `zoom` / `position` from `useCanvasData`'s local
`useState`. The store's viewport fields are not read by the canvas at all.

The store also imports `zustand/middleware`'s `devtools` unconditionally, so the
devtools wrapper ships in the production bundle.

**Fix.** Delete the unused viewport slice from the store (keeping `activeTool`,
grid, and drawing preferences, which *are* used and persisted), or move the
viewport into it properly. Gate `devtools` on `NODE_ENV !== "production"`.

---

## LOG-15 — Two real-time mechanisms run concurrently

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [use-canvas-items.ts:422-457](src/lib/hooks/use-canvas-items.ts#L422-L457), [use-collaboration.ts](src/lib/hooks/use-collaboration.ts) |
| **Blocker** | No |

`useCanvasItemsWithPolling` implements adaptive polling (5 s active / 30 s
inactive), while the WebSocket path delivers committed events with cursor-based
replay. Both are live; the polling default is `ENABLE_COLLABORATIVE_POLLING`.

Beyond redundancy, `mergeCommittedCanvasItemEvent` issues **one `GET /canvas-items/:id`
per event** (L262). A burst of edits from a collaborator — say a 50-item
alignment operation — produces 50 sequential single-item fetches on every
connected client.

**Fix.** Choose the WebSocket stream as the collaboration path and reduce polling
to a slow safety net (or off). Batch event application: coalesce a tick's worth
of events and fetch the affected ids in one ranged request.

---

## LOG-16 — Redis pub/sub for multi-instance fanout initialises once at import

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [websocket-server.ts:151-163](src/lib/collaboration/websocket-server.ts#L151-L163) |
| **Blocker** | No (single-instance launch) |

```ts
const redisPublisher = getRedisClient();
const redisSubscriber = redisPublisher ? redisPublisher.duplicate() : null;
```

Evaluated at module load. If Redis is unreachable at boot, `redisSubscriber` is
permanently `null` — there is no retry — so the process runs forever with
cross-instance presence, cursor, chat, and committed-event fanout silently
disabled. Every publish path early-returns on `!redisPublisher`.

**Why it matters.** `AGENTS.md` explicitly defers multi-instance deployment, so
this is not a launch blocker — but it is exactly the failure that would make a
future horizontal scale-out appear to work while silently partitioning users.

**Fix.** Lazily resolve the client per publish/subscribe, or subscribe on the
ioredis `ready` event. Add a startup assertion that fails loudly if `REDIS_URL`
is set but the subscriber could not be created.

---

## LOG-17 — Batch layout PATCH performs up to 1000 sequential queries under a lock

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [canvas-items/route.ts:118-161](src/app/api/v1/canvas-items/route.ts#L118-L161) |
| **Blocker** | No |

The batch accepts up to 500 items and, inside a single transaction holding
`lockCanvasForMutation`, runs per item: one `updateMany` **plus** one
`recordCanvasItemEvent` — up to 1000 sequential round trips while every other
writer on that canvas blocks.

**Fix.** Use a single `UPDATE ... FROM (VALUES ...)` for positions and one bulk
`createMany` for the events. Lower the cap until that lands — 500 sequential
round trips is a transaction long enough to hit statement timeouts.

---

## LOG-18 — AI and export routes load unbounded result sets into memory

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [ai/summarize/route.ts:11-16](src/app/api/v1/ai/summarize/route.ts#L11-L16), [users/account/route.ts:29-80](src/app/api/v1/users/account/route.ts#L29-L80) |
| **Blocker** | No |

- **Summarize** does `include: { items: { where: { deletedAt: null } } }` with no
  `take`, pulling every item (up to 2000, each with a JSON `content` blob) into
  memory — then `summarizeCanvas` immediately does `.slice(0, 1000)`. The `take`
  belongs in the query.
- **Account export** builds the user's entire graph (all workspaces → all
  canvases → all items → all shares) as one in-memory JSON response. A
  maxed-out account (200 canvases × 2000 items) is hundreds of MB, unstreamed,
  with no rate limit beyond the generic API limiter.

**Fix.** `take: 1000` on the summarize query. Make export an async job that
writes to object storage and emails a signed link — the outbox worker already
exists for exactly this shape of work.

---

## LOG-19 — Dead and vestigial code

| | | |
| --- | --- | --- |
| **LOG-19a** | Low | `Canvas.thumbnail` (`@db.Text`, base64) — thumbnails now go to object storage via `thumbnailKey`. Column appears unused; confirm and drop in a migration. |
| **LOG-19b** | Low | `UNSAFE_LEGACY_CACHES` in [public/sw.js](public/sw.js) is unreachable: the filter `name !== CACHE_NAME \|\| UNSAFE_LEGACY_CACHES.has(name)` already deletes every non-current cache. |
| **LOG-19c** | Low | `withAuth` in [lib/auth/middleware.ts:78-87](src/lib/auth/middleware.ts#L78-L87) takes a handler receiving only a user and no request — unusable for any real route. |
| **LOG-19d** | Low | `getCanvasAccess` accepts `_userEmail` and never uses it ([lib/api/auth.ts:47-51](src/lib/api/auth.ts#L47-L51)); the parameter is threaded through every caller for nothing. |

---

## LOG-20 — Type-safety escape hatches at data boundaries

| | |
| --- | --- |
| **Severity** | Low |
| **Location** | [route-handler.ts:26, 125, 142](src/lib/api/route-handler.ts#L26), [share/[token]/page.tsx:42](src/app/share/[token]/page.tsx#L42), [use-canvas-items.ts:519, 603, 615](src/lib/hooks/use-canvas-items.ts#L519) |
| **Blocker** | No |

`RouteContext` is typed `... | any`, defeating the whole type; `withIdempotency`
and `withAuthValidation` take `session: any`; optimistic cache updaters take
`(old: any)`; the share page holds `useState<any>(null)`.

UI-03 is a direct consequence: `data.zoomLevel` on an `any` compiles fine and is
always `undefined`. These are the specific places where types would have caught
shipped bugs.

**Fix.** Type the query cache updaters against the list response shape and give
the share page a response interface. Those two changes alone would have
prevented UI-01 and UI-03.

---

## Production Blockers

Must be fixed before launch:

| ID | Title | Why it blocks |
| --- | --- | --- |
| **LOG-01** | Item lists silently drop items | Users lose visibility of durable data with no error. Highest-severity finding in this audit. |
| **LOG-02** | Live cursors die after seconds | Headline collaboration feature is non-functional in normal use. |
| **LOG-03** | Lockout checked after password verify | Lockout does not throttle attacker work; locked accounts still authenticate. |
| **LOG-08** | Unrecoverable bulk canvas delete | One mis-click permanently destroys canvases with no restore path. |

Adjacent blockers tracked elsewhere: UI-04 (public shares capped at 50),
UI-05 (search hides item types), UI-14 (silent failures),
SEC-01 (login reveals account existence), SEC-03 (`shareToken` leaked to viewers).

## Fix order

1. **LOG-01** — metadata after truncation; add the regression test.
2. **LOG-03** + SEC-01 — one pass over `authorize()`, both are in that function.
3. **LOG-02** — client throttle; ~10 lines.
4. **LOG-08** — soft delete + `allSettled`; needs a migration, start early.
5. **LOG-05 / LOG-06** — the mutation-lifecycle pass; do them together.
6. **LOG-04** — restore endpoint (depends on LOG-08's soft-delete work).
7. **LOG-10 / LOG-11 / LOG-12** — WebSocket robustness sweep, one PR.
8. **LOG-13 / LOG-14 / LOG-19 / LOG-20** — cleanup; low risk, do while the above bake.
