# Slice 4: Architecture Overview

## System Architecture

```
Browser (Client)
  | HTTP/JSON
  v
Next.js App Router + API (server.ts)
  | Prisma ORM
  v
PostgreSQL

WebSocket /api/collaboration/:canvasId
  | Yjs updates
  v
Collaboration Server (ws)
  | Redis pub/sub (optional)
  v
Other instances
```

Additional Components
- Custom Node server (`server.ts`) hosts Next.js and the collaboration WebSocket server.
- WebSocket collaboration uses Yjs docs with database persistence and optional Redis pub/sub fanout.
- Redis is optional for caching (canvas snapshots, unfurl) and rate limiting.
- Uploads support local disk storage or S3-compatible object storage via `UPLOAD_STORAGE`.

## Data Flow

### 1. Create Note Flow
```
User clicks "Add Note"
  ->
Canvas component calls useCreateCanvasItem()
  ->
TanStack Query mutation -> POST /api/v1/canvases/:id/items
  ->
API validates with Zod schema
  ->
API verifies canvas ownership
  ->
Prisma creates CanvasItem (version=1, zIndex=auto)
  ->
Returns 201 Created with new item
  ->
TanStack Query invalidates cache
  ->
Canvas refetches items
  ->
NoteItem component renders on canvas
```

### 2. Move Note Flow (with Debounce)
```
User drags note to new position
  ->
NoteItem updates local state (instant visual feedback)
  ->
onDragEnd -> calls debouncedUpdatePosition(x, y)
  ->
Debounce waits 300ms (no more drag events)
  ->
useUpdateCanvasItem() mutation -> PATCH /api/v1/.../items/:id
  ->
Request includes: { positionX, positionY, version }
  ->
API validates version matches current item.version
  ->
If version mismatch -> 409 Conflict
  ->
If version OK -> update item, increment version
  ->
Returns updated item
  ->
TanStack Query updates cache
```

### 3. Version Conflict Flow
```
Tab A: User moves note (version 1)
Tab B: User resizes same note (version 1)
  ->
Tab A: PATCH with version=1 -> Success (now version 2)
  ->
Tab B: PATCH with version=1 -> 409 Conflict
  ->
useUpdateCanvasItem detects conflict error
  ->
Automatically invalidates query cache
  ->
Refetches latest items (now has version 2)
  ->
User's local changes preserved in local state
  ->
User can retry update with version 2
```

### 4. Delete Note Flow
```
User clicks delete button
  ->
Confirmation dialog -> "Are you sure?"
  ->
User confirms
  ->
useDeleteCanvasItem() -> DELETE /api/v1/.../items/:id
  ->
API verifies ownership
  ->
Prisma updates item: { deletedAt: now, deletedById: userId }
  ->
Returns 204 No Content
  ->
TanStack Query invalidates cache
  ->
Canvas refetches (excludes deleted items)
  ->
NoteItem removed from canvas
```

## State Management Strategy

### Server State (TanStack Query)
- **What**: All data persisted in database
- **Examples**: Canvas items, user data, canvas metadata
- **Cache Keys**: `['canvasItems', 'list', canvasId]`
- **Invalidation**: On mutations (create, update, delete)

### Client State (Local React State)
- **What**: Ephemeral UI state during interactions
- **Examples**: 
  - Current drag position (before save)
  - Current resize dimensions (before save)
  - Hover state
- **Why**: Smooth UX without waiting for server

### Future Client State (Zustand - not yet implemented)
- **What**: Global UI state
- **Examples**:
  - Selected item ID
  - Active tool (select, pan, text)
  - Zoom level
  - Modal open/closed state

## Error Handling Strategy

### Client-Side
```
API Error
  ->
TanStack Query catches error
  ->
If 409 (conflict)  Auto-refetch
  ->
If 4xx/5xx  Display error to user
  ->
User can retry operation
```

### Server-Side
```
Request
  ->
Try {
  Validate  Authorize  Execute
}
  ->
Catch (error) {
  if (ZodError)  400 with validation details
  if (ApiError)  Use error.status
  else  500 Internal Server Error
}
  ->
Return RFC 7807 JSON response
```

## Security Layers

