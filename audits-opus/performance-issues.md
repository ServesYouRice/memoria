# Performance & Scalability Issues

Scope: hot paths, query cost, render cost, payload size, memory, and the
scalability ceiling of the documented single-process topology. Inspection only —
**no profiling or load testing was performed**, so all cost estimates are derived
from reading the code, not measured.

Legend: **B** = blocker before production.

---

## PERF-01 — `boundedItemsResponse` is O(n²) on every item list request

| | |
| --- | --- |
| **Severity** | **High** |
| **Location** | [bounded-response.ts:8-25](src/lib/api/bounded-response.ts#L8-L25) |
| **Blocker** | **B** |

**Problem.** The byte budget is enforced by re-serialising the *entire
accumulated body* once per item:

```ts
for (const item of items) {
  if (!canvasItemResponseSchema.safeParse(item).success) { ... }
  accepted.push(item);
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > byteBudget) { ... }
}
```

`JSON.stringify(body)` walks every item already accepted, so total work is
`Σ(i=1..n) i` — quadratic in item count, on the single-threaded Node event loop.

**Cost estimate.** For n = 1000 items averaging 500 bytes, the loop serialises
roughly `n²/2 × 500 B` ≈ **250 MB** of string data to return a 500 KB response.
Every byte is allocated and immediately discarded, so it is GC pressure as well
as CPU. `MAX_VIEWPORT_ITEMS` is 1000 and `LAUNCH_LIMITS.itemsPerCanvas` is 2000,
so this is inside supported limits.

**Why it matters.** This runs on the hottest read path in the product —
every canvas open, every poll tick, every invalidation (see PERF-03). It is
synchronous, so it blocks the same event loop that serves WebSocket
collaboration for every other user on the instance. A handful of large canvases
opening concurrently is a self-inflicted denial of service.

**Fix.** Accumulate the byte count incrementally:

```ts
let bytes = baseMetadataBytes;
for (const item of items) {
  const encoded = JSON.stringify(item);
  const next = bytes + Buffer.byteLength(encoded, "utf8") + 1;
  if (next > byteBudget) { truncated = true; break; }
  accepted.push(item);
  bytes = next;
}
```

That is O(n). While there, also reconsider `canvasItemResponseSchema.safeParse`
per item — full Zod validation of every row on every read is a second linear
cost on the same path; sampling or a cheaper shape check would do.

**Related.** LOG-01 — the same function silently drops items. Fix both together.

---

## PERF-02 — `localStorage` is written synchronously on every pan and zoom frame

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [use-canvas-data.ts:129-135](src/features/canvas/hooks/use-canvas-data.ts#L129-L135) |
| **Blocker** | No |

```ts
useEffect(() => {
  if (!viewportInitializedRef.current) return;
  window.localStorage.setItem(
    `canvas:${canvasId}:viewport`,
    JSON.stringify({ zoom, x: position.x, y: position.y }),
  );
}, [canvasId, position.x, position.y, zoom]);
```

`position` and `zoom` update on every pointer move during a pan and on every
wheel tick during a zoom. `localStorage.setItem` is a **synchronous, blocking**
main-thread API that in most browsers hits disk.

**Why it matters.** Panning is the single most common canvas interaction. A
blocking write per frame competes directly with Konva's render loop, producing
exactly the stutter users describe as "the canvas feels heavy" — and it is
invisible in React profiling because the cost is in the platform API.

**Fix.** Debounce to ~300 ms after interaction stops, or write on
`pointerup`/`wheel`-end. The value is only read once on mount
([L101](src/features/canvas/hooks/use-canvas-data.ts#L101)), so per-frame
freshness has no purpose.

---

## PERF-03 — Thumbnail regeneration is triggered by any item change

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [CanvasBoard.tsx:644-669](src/features/canvas/components/CanvasBoard.tsx#L644-L669) |
| **Blocker** | No |

```ts
const thumbnailRevision = React.useMemo(
  () => allItems.map((item) => `${item.id}:${item.version}`).join("|"),
  [allItems],
);

useEffect(() => {
  if (!isOwner || allItems.length === 0) return;
  const timeoutId = setTimeout(() => { generateThumbnail(); }, 3000);
  return () => clearTimeout(timeoutId);
}, [allItems.length, generateThumbnail, isOwner, thumbnailRevision]);
```

Three compounding costs:

1. **The revision string** is rebuilt on every `allItems` identity change —
   a 2000-item canvas produces a ~60 KB string, allocated per render.
2. **Any version bump** on any item changes the string, restarting the 3 s timer.
   A user editing continuously never triggers it; a user who pauses 3 s triggers
   a full capture — so during active work this fires repeatedly.
3. **The capture itself** is `stage.toDataURL()` — a synchronous full-canvas
   rasterisation to base64 JPEG on the main thread — then a `POST` of up to
   200 KB, which enqueues an outbox job, which writes to object storage.

**Why it matters.** An expensive main-thread rasterisation plus a network round
trip plus a durable job, all fired by ordinary editing. It also consumes the
`canvasesRateLimit` budget of 50/min (PERF-06). And per **UI-01**, the resulting
thumbnails are never displayed anywhere.

**Fix.** Fix UI-01 first — if thumbnails aren't shown, this is pure waste. Then:
trigger on canvas *close* / route change and on a long idle timer (60 s+), not
on every edit; hash `allItems.length` plus a max `updatedAt` instead of building
a per-item string; move capture off the interaction path with
`requestIdleCallback`.

---

## PERF-04 — Invalidation storm refetches the whole canvas per item mutation

| | |
| --- | --- |
| **Severity** | High |
| **Location** | [use-canvas-items.ts:630-663](src/lib/hooks/use-canvas-items.ts#L630-L663) |
| **Blocker** | No |

Detailed as a correctness issue in **LOG-05**; the performance consequence is
distinct enough to record separately.

Each `useUpdateCanvasItem` invalidates the canvas list in `onSuccess` **and**
every list query globally in `onSettled`. Each resulting refetch runs
`api.listItems`, which pages sequentially (`await` in a loop,
[L123-135](src/lib/hooks/use-canvas-items.ts#L123-L135)), and each page pays
PERF-01's quadratic cost server-side.

**Amplification chain for one multi-select drag of 20 items:**

```
20 mutations
  → 40 invalidations (onSuccess + onSettled)
    → N sequential HTTP requests each (N = ceil(items / page))
      → each server page: O(n²) serialisation + per-item Zod validation
```

Against `itemsRateLimit` at 200/min, a few multi-item operations can 429 the
user out of their own canvas.

**Fix.** Per LOG-05: delete `onSettled`, scope the `onMutate` cancel to the
current canvas, and let the committed-event WebSocket stream handle convergence.

---

## PERF-05 — Committed events fetch one item per event

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [use-canvas-items.ts:236-301](src/lib/hooks/use-canvas-items.ts#L236-L301) |
| **Blocker** | No |

`mergeCommittedCanvasItemEvent` calls `api.getItem(event.entity.id)` for every
create/update event. A collaborator running the batch layout endpoint (up to 500
items, [canvas-items/route.ts:102-115](src/app/api/v1/canvas-items/route.ts#L102-L115))
emits one event per item, so **every connected client** issues up to 500
individual `GET /canvas-items/:id` requests.

With 10 collaborators that is 5000 requests against an endpoint whose per-IP
budget is 200/min.

**Fix.** Coalesce events over a short window (~100 ms) and fetch the affected ids
in one request — the list endpoint could accept an `ids` filter. Alternatively
include the item payload in the event so no fetch is needed.

---

## PERF-06 — Rate-limit budgets are below normal canvas usage

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [middleware/rate-limit.ts:97-113](src/middleware/rate-limit.ts#L97-L113) |
| **Blocker** | No |

| Limiter | Budget | Consumers |
| --- | --- | --- |
| `canvasesRateLimit` | 50/min | canvas GET, viewport autosave PATCH, thumbnail POST, versions, shares, events replay — all under `/api/v1/canvases` |
| `itemsRateLimit` | 200/min | item CRUD, list paging, per-event fetches (PERF-05), invalidation refetches (PERF-04) |

The viewport autosave debounces at 750 ms
([use-canvas-data.ts:142](src/features/canvas/hooks/use-canvas-data.ts#L142)), so
a user who pans in bursts can issue ~40 PATCHes/min on its own, before
thumbnails (PERF-03) and metadata refetches. Because limits are per-IP (SEC-07),
several colleagues behind one NAT share the 50.

**Fix.** Raise the budgets once PERF-03/04 stop generating avoidable traffic, key
them by user (SEC-07), and give viewport autosave its own generous bucket — it is
a preference write, not a security-sensitive mutation.

---

## PERF-07 — Batch layout endpoint issues up to 1000 sequential queries under a lock

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [canvas-items/route.ts:118-161](src/app/api/v1/canvas-items/route.ts#L118-L161) |
| **Blocker** | No |

Covered as **LOG-17**. In performance terms: 500 items × (`updateMany` +
`recordCanvasItemEvent`) = up to 1000 sequential round trips inside one
transaction, holding `lockCanvasForMutation` throughout. Every other writer on
that canvas blocks for the duration, and the transaction is long enough to risk
statement timeouts.

**Fix.** Single `UPDATE ... FROM (VALUES ...)` plus one `createMany` for events.

---

## PERF-08 — WebSocket authorization refresh scales with canvas count, not user count

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [websocket-server.ts:571-601, 722-779](src/lib/collaboration/websocket-server.ts#L571-L601) |
| **Blocker** | No |

The 30 s heartbeat calls `revalidateCanvasConnections` **per canvas**, and each
call runs two queries (`canvas.findUnique` with a shares join, and
`user.findMany`).

At 500 concurrently-open canvases that is 1000 queries/minute of pure overhead,
independent of whether anything changed. `MAX_CONNECTIONS_GLOBAL` is 5000, so
the design contemplates this scale.

**Fix.** Drive re-authorization from change events (share revoked,
`sessionVersion` bumped) published over the existing Redis channel, and keep the
polling refresh as a slow backstop (5 min). Or batch across canvases into one
query per tick.

---

## PERF-09 — O(N) scans over all connections on every WebSocket connect

| | |
| --- | --- |
| **Severity** | Low |
| **Location** | [websocket-server.ts:660-671](src/lib/collaboration/websocket-server.ts#L660-L671) |
| **Blocker** | No |

```ts
const activeConnections = Array.from(connections.values()).flatMap((set) => Array.from(set));
if (activeConnections.filter((c) => c.user.userId === user.userId).length >= MAX_CONNECTIONS_PER_PRINCIPAL || ...)
```

Every admission materialises an array of all connections (up to 5000) and scans
it twice. `getConnectionCount()` (L1029) does another full walk on each upgrade.

**Fix.** Maintain counter maps keyed by `userId` and `clientId`, incremented on
connect and decremented on close. O(1) admission.

---

## PERF-10 — Unbounded queries on AI and export paths

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [ai/summarize/route.ts:11-16](src/app/api/v1/ai/summarize/route.ts#L11-L16), [users/account/route.ts:29-80](src/app/api/v1/users/account/route.ts#L29-L80) |
| **Blocker** | No |

Covered as **LOG-18**. Summarize loads every item then slices to 1000 in
JavaScript; account export materialises the user's entire object graph as one
in-memory JSON document with no streaming.

**Fix.** `take: 1000` in the summarize query; make export an outbox job that
writes to object storage.

---

## PERF-11 — Client-side item paging is a sequential waterfall

| | |
| --- | --- |
| **Severity** | Low |
| **Location** | [use-canvas-items.ts:118-141](src/lib/hooks/use-canvas-items.ts#L118-L141) |
| **Blocker** | No |

```ts
while (hasMore && pageCount < 100) {
  const nextPage = await fetchPage(currentOffset, pageLimit);
  ...
}
```

Pages are fetched strictly one after another, so canvas open latency is
`pages × RTT`. With the 512 KB budget (PERF-01) a 2000-item canvas needs several
pages; on a 150 ms connection that is a second of dead time behind a Suspense
boundary before anything renders.

**Note.** The `pageCount < 100` guard cannot be hit given
`itemsPerCanvas = 2000` and a 1000 default limit, so the
`"Canvas exceeds the safe item page limit"` error at L137 is unreachable in
practice — but the sequential shape is real.

**Fix.** Return the total on page one and issue the remaining page requests in
parallel. Better: render the first page immediately and stream the rest in.

---

## PERF-12 — Konva renders all filtered items with no virtualisation on the render path

| | |
| --- | --- |
| **Severity** | Medium — **verify** |
| **Location** | [CanvasBoard.tsx:1158-1168](src/features/canvas/components/CanvasBoard.tsx#L1158), [use-virtual-items.ts](src/lib/hooks/use-virtual-items.ts) |
| **Blocker** | No |

`useVirtualItems` exists and `CanvasItemLayer` receives `renderedItems`, which
suggests viewport culling is wired up — but this was not traced end to end, so
whether culling actually applies at all zoom levels is **unverified**.

Worth confirming under a 2000-item canvas before launch, since that is the
supported ceiling and Konva re-renders are the dominant frame cost. If culling
is active, close this; if not, it is High.

---

## PERF-13 — Bundle and asset observations

| | |
| --- | --- |
| **Severity** | Low |
| **Location** | [providers.tsx:20, 76](src/app/providers.tsx#L20), [canvasStore.ts:107](src/stores/canvasStore.ts#L107) |
| **Blocker** | No |

- `ReactQueryDevtools` is imported unconditionally at module top level and only
  its *render* is gated on `NODE_ENV`. Confirm tree-shaking actually removes it
  from the production bundle — if not, it is a sizeable dev-only dependency
  shipped to users.
- Zustand `devtools` middleware wraps the store unconditionally.
- Konva/react-konva are correctly `dynamic(..., { ssr: false })`
  ([canvas/[canvasId]/page.tsx:15-24](src/app/canvas/[canvasId]/page.tsx#L15-L24)).
- CI enforces bundle budgets via `pnpm check-bundle` — good; make sure the
  canvas route's budget reflects Konva's real weight rather than being set to
  whatever it happened to measure.

---

## Summary and fix order

| ID | Severity | Title | Blocker |
| --- | --- | --- | --- |
| PERF-01 | High | `boundedItemsResponse` is O(n²) | **Yes** |
| PERF-02 | High | `localStorage` write per pan/zoom frame | No |
| PERF-03 | High | Thumbnail regenerated on any item change | No |
| PERF-04 | High | Invalidation storm per mutation | No |
| PERF-05 | Medium | One fetch per committed event | No |
| PERF-06 | Medium | Rate limits below normal usage | No |
| PERF-07 | Medium | 1000 sequential queries under a lock | No |
| PERF-08 | Medium | Auth refresh scales with canvas count | No |
| PERF-10 | Medium | Unbounded AI/export queries | No |
| PERF-12 | Medium | Canvas virtualisation — **verify** | No |
| PERF-09 | Low | O(N) scan per WebSocket connect | No |
| PERF-11 | Low | Sequential paging waterfall | No |
| PERF-13 | Low | Dev tooling in production bundle | No |

**Order:**

1. **PERF-01** — one function, biggest server-side win, pairs with LOG-01.
2. **PERF-04** — delete `onSettled`; removes the traffic multiplier that makes
   PERF-01, PERF-05, and PERF-06 worse.
3. **PERF-02** — debounce; a few lines, directly felt by users.
4. **PERF-03** — gate on UI-01's outcome, then move off the edit path.
5. **PERF-12** — verify virtualisation before deciding anything else about
   canvas render cost.
6. **PERF-05 / PERF-07 / PERF-08 / PERF-10** — batching pass.
7. **PERF-06** — retune limits *after* the above, so the numbers reflect real
   traffic rather than avoidable traffic.
8. **PERF-09 / PERF-11 / PERF-13** — cleanup.

### Measurement gap

No load testing exists in this repository. Before launch, establish a baseline
for: canvas open latency at 500/1000/2000 items, frame time during pan with 500
visible items, and event-loop lag with 50 concurrent WebSocket clients. Without
those numbers every item above is a reasoned estimate, and the fix order should
be revisited once real measurements exist.
