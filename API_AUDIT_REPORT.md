# API AUDIT REPORT: /src/app/api/v1

**Audit Date**: 2024-11-17
**Total Endpoints**: 27+ routes across 10 resource types
**Overall Status**: Multiple critical issues found

---

## EXECUTIVE SUMMARY

The API has good foundational patterns (RFC 7807 error handling, Zod validation, rate limiting) but suffers from:
- **4 critical missing CRUD endpoints**
- **Inconsistent error handling approaches** (3 different patterns in use)
- **Missing rate limiting** on upload/unfurl endpoints (potential DOS vectors)
- **Incomplete pagination** (missing on 4 list endpoints)
- **Inconsistent HTTP status codes** and response formats
- **Mixed authentication patterns** (auth(), requireAuth(), getServerSession())
- **Database design gaps** (no hard delete for Canvas)

---

## CRITICAL ISSUES

### 1. MISSING CRUD ENDPOINTS

#### GET /api/v1/canvases/[canvasId] - **MISSING**
- **Impact**: Cannot fetch individual canvas details
- **Schema**: Canvas table exists, supports findUnique
- **Workaround**: Users must fetch all canvases and filter client-side
- **Should return**: Canvas with items, shares, metadata
- **Auth**: requireAuth + requireCanvasOwnership

#### DELETE /api/v1/canvases/[canvasId] - **MISSING**
- **Impact**: Cannot delete individual canvases
- **Schema**: No soft delete field on Canvas table
- **Problem**: Only way to manage canvas is PATCH (update)
- **Should implement**: 
  - Add deletedAt field to Canvas schema OR
  - Add hard delete with cascade
- **Auth**: requireAuth + requireCanvasOwnership

#### GET /api/v1/canvas-items/[itemId]/comments/[commentId] - **MISSING**
- **Impact**: Cannot fetch individual comment details
- **Current**: Only list all comments for item
- **Should return**: Individual comment object
- **Auth**: Public if canvas is public, shared users, or owner

#### PUT /api/v1/templates/[templateId] - **MISSING**
- **Impact**: Cannot update template metadata (description, category)
- **Current**: Can only delete template status
- **Should allow**: Update templateDescription, templateCategory
- **Auth**: requireAuth + template owner check

---

### 2. ERROR HANDLING INCONSISTENCIES

Three different error handling patterns in use:

#### Pattern A: RFC 7807 via errorResponse()
```typescript
// CORRECT - canvases/route.ts, canvas-items/route.ts
return errorResponse(error, request.url);
```

#### Pattern B: Direct error throwing + implicit catch
```typescript
// INCONSISTENT - comments route, templates route
throw new UnauthorizedError('...');
// No explicit try-catch or error handler
```

#### Pattern C: Manual NextResponse
```typescript
// INCONSISTENT - upload/route.ts, unfurl/route.ts
return NextResponse.json({ error: 'message' }, { status: 400 });
```

**Impact**: Responses not compliant with RFC 7807 standard
**Files affected**:
- `/api/v1/upload/route.ts` - Lines 76, 82, 90, 98, 128
- `/api/v1/unfurl/route.ts` - Lines 21, 29, 47, 54, 75
- `/api/v1/items/[itemId]/comments/route.ts` - Lines 31-42
- `/api/v1/templates/route.ts` - Lines 29-37

**Solution**: Use `errorResponse(error, request.url)` consistently

---

### 3. MISSING RATE LIMITING

#### POST /api/v1/upload - **NOT RATE LIMITED**
- **Risk**: DOS attack via large file uploads
- **Current**: Only file size validation (5MB)
- **Should add**: Rate limit 10-50 requests/hour per user
- **Recommendation**: `withRateLimit(RATE_LIMITS.upload, handler)`

#### POST /api/v1/unfurl - **NOT RATE LIMITED**
- **Risk**: DOS attack via external URL fetches (2MB downloads)
- **Current**: No rate limiting
- **Timeout**: 10 seconds, could hang
- **Should add**: Rate limit 5-20 requests/hour per user
- **Recommendation**: `withRateLimit(RATE_LIMITS.unfurl, handler)`

#### POST /api/v1/auth/register - **PARTIALLY LIMITED**
- **Current**: Only middleware rate limiting (authRateLimit)
- **Gap**: No per-email account creation limits
- **Should add**: Limit 3-5 accounts per email per day