### Layer 1: Input Validation
- Zod schemas validate all inputs
- Type checking (TypeScript)
- Range validation (min/max)

### Layer 2: Authorization
- Canvas ownership verification
- User ID from auth session
- Database-level filtering

### Layer 3: SQL Injection Prevention
- Prisma ORM (parameterized queries)
- No raw SQL for user input

### Layer 4: Audit Trail
- createdBy, updatedBy, deletedBy tracking
- Timestamps on all operations
- Soft deletes (data recovery)

## Performance Optimizations

### 1. Debounced Autosave
- **Problem**: 100s of API calls during drag
- **Solution**: 300ms debounce
- **Result**: ~1 API call per interaction

### 2. Optimistic UI Updates
- **Problem**: Laggy feel waiting for server
- **Solution**: Update local state immediately
- **Result**: Instant visual feedback

### 3. Query Caching
- **Problem**: Refetching same data repeatedly
- **Solution**: TanStack Query cache (60s stale time)
- **Result**: Fewer API calls

### 4. Database Indexes
- **Problem**: Slow queries on large canvases
- **Solution**: Indexes on (canvasId, deletedAt, zIndex)
- **Result**: Fast item fetching

### 5. Soft Deletes
- **Problem**: Hard deletes prevent recovery
- **Solution**: deletedAt timestamp
- **Result**: Data recovery + faster "delete" operations

## Testing Strategy

### Unit Tests (Vitest)
- **Target**: Utilities, schemas, validation
- **Example**: Zod schema edge cases
- **Location**: `/tests/api/items.test.ts`

### Integration Tests (Future)
- **Target**: API endpoints with test DB
- **Example**: Full CRUD flow
- **Tools**: Vitest + Supertest + Test DB

### E2E Tests (Playwright)
- **Target**: User flows in browser
- **Example**: Create  Move  Resize  Delete
- **Location**: `/tests/e2e/note-crud.spec.ts`

## Deployment Considerations

### Environment Variables
```
DATABASE_URL=postgresql://...     # PostgreSQL connection
NEXTAUTH_URL=https://...          # Auth callback URL
NEXTAUTH_SECRET=...               # Session encryption
CRON_SECRET=...                   # Cron endpoint auth
REDIS_URL=redis://...             # Cache, rate limiting, collaboration pub/sub (optional)
UPLOAD_STORAGE=local|s3           # Upload backend selection
UPLOADS_PUBLIC_URL=https://...    # Public base URL for uploads (optional)
S3_BUCKET=...                     # S3 bucket name (when UPLOAD_STORAGE=s3)
S3_REGION=...                     # S3 region
S3_ENDPOINT=...                   # S3-compatible endpoint (optional)
S3_ACCESS_KEY_ID=...              # S3 access key (optional if using IAM)
S3_SECRET_ACCESS_KEY=...          # S3 secret key (optional if using IAM)
UPLOAD_SCAN_URL=https://...       # Malware scan service endpoint (optional)
UPLOAD_SCAN_REQUIRED=false        # Fail upload on scan failure
DEMO_USER_ID=...                  # Temporary (dev only)
```

### Build Process
```
1. pnpm install           # Install dependencies
2. pnpm db:generate       # Generate Prisma client
3. pnpm db:migrate        # Run migrations
4. pnpm build             # Build Next.js app
5. pnpm start             # Start production server
```

### Database Migrations
```
1. prisma migrate dev     # Create migration (dev)
2. prisma migrate deploy  # Apply migration (prod)
3. prisma db seed         # Seed data (optional)
```

## Scalability Considerations

### Current Limits
- Real-time collaboration via WebSocket + Yjs (single instance or Redis pub/sub fanout)
- Items API supports viewport pagination; UI still loads full canvases by default
- Handles 100s of items per canvas; larger boards benefit from viewport loading and culling
- Optional Redis caching improves hot reads but is not required

### Future Optimizations (Phase 2+)
- Binary WS frames for Yjs updates to reduce payload size
- Redis-backed awareness/presence store to reduce in-memory coupling
- Full-text indexes for search (trigram/tsvector)
- CDN/object storage for thumbnails and static assets

---

**Architecture Status**: Production-ready for MVP
**Last Updated**: 2026-01-05
