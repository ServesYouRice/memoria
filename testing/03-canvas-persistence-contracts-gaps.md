# 03 — Canvas Persistence, Bounded Responses & Contract Testing Gaps

## Domain Overview & Architecture

Canvas persistence in Memoria manages 10 distinct item types (`NOTE`, `BOOKMARK`, `IMAGE`, `DRAWING`, `SHAPE`, `ARROW`, `TEXT`, `FRAME`, `EMBED`, `POLL`) with spatial coordinates, z-indices, optimistic concurrency versions, and byte-budgeted response pagination.

```
Client Canvas Hook (use-canvas-data.ts)
   |  GET /api/v1/canvases/:id/items
   v
src/lib/api/bounded-response.ts (512 KB Byte Budget Truncation)
   v
Prisma -> PostgreSQL ("CanvasItem" Table with optimistic versioning)
```

---

## Detailed Testing Gaps & Audit Findings

### GAP-PERSIST-01: Bounded Response Byte Truncation & `hasMore` Corruption (`LOG-01`, `PERF-01`)
- **Severity**: **Critical**
- **Affected Files**: `src/lib/api/bounded-response.ts`, `src/app/api/v1/canvases/[canvasId]/items/route.ts`
- **Defect Description**:
  1. `boundedItemsResponse()` calculates `hasMore` *before* trimming items that exceed `ITEM_RESPONSE_BYTE_BUDGET` (512 KB). If items 40-50 are dropped due to byte size, `hasMore` remains `false`, causing the client to never fetch the remaining items.
  2. The function serializes `JSON.stringify(body)` inside a loop over every item, creating an O(n²) CPU bottleneck (~250 MB of string allocations for a 500 KB response).
- **Current Test Gap**: `tests/integration/backend-contracts.test.ts` only tests a 5-item list well under the 512 KB limit. No test asserts behavior when items exceed the byte budget.
- **Invariant Requirement**: When byte truncation occurs, `truncatedByBytes` and `hasMore` must be `true`, and the `nextOffset` must equal `accepted.length`.

### GAP-PERSIST-02: Client-Server API Response Contract Drift (`UI-01`, `UI-03`, `LOG-20`, `NTH-13`)
- **Severity**: **High**
- **Affected Files**: `src/lib/api/response-schemas.ts`, `src/app/share/[token]/page.tsx`, `src/features/dashboard/`
- **Defect Description**:
  - `share/[token]/page.tsx` expects `{ zoomLevel, panX, panY }` at the root of the JSON payload, whereas the API returns `{ canvas: { zoomLevel, panX, panY } }`.
  - The dashboard component accesses `canvas.thumbnail`, but the API schema defines `thumbnailKey`.
  - Client data fetching functions bypass `z.infer<typeof schema>` and use unsafely typed `any` casts.
- **Current Test Gap**: Unit tests for API routes test the route in isolation; React component tests use handcrafted mock objects that do not match the real Prisma route response.
- **Invariant Requirement**: React components and API routes must share single-source-of-truth Zod schemas from `response-schemas.ts`. Integration contract tests must validate that live API outputs parse cleanly through frontend consumer types.

### GAP-PERSIST-03: Optimistic Concurrency Version Collisions on Concurrent Item Updates
- **Severity**: **High**
- **Affected Files**: `src/app/api/v1/canvas-items/route.ts`, `src/features/canvas/hooks/use-canvas-item-handlers.ts`
- **Defect Description**: When two clients update item geometry simultaneously with identical base `version: 1`, the second update must be rejected with `409 Conflict` and the client must reconcile state rather than silently overwriting the item.
- **Current Test Gap**: `tests/integration/persistence.test.ts` tests single-client updates sequentially, but never executes simultaneous concurrent patch requests against the same item.
- **Invariant Requirement**: Concurrent updates on identical item versions must enforce strict optimistic locking via `WHERE id = $1 AND version = $2` and return 409 on version mismatch.

### GAP-PERSIST-04: Bulk Canvas Deletion Hard Cascade Data Loss (`LOG-08`)
- **Severity**: **High**
- **Affected Files**: `src/app/api/v1/canvases/[canvasId]/route.ts`, `prisma/schema.prisma`
- **Defect Description**: Canvas deletion executes a raw hard cascade across items, versions, and shares without a soft-delete grace period or trash bin recovery mechanism.
- **Current Test Gap**: Tests only verify that deletion returns 204; there are no tests asserting recovery, trash restoration, or soft-delete filtering.
- **Invariant Requirement**: Deletion must transition `deletedAt: new Date()` and trash listing must support restoration within the retention window.

---

## Actionable Test Implementation Matrix

| Test ID | Scope | Target File | Test Strategy | Target Model |
| --- | --- | --- | --- | --- |
| `TEST-PERSIST-01` | Unit / Perf | `tests/unit/bounded-response-truncation.test.ts` | Generate 200 items (1MB total); assert accurate `hasMore`, `nextOffset`, and O(n) runtime | Sonnet |
| `TEST-PERSIST-02` | Integration | `tests/integration/api-contract-parity.test.ts` | Fetch `/api/v1/canvases` & `/api/v1/share/:token` and validate against UI consumption schemas | Sonnet + Opus |
| `TEST-PERSIST-03` | Integration | `tests/integration/optimistic-locking-race.test.ts` | Send 2 simultaneous PATCH requests with version 1; assert exactly one 200 and one 409 | Sonnet |
| `TEST-PERSIST-04` | Unit | `tests/unit/canvas-soft-delete.test.ts` | Assert soft-delete status flags and trash bin query filtering | Sonnet |

---

## Advisor-Executor Prompt Specification

```xml
<test_specification domain="canvas_persistence_contracts">
  <context>
    Memoria uses bounded response pagination in src/lib/api/bounded-response.ts and Zod schemas in src/lib/api/response-schemas.ts.
  </context>
  <task>
    Author unit tests verifying byte-budgeted item response truncation and end-to-end API response contract parity.
  </task>
  <invariants>
    1. If items are truncated by byte budget, hasMore MUST be true and nextOffset MUST equal the accepted items count.
    2. Response payloads from /api/v1/canvases and /api/v1/share/[token] MUST match response-schemas.ts definitions exactly.
    3. Simultaneous updates with identical version IDs must reject the second update with 409 Conflict.
  </invariants>
  <verification>
    pnpm test tests/unit/bounded-response-truncation.test.ts tests/integration/api-contract-parity.test.ts
  </verification>
</test_specification>
```