---

### 4. AUTHENTICATION PATTERN INCONSISTENCY

Three authentication patterns in API code:

```typescript
// Pattern 1: auth() from @/lib/auth
const session = await auth();

// Pattern 2: getServerSession + authOptions
const session = await getServerSession(authOptions);

// Pattern 3: requireAuth() helper
const { userId, email } = await requireAuth();
```

**Impact**: Maintainability issue, potential security gaps
**Affected files**: 10+ routes
**Recommendation**: Standardize on `requireAuth()` which also validates

---

## MAJOR ISSUES

### 5. INCONSISTENT STATUS CODES

| Endpoint | Operation | Status | Issue |
|----------|-----------|--------|-------|
| DELETE /canvas-items/[id] | Soft delete | 200 | Should be 204 |
| DELETE /items/.../comments/[id] | Soft delete | 200 | Should be 204 |
| POST /templates | Save as template | 200 | Should be 201 |
| DELETE /templates/[id] | Remove template | 200 | ✓ Correct |
| POST /canvases/[id]/public | Make public | 200 | Should be 201 |
| DELETE /canvases/[id]/public | Make private | 200 | ✓ Correct |

**Standard HTTP codes**:
- 200: Successful read or idempotent write
- 201: Resource created
- 204: Successful deletion (no content)
- 400: Bad request
- 401: Unauthorized
- 403: Forbidden  
- 404: Not found
- 409: Conflict (version mismatch)
- 429: Rate limited
- 500: Server error

---

### 6. MISSING PAGINATION

| Endpoint | Records | Limit | Issue |
|----------|---------|-------|-------|
| GET /items/[itemId]/comments | ∞ | None | Missing limit/offset |
| GET /canvases/[id]/share | ∞ | None | Missing limit/offset |
| GET /canvases/[id]/versions | ∞ | None | Missing limit/offset |
| GET /activities | Limited | limit only | Missing offset param |
| GET /search | 50 | Hardcoded | Should be query param |

**Impact**: Large datasets not handled gracefully

---

### 7. INCONSISTENT RESPONSE FORMATS

```typescript
// Format A: Wrapped in resource key
return NextResponse.json({ canvases: [], pagination: {} });

// Format B: Direct array/object
return NextResponse.json({ items: [], total: 0 });

// Format C: Direct with total
return NextResponse.json({ comments: [] }); // No pagination info

// Format D: With success flag
return NextResponse.json({ success: true, message: '...' });
```

