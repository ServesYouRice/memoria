# Bookmark MVP Implementation (Slice 5)

## Overview

This document describes the Bookmark CRUD implementation for the CanvasCollect MVP (Slice 5). The implementation provides full CRUD operations for bookmark items on the canvas, with the same autosave and concurrency control as Note items.

## Implementation Status: COMPLETE

All MVP requirements for Bookmark items have been implemented:
- ✅ Create bookmarks with URL validation
- ✅ Move bookmarks (drag)
- ✅ Resize bookmarks (handles)
- ✅ Delete bookmarks (soft delete)
- ✅ Autosave with debouncing (500ms)
- ✅ Optimistic concurrency control (version field)
- ✅ Authorization checks (ownership)
- ✅ Unit tests
- ✅ E2E tests

## Architecture

### Data Model

Bookmarks use the same `CanvasItem` model as Notes, with `type = BOOKMARK`:

```typescript
{
  id: string;
  canvasId: string;
  type: ItemType.BOOKMARK;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  content: {
    url: string;  // Only URL in MVP
  };
  version: number;  // For optimistic locking
  // ... audit fields
}
```

### URL Validation

Following security best practices (ADR-0003), bookmark URLs are strictly validated:

- ✅ Only `http://` and `https://` protocols allowed
- ✅ Maximum length: 2048 characters
- ❌ Rejects: `javascript:`, `file:`, `ftp:`, `data:`, etc.
- ✅ Standard URL format validation

This prevents XSS attacks and SSRF vulnerabilities.

### API Endpoints

All endpoints follow ADR-0001 (RFC 7807 error format) and include authorization:

- `POST /api/v1/canvas-items` - Create bookmark
- `GET /api/v1/canvas-items?canvasId={id}&type=BOOKMARK` - List bookmarks
- `GET /api/v1/canvas-items/{id}` - Get bookmark
- `PATCH /api/v1/canvas-items/{id}` - Update bookmark (with version)
- `DELETE /api/v1/canvas-items/{id}` - Soft delete bookmark (with version)

### Frontend Components

1. **BookmarkItem.tsx** - Konva component for rendering on canvas
   - Displays URL (truncated if long)
   - Drag to move
   - Resize handles (4 corners)
   - Delete button (when selected)
   - "Saving..." indicator during autosave

2. **CreateBookmarkDialog.tsx** - MUI dialog for creating bookmarks
   - URL input with validation
   - Phase 2 notice about unfurling
   - Error handling

3. **Hooks**
   - `useCanvasItems` - TanStack Query for fetching
   - `useCreateCanvasItem` - Create mutation
   - `useUpdateCanvasItem` - Update with version check
   - `useDeleteCanvasItem` - Soft delete
   - `useAutosave` - Debounced autosave (500ms)

## Phase 2: Bookmark Unfurling (DEFERRED)

### What is Bookmark Unfurling?

Bookmark unfurling is the process of fetching and displaying rich metadata from a URL:
- Page title
- Description/excerpt
- Favicon
- Preview image (Open Graph)
- Domain information

### Why Deferred to Phase 2?

Following ADR-0003 (SSRF-Protected Unfurling), implementing secure unfurling requires:

1. **SSRF Protection Infrastructure**
   - Hardened HTTP client with IP allowlist/denylist
   - DNS pinning to prevent TOCTOU attacks
   - Private IP range blocking (RFC 1918, RFC 4193)
   - Response size limits (≤ 2MB)
   - Redirect limits (≤ 3 hops)
   - Timeout enforcement (≤ 5 seconds)

2. **XSS Protection**
   - Server-side HTML sanitization (DOMPurify)
   - Content-Security-Policy enforcement
   - Image proxy for untrusted sources

3. **Caching Layer**
   - Redis or equivalent
   - URL hash-based keys
   - TTL: 24 hours default
   - Cache invalidation strategy

4. **Rate Limiting**
   - Per-user unfurl limits
   - Per-domain request limits
   - Backoff for failed requests

5. **Error Handling**
   - Graceful degradation (show URL if unfurl fails)
   - Retry logic with exponential backoff
   - Monitoring and alerting

### MVP Decision

For the single-user MVP, unfurling adds significant complexity without proportional value. The MVP focuses on core functionality:
- Users can save and organize bookmarks by URL
- URLs are validated for security
- Full CRUD operations work reliably

Unfurling will be added in Phase 2 when:
- Infrastructure for secure fetching is in place
- Caching layer is available
- More users benefit from rich previews

### Future Implementation Plan

When implementing Phase 2 unfurling:

1. **Database Schema Updates**
```prisma
// Add to BookmarkContent:
{
  url: string;
  title?: string;
  description?: string;
  favicon?: string;
  previewImage?: string;
  unfurledAt?: DateTime;
  unfurlError?: string;
}
```

2. **New API Endpoint**
```
POST /api/v1/bookmarks/unfurl
Body: { url: string }
Response: UnfurledMetadata
```

3. **Background Jobs**
- Async unfurling queue
- Periodic re-unfurling for stale data
- Failed unfurl retry queue

4. **UI Updates**
- Show rich preview in BookmarkItem
- Loading state during unfurl
- Fallback to URL-only display on error
- Manual re-unfurl button

## Testing

### Unit Tests

Location: `src/lib/validation/__tests__/canvas-item.test.ts`

Tests cover:
- ✅ Valid http/https URLs accepted
- ✅ Invalid protocols rejected (javascript:, file:, ftp:)
- ✅ URL length limits enforced
- ✅ Malformed URLs rejected
- ✅ Version field required for updates
- ✅ Geometry validation

### E2E Tests

Location: `tests/e2e/bookmark-crud.spec.ts`

Tests cover:
- ✅ Create bookmark from dialog
- ✅ URL validation in UI
- ✅ Drag to move bookmark
- ✅ Resize using handles
- ✅ Delete bookmark (with confirmation)
- ✅ Autosave indicator appears
- ✅ Version conflict detection
- ✅ Authorization (403 for unauthorized access)
- ✅ Multiple bookmarks display
- ✅ Long URL truncation
- ✅ Phase 2 notice displayed

## Security

Following SENATE.md security policies:

1. **Authentication & Authorization**
   - All API endpoints require authentication
   - Ownership checked at database query level
   - Canvas access verified before item operations

2. **Input Validation**
   - Zod schemas validate all inputs
   - URL protocol restrictions prevent XSS
   - Length limits prevent DoS
   - CUID validation prevents injection

3. **Concurrency Control**
   - Version field prevents lost updates
   - Optimistic locking at database level
   - Client refetches on version mismatch

4. **Rate Limiting**
   - (To be implemented in Slice 6: MVP Hardening)
   - Per-user limits on bookmark creation
   - Global rate limits on all endpoints

## Performance

1. **Autosave Debouncing**
   - 500ms debounce window
   - Reduces server load during drag operations
   - Automatic flush on unmount

2. **TanStack Query Caching**
   - Client-side cache with smart invalidation
   - Background refetching
   - Optimistic updates

3. **Database Indexes**
   - `(canvasId, deletedAt)` for filtering
   - `(canvasId, type)` for bookmark-only queries
   - `(canvasId, zIndex)` for rendering order

## Known Limitations (MVP)

1. **No Unfurling**
   - Only URL is stored and displayed
   - No title, description, or preview image
   - Phase 2 feature

2. **No Rich Text Editing**
   - URLs cannot be edited after creation
   - Must delete and recreate to change URL
   - Phase 2: Allow URL editing

3. **No Link Validation**
   - No check if URL is reachable
   - No 404 detection
   - Phase 2: Optional link checking

4. **No Favicon Caching**
   - No favicon displayed
   - Phase 2: Fetch and cache favicons

## Migration Path to Phase 2

When implementing Phase 2 unfurling:

1. **Schema Migration**
```sql
ALTER TABLE "CanvasItem"
ADD COLUMN "unfurledData" JSONB;

CREATE INDEX "idx_unfurled_at"
ON "CanvasItem" ((content->>'unfurledAt'))
WHERE type = 'BOOKMARK';
```

2. **Backwards Compatibility**
   - Existing bookmarks continue to work
   - Unfurling happens progressively
   - UI shows URL if unfurling pending/failed

3. **Feature Flag**
   - `FEATURE_BOOKMARK_UNFURLING=true` to enable
   - Gradual rollout
   - Easy rollback if issues

## References

- **SENATE.md** - Slice 5 requirements
- **ADR-0001** - API Versioning & Error Contract
- **ADR-0003** - SSRF-Protected Unfurling
- **ADR-0004** - Data Model (CanvasItem)
- **ADR-0009** - Autosave & Concurrency Control

## Conclusion

Slice 5 (Bookmark CRUD) is **COMPLETE** for the MVP. All core functionality works securely and reliably. Bookmark unfurling is intentionally deferred to Phase 2, where proper security infrastructure will be in place.

Users can:
- ✅ Create bookmarks by entering URLs
- ✅ Move bookmarks on their canvas
- ✅ Resize bookmarks to organize their space
- ✅ Delete bookmarks they no longer need
- ✅ Have changes auto-saved with conflict detection

The implementation follows all architectural decisions, security policies, and testing requirements from SENATE.md.