**Recommendation**: Standard format:
```json
{
  "data": [...],
  "pagination": {
    "total": 0,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### 8. CORS CONFIGURATION

**Status**: ✓ Implemented
- **File**: `/middleware.ts` + `/middleware/cors.ts`
- **Preflight**: Handles OPTIONS requests
- **Headers**: Properly set on all responses
- **Issue**: None identified

---

### 9. VALIDATION SCHEMA GAPS

#### Missing request body validation:
- DELETE /canvas-items/[id]/comments/[id] - No request validation (uses _ prefix)
- GET /search - Query params not in schema, hardcoded limits
- POST /unfurl - No URL format validation (only type check)

#### Type safety issues:
- `/templates/route.ts:103` - `where: any` instead of proper type
- `/upload/route.ts` - File validation logic could be in schema
- `/search/route.ts` - SearchResult interface not exported

---

### 10. CONCURRENCY & OPTIMISTIC LOCKING

**Good**: Canvas items use version-based optimistic locking
```typescript
// PATCH /canvas-items/[itemId] - Correct pattern
if (currentItem.version !== data.version) {
  throw new VersionMismatchError(data.version, currentItem.version);
}
```

**Bad**: Other resources don't have version control
- Canvas updates (name, zoom, pan) - No version check
- Template metadata updates - N/A (missing endpoint)
- Comments - No version field in schema

**Recommendation**: Add version field to Canvas and Comment

---

## MINOR ISSUES

### 11. RESPONSE FORMAT INCONSISTENCIES (continued)

| Endpoint | Response | Issue |
|----------|----------|-------|
| DELETE share | `{success: true, message: '...'}` | Extra message field |
| DELETE comment | `{success: true}` | Missing HTTP 204 |
| Canvas public POST | Returns metadata | Good! Include in share |

### 12. FILE UPLOAD VALIDATION

**Good**:
- File type validation (MIME type)
- File size limit (5MB)
- Sanitized filenames
- Random suffix to prevent collisions

**Issues**:
- No rate limiting (can upload 100 files instantly)
- No virus/malware scanning
- Public accessible uploads (potential SSRF through img tag)
- No quota per user

### 13. URL UNFURLING SECURITY

**Good**:
- SSRF protection via safeFetch
- Response size limit (2MB)
- Timeout (10 seconds)
- Caching to prevent repeated fetches
- Metadata validation

**Issues**:
- No rate limiting (DOS vector)
- Could hang on streaming responses
- No user quota
- Cache expiry not visible

### 14. DATABASE SCHEMA ISSUES

**Missing fields**:
- Canvas: No deletedAt field (can't soft delete)
- Canvas: No version field (no optimistic locking)
- Template: No public flag (can't make templates private)

**Index gaps**:
- CanvasShare missing index on [email, createdAt] (for shared canvases listing)
- Activity missing indexes for efficient filtering

---

## RECOMMENDATIONS SUMMARY

### CRITICAL (Fix immediately):

1. **Add missing GET /api/v1/canvases/[canvasId]**
   - Required for basic CRUD
   - Files: Create new route file

2. **Add missing DELETE /api/v1/canvases/[canvasId]**
   - Required for basic CRUD
   - Migration: Add deletedAt to Canvas schema

3. **Standardize error handling**
   - Use errorResponse() everywhere
   - Fix: upload, unfurl, all auth endpoints

4. **Add rate limiting to upload & unfurl**
   - Prevent DOS attacks
   - Use: withRateLimit middleware

5. **Fix HTTP status codes**
   - Delete operations should return 204
   - Create operations should return 201

### HIGH (Fix in next sprint):

6. **Add pagination to missing endpoints**
   - Comments, Shares, Versions, Activities
   - Standard format: limit, offset, total, hasMore

7. **Standardize authentication pattern**
   - Use requireAuth() everywhere
   - Migrate from auth() and getServerSession()

8. **Add missing comment GET endpoint**
   - GET /api/v1/items/[itemId]/comments/[commentId]

9. **Add missing template PUT endpoint**
   - PUT /api/v1/templates/[templateId]
   - Allow updating description, category

10. **Standardize response format**
    - Consistent pagination structure
    - Remove "success" flags where not needed

### MEDIUM (Fix in future):

11. **Add optimistic locking to Canvas & Comment**
    - Add version field to schema
    - Prevent concurrent modification issues

12. **Add user quotas**
    - File uploads: GB per month
    - URL unfurls: Per day
    - API requests: Rate limit tiers

13. **Export validation schemas**
    - For OpenAPI documentation
    - For client-side validation

14. **Add API documentation**
    - OpenAPI/Swagger spec
    - Markdown docs for each endpoint

---

## ENDPOINT COMPLIANCE MATRIX

```
Legend: ✓ = Implemented, ✗ = Missing, ⚠ = Issue

Endpoint                                | Auth | Validation | RateLimit | Pagination | RFC7807 | Status
---------------------------------------|------|-----------|-----------|-----------|---------|--------
POST /auth/register                     | ✓    | ✓         | ✓         | N/A       | ✓       | ✓
POST /auth/verify-email                 | ✓    | ✓         | ✓         | N/A       | ⚠       | ✓
POST /auth/forgot-password              | ✗    | ✓         | ✓         | N/A       | ✓       | ✓
POST /auth/reset-password               | ✓    | ✓         | ✓         | N/A       | ⚠       | ✓
POST /auth/send-verification            | ✓    | ✗         | ✓         | N/A       | ⚠       | ✓
GET /canvases                           | ✓    | ✓         | ✓         | ✓         | ✓       | ✓
POST /canvases                          | ✓    | ✓         | ✓         | N/A       | ⚠       | ✓
GET /canvases/[id]                      | ✓    | ✓         | ✓         | N/A       | ✓       | ✗ MISSING
PATCH /canvases/[id]                    | ✓    | ✓         | ✓         | N/A       | ✓       | ✓
DELETE /canvases/[id]                   | ✓    | ✓         | ✓         | N/A       | ✓       | ✗ MISSING
GET /canvases/[id]/share                | ✓    | N/A       | ✓         | ✗         | ✓       | ✓
POST /canvases/[id]/share               | ✓    | ✓         | ✓         | N/A       | ✓       | ✓
DELETE /canvases/[id]/share/[shareId]   | ✓    | N/A       | ✓         | N/A       | ✓       | ✓
GET /canvases/[id]/versions             | ✓    | N/A       | ✓         | ✗         | ✓       | ✓
POST /canvases/[id]/versions            | ✓    | ✓         | ✓         | N/A       | ✓       | ✓
POST /canvases/[id]/versions/[v]/restore| ✓    | N/A       | ✓         | N/A       | ✓       | ✓
POST /canvases/[id]/duplicate           | ✓    | N/A       | ✓         | N/A       | ✓       | ✓
POST /canvases/[id]/public              | ✓    | N/A       | ✓         | N/A       | ✓       | ✓
DELETE /canvases/[id]/public            | ✓    | N/A       | ✓         | N/A       | ✓       | ✓
POST /canvases/[id]/thumbnail           | ✓    | ⚠         | ✓         | N/A       | ⚠       | ✓
DELETE /canvases/[id]/thumbnail         | ✓    | N/A       | ✓         | N/A       | ⚠       | ✓
GET /canvas-items                       | ✓    | ✓         | ✓         | ✓         | ✓       | ✓
POST /canvas-items                      | ✓    | ✓         | ✓         | N/A       | ✓       | ✓
GET /canvas-items/[id]                  | ✓    | N/A       | ✓         | N/A       | ✓       | ✓
PATCH /canvas-items/[id]                | ✓    | ✓         | ✓         | N/A       | ✓       | ✓
DELETE /canvas-items/[id]               | ✓    | ✓         | ✓         | N/A       | ✓       | ⚠
GET /items/[id]/comments                | ✓    | N/A       | ✓         | ✗         | ✓       | ✓
POST /items/[id]/comments               | ✓    | ✓         | ✓         | N/A       | ✓       | ✓
GET /items/[id]/comments/[cid]          | ✓    | N/A       | ✓         | N/A       | ✓       | ✗ MISSING
PATCH /items/[id]/comments/[cid]        | ✓    | ✓         | ✓         | N/A       | ✓       | ✓
DELETE /items/[id]/comments/[cid]       | ✓    | N/A       | ✓         | N/A       | ✓       | ⚠
GET /templates                          | ✗    | N/A       | ✓         | ✓         | ✓       | ✓
POST /templates                         | ✓    | ✓         | ✓         | N/A       | ✓       | ⚠
GET /templates/[id]                     | ✗    | N/A       | ✓         | N/A       | ✓       | ✓
PUT /templates/[id]                     | ✓    | ✓         | ✓         | N/A       | ✓       | ✗ MISSING
DELETE /templates/[id]                  | ✓    | N/A       | ✓         | N/A       | ✓       | ✓
POST /templates/[id]/use                | ✓    | N/A       | ✓         | N/A       | ✓       | ✓
GET /search                             | ✓    | ⚠         | ✗         | ⚠         | ✓       | ✓
GET /activities                         | ✓    | N/A       | ✓         | ⚠         | ✓       | ✓
GET /shared-canvases                    | ✓    | N/A       | ✓         | ✗         | ✓       | ✓
GET /share/[token]                      | ✗    | N/A       | ✗         | N/A       | ✓       | ✓
POST /upload                            | ✓    | ✓         | ✗ MISSING | N/A       | ✗ MISSING| ✓
POST /unfurl                            | ✓    | ⚠         | ✗ MISSING | N/A       | ✗ MISSING| ✓
```

---

## CONCLUSION

The API has a **solid architectural foundation** with:
- ✓ RFC 7807 error standard (mostly implemented)
- ✓ Zod validation on inputs
- ✓ Rate limiting middleware
- ✓ CORS support
- ✓ Optimistic locking for concurrent edits
- ✓ SSRF protection for URL unfurling

**However, 4 critical CRUD endpoints are missing and error handling is inconsistent across 3 different patterns.**

**Estimated effort to fix all issues: 2-3 weeks**
- Critical fixes: 3-5 days
- Major consistency fixes: 5-7 days  
- Medium improvements: 5-10 days

