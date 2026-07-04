# Memoria API Documentation

> **Version:** 1.0.0
> **Base URL:** `/api/v1`
> **Authentication:** Session-based (NextAuth.js)

## Table of Contents

- [Authentication](#authentication)
- [Health & Monitoring](#health--monitoring)
- [Canvases](#canvases)
- [Canvas Items](#canvas-items)
- [Templates](#templates)
- [Sharing](#sharing)
- [Comments](#comments)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Versioning](#versioning)

---

## Authentication

All API endpoints (except health and auth routes) require authentication via session cookies.

### Register User

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response (201 Created):**
```json
{
  "user": {
    "id": "cuid123",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": null
  }
}
```

**Rate Limit:** 5 requests per 15 minutes

---

### Verify Email

```http
POST /api/v1/auth/verify-email
Content-Type: application/json

{
  "token": "verification_token_here"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

---

### Forgot Password

```http
POST /api/v1/auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password reset email sent"
}
```

**Rate Limit:** 5 requests per 15 minutes

---

### Reset Password

```http
POST /api/v1/auth/reset-password
Content-Type: application/json

{
  "token": "reset_token_here",
  "password": "NewSecurePassword123!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

---

## Health & Monitoring

### Health Check

```http
GET /api/health
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-15T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "pass",
      "responseTime": 12
    },
    "memory": {
      "status": "pass",
      "percentage": 45.2,
      "used": 512000000,
      "total": 1024000000,
      "rss": 123456789,
      "external": 5678
    }
  }
}
```

**Status Codes:**
- `200`: System is healthy
- `503`: System is degraded or unhealthy

**Cache:** No cache (always fresh)

---

### Metrics

```http
GET /api/metrics
```

**Response (200 OK):**
```text
# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 1.23

# HELP nodejs_heap_size_total_bytes Process V8 heap size total in bytes.
# TYPE nodejs_heap_size_total_bytes gauge
nodejs_heap_size_total_bytes 12345678
```

**Content-Type:** `text/plain; version=0.0.4; charset=utf-8`

**Cache:** No cache (always fresh)

---

## Canvases

### List Canvases

Get all canvases for the authenticated user with pagination.

```http
GET /api/v1/canvases?limit=50&offset=0
Authorization: Required
```

**Query Parameters:**
| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | 50 | 100 | Number of canvases to return |
| `offset` | integer | 0 | - | Number of canvases to skip |

**Response (200 OK):**
```json
{
  "canvases": [
    {
      "id": "cuid123",
      "name": "My Canvas",
      "userId": "user_cuid",
      "isTemplate": false,
      "createdAt": "2025-11-15T12:00:00.000Z",
      "updatedAt": "2025-11-15T12:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### Create Canvas

```http
POST /api/v1/canvases
Authorization: Required
Content-Type: application/json

{
  "name": "Untitled Canvas"
}
```

**Request Body:**
| Field | Type | Required | Default | Max Length | Description |
|-------|------|----------|---------|------------|-------------|
| `name` | string | No | "Untitled Canvas" | 200 | Canvas name |

**Response (201 Created):**
```json
{
  "id": "cuid123",
  "name": "Untitled Canvas",
  "userId": "user_cuid",
  "isTemplate": false,
  "createdAt": "2025-11-15T12:00:00.000Z",
  "updatedAt": "2025-11-15T12:00:00.000Z"
}
```

---

### Get Canvas

```http
GET /api/v1/canvases/{canvasId}
Authorization: Required
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `canvasId` | string (CUID) | Canvas ID |

**Response (200 OK):**
```json
{
  "id": "cuid123",
  "name": "My Canvas",
  "userId": "user_cuid",
  "isTemplate": false,
  "items": [
    {
      "id": "item_cuid",
      "type": "NOTE",
      "positionX": 100,
      "positionY": 200,
      "width": 300,
      "height": 200,
      "zIndex": 1,
      "content": {
        "text": "Hello World"
      },
      "version": 1,
      "createdAt": "2025-11-15T12:00:00.000Z",
      "updatedAt": "2025-11-15T12:00:00.000Z"
    }
  ],
  "createdAt": "2025-11-15T12:00:00.000Z",
  "updatedAt": "2025-11-15T12:30:00.000Z"
}
```

---

### Update Canvas

```http
PATCH /api/v1/canvases/{canvasId}
Authorization: Required
Content-Type: application/json

{
  "name": "Updated Canvas Name"
}
```

**Request Body:**
| Field | Type | Required | Max Length | Description |
|-------|------|----------|------------|-------------|
| `name` | string | No | 200 | New canvas name |

**Response (200 OK):**
```json
{
  "id": "cuid123",
  "name": "Updated Canvas Name",
  "updatedAt": "2025-11-15T12:35:00.000Z"
}
```

---

### Delete Canvas

```http
DELETE /api/v1/canvases/{canvasId}
Authorization: Required
```

**Response (204 No Content)**

---

### Make Canvas Public

```http
POST /api/v1/canvases/{canvasId}/public
Authorization: Required
Content-Type: application/json

{
  "isPublic": true
}
```

**Response (200 OK):**
```json
{
  "id": "cuid123",
  "isPublic": true,
  "publicUrl": "https://app.com/public/cuid123"
}
```

---

## Canvas Items

### List Canvas Items (Viewport-Based)

Fetch canvas items within a viewport for efficient rendering of large canvases.

```http
GET /api/v1/canvas-items?canvasId={id}&minX=0&maxX=1000&minY=0&maxY=1000&limit=100&offset=0
Authorization: Required
```

**Query Parameters:**
| Parameter | Type | Required | Default | Max | Description |
|-----------|------|----------|---------|-----|-------------|
| `canvasId` | string (CUID) | Yes | - | - | Canvas ID |
| `type` | enum | No | - | - | Filter by item type (NOTE, BOOKMARK) |
| `minX` | number | No | - | - | Viewport left boundary |
| `maxX` | number | No | - | - | Viewport right boundary |
| `minY` | number | No | - | - | Viewport top boundary |
| `maxY` | number | No | - | - | Viewport bottom boundary |
| `limit` | integer | No | 100 | 1000 | Number of items to return |
| `offset` | integer | No | 0 | - | Number of items to skip |
| `includeDeleted` | boolean | No | false | - | Include soft-deleted items |

**Viewport Filtering:**
Items are returned if they intersect with the viewport bounds:
```
(item.positionX + item.width) >= minX  AND
item.positionX <= maxX                 AND
(item.positionY + item.height) >= minY AND
item.positionY <= maxY
```

**Response (200 OK):**
```json
{
  "items": [
    {
      "id": "item_cuid",
      "type": "NOTE",
      "positionX": 100,
      "positionY": 200,
      "width": 300,
      "height": 200,
      "zIndex": 1,
      "content": {
        "text": "Hello World"
      },
      "tags": ["important", "todo"],
      "version": 1,
      "createdAt": "2025-11-15T12:00:00.000Z",
      "updatedAt": "2025-11-15T12:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 500,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### Create Canvas Item

```http
POST /api/v1/canvas-items
Authorization: Required
Content-Type: application/json

{
  "canvasId": "canvas_cuid",
  "type": "NOTE",
  "positionX": 100,
  "positionY": 200,
  "width": 300,
  "height": 200,
  "zIndex": 1,
  "content": {
    "text": "Hello World"
  },
  "tags": ["important"]
}
```

**Request Body:**
| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `canvasId` | string (CUID) | Yes | - | Canvas ID |
| `type` | enum | Yes | NOTE, BOOKMARK | Item type |
| `positionX` | number | Yes | finite | X position on canvas |
| `positionY` | number | Yes | finite | Y position on canvas |
| `width` | number | Yes | > 0, finite | Item width |
| `height` | number | Yes | > 0, finite | Item height |
| `zIndex` | integer | No | 0-999999 | Stacking order (default: 0) |
| `content` | object | Yes | - | Type-specific content |
| `tags` | array[string] | No | max 20, each max 50 chars | Item tags |

**Content Schemas:**

**NOTE:**
```json
{
  "text": "Note content (max 10,000 characters)"
}
```

**BOOKMARK:**
```json
{
  "url": "https://example.com (max 2,048 characters, http/https only)"
}
```

**Response (201 Created):**
```json
{
  "id": "item_cuid",
  "canvasId": "canvas_cuid",
  "type": "NOTE",
  "positionX": 100,
  "positionY": 200,
  "width": 300,
  "height": 200,
  "zIndex": 1,
  "content": {
    "text": "Hello World"
  },
  "tags": ["important"],
  "version": 1,
  "createdAt": "2025-11-15T12:00:00.000Z",
  "updatedAt": "2025-11-15T12:00:00.000Z"
}
```

---

### Update Canvas Item

Uses **optimistic concurrency control** with version numbers to prevent conflicts.

```http
PATCH /api/v1/canvas-items/{itemId}
Authorization: Required
Content-Type: application/json

{
  "version": 1,
  "positionX": 150,
  "positionY": 250,
  "content": {
    "text": "Updated content"
  }
}
```

**Request Body:**
| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `version` | integer | Yes | > 0 | Current version (for optimistic locking) |
| `positionX` | number | No | finite | New X position |
| `positionY` | number | No | finite | New Y position |
| `width` | number | No | > 0, finite | New width |
| `height` | number | No | > 0, finite | New height |
| `zIndex` | integer | No | 0-999999 | New stacking order |
| `content` | object | No | - | Updated content |
| `tags` | array[string] | No | max 20, each max 50 chars | Updated tags |

**Response (200 OK):**
```json
{
  "id": "item_cuid",
  "positionX": 150,
  "positionY": 250,
  "content": {
    "text": "Updated content"
  },
  "version": 2,
  "updatedAt": "2025-11-15T12:35:00.000Z"
}
```

**Version Conflict (409 Conflict):**
```json
{
  "type": "https://canvascollect.com/errors/version-conflict",
  "title": "Version Conflict",
  "status": 409,
  "detail": "Item was modified by another request. Current version: 3"
}
```

---

### Delete Canvas Item

Soft delete with optimistic locking.

```http
DELETE /api/v1/canvas-items/{itemId}
Authorization: Required
Content-Type: application/json

{
  "version": 2
}
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | integer | Yes | Current version (for optimistic locking) |

**Response (204 No Content)**

---

## Templates

### List Templates

```http
GET /api/v1/templates?category=all&limit=50&offset=0
```

**Query Parameters:**
| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `category` | string | all | - | Filter by category |
| `userId` | string | - | - | Filter by creator |
| `limit` | integer | 50 | 100 | Number of templates to return |
| `offset` | integer | 0 | - | Number of templates to skip |

**Response (200 OK):**
```json
{
  "templates": [
    {
      "id": "template_cuid",
      "name": "Project Planning Template",
      "isTemplate": true,
      "templateCategory": "Business",
      "templateDescription": "A template for project planning",
      "usageCount": 42,
      "items": [...],
      "user": {
        "id": "user_cuid",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "createdAt": "2025-11-15T12:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 25,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### Save Canvas as Template

```http
POST /api/v1/templates
Authorization: Required
Content-Type: application/json

{
  "canvasId": "canvas_cuid",
  "description": "A template for project planning",
  "category": "Business"
}
```

**Request Body:**
| Field | Type | Required | Max Length | Default | Description |
|-------|------|----------|------------|---------|-------------|
| `canvasId` | string (CUID) | Yes | - | - | Canvas to convert to template |
| `description` | string | No | 500 | - | Template description |
| `category` | string | No | 50 | "General" | Template category |

**Response (200 OK):**
```json
{
  "id": "template_cuid",
  "name": "My Canvas",
  "isTemplate": true,
  "templateCategory": "Business",
  "templateDescription": "A template for project planning",
  "items": [...],
  "user": {...}
}
```

---

### Get Template

```http
GET /api/v1/templates/{templateId}
```

**Response (200 OK):**
```json
{
  "id": "template_cuid",
  "name": "Project Planning Template",
  "isTemplate": true,
  "templateCategory": "Business",
  "templateDescription": "A template for project planning",
  "usageCount": 42,
  "items": [...],
  "user": {...}
}
```

---

### Use Template

Create a new canvas from a template.

```http
POST /api/v1/templates/{templateId}/use
Authorization: Required
Content-Type: application/json

{
  "name": "My New Project"
}
```

**Request Body:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | No | Template name + " (Copy)" | Name for the new canvas |

**Response (201 Created):**
```json
{
  "id": "new_canvas_cuid",
  "name": "My New Project",
  "userId": "user_cuid",
  "isTemplate": false,
  "items": [...],
  "createdAt": "2025-11-15T12:00:00.000Z"
}
```

---

## Sharing

### Create Share Link

```http
POST /api/v1/canvases/{canvasId}/share
Authorization: Required
Content-Type: application/json

{
  "permission": "view",
  "expiresAt": "2025-12-15T12:00:00.000Z"
}
```

**Request Body:**
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `permission` | enum | No | "view" | Access level (view, edit) |
| `expiresAt` | ISO 8601 date | No | null | Expiration date (null = never) |

**Response (201 Created):**
```json
{
  "id": "share_cuid",
  "token": "secure_random_token",
  "canvasId": "canvas_cuid",
  "permission": "view",
  "expiresAt": "2025-12-15T12:00:00.000Z",
  "url": "https://app.com/share/secure_random_token",
  "createdAt": "2025-11-15T12:00:00.000Z"
}
```

---

### Get Share Links

```http
GET /api/v1/canvases/{canvasId}/share
Authorization: Required
```

**Response (200 OK):**
```json
{
  "shares": [
    {
      "id": "share_cuid",
      "token": "secure_random_token",
      "permission": "view",
      "expiresAt": "2025-12-15T12:00:00.000Z",
      "createdAt": "2025-11-15T12:00:00.000Z"
    }
  ]
}
```

---

### Access Shared Canvas

```http
GET /api/v1/share/{token}
```

**Response (200 OK):**
```json
{
  "canvas": {
    "id": "canvas_cuid",
    "name": "Shared Canvas",
    "items": [...]
  },
  "permission": "view"
}
```

**Errors:**
- `404`: Share link not found or expired
- `403`: Share link revoked

---

### Delete Share Link

```http
DELETE /api/v1/canvases/{canvasId}/share/{shareId}
Authorization: Required
```

**Response (204 No Content)**

---

## Comments

### List Comments

```http
GET /api/v1/items/{itemId}/comments
Authorization: Required
```

**Response (200 OK):**
```json
{
  "comments": [
    {
      "id": "comment_cuid",
      "itemId": "item_cuid",
      "userId": "user_cuid",
      "content": "Great work!",
      "createdAt": "2025-11-15T12:00:00.000Z",
      "updatedAt": "2025-11-15T12:00:00.000Z",
      "user": {
        "id": "user_cuid",
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  ]
}
```

---

### Create Comment

```http
POST /api/v1/items/{itemId}/comments
Authorization: Required
Content-Type: application/json

{
  "content": "Great work!"
}
```

**Request Body:**
| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `content` | string | Yes | 1-5000 chars | Comment text |

**Response (201 Created):**
```json
{
  "id": "comment_cuid",
  "itemId": "item_cuid",
  "userId": "user_cuid",
  "content": "Great work!",
  "createdAt": "2025-11-15T12:00:00.000Z",
  "updatedAt": "2025-11-15T12:00:00.000Z"
}
```

---

### Update Comment

```http
PATCH /api/v1/items/{itemId}/comments/{commentId}
Authorization: Required
Content-Type: application/json

{
  "content": "Updated comment"
}
```

**Response (200 OK):**
```json
{
  "id": "comment_cuid",
  "content": "Updated comment",
  "updatedAt": "2025-11-15T12:35:00.000Z"
}
```

---

### Delete Comment

```http
DELETE /api/v1/items/{itemId}/comments/{commentId}
Authorization: Required
```

**Response (204 No Content)**

---

## Error Handling

All errors follow **RFC 7807 Problem Details** format:

```json
{
  "type": "https://canvascollect.com/errors/validation-error",
  "title": "Validation Error",
  "status": 400,
  "detail": "Invalid request data",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### Common Error Types

| Status | Type | Description |
|--------|------|-------------|
| 400 | `validation-error` | Invalid request data |
| 401 | `unauthorized` | Authentication required |
| 403 | `forbidden` | Access denied |
| 404 | `not-found` | Resource not found |
| 409 | `version-conflict` | Optimistic locking conflict |
| 429 | `rate-limit-exceeded` | Too many requests |
| 500 | `internal-error` | Server error |

### Rate Limit Error

```json
{
  "error": "Too many requests",
  "retryAfter": 120
}
```

**Response Headers:**
- `Retry-After`: Seconds until rate limit resets

---

## Rate Limiting

API endpoints are rate-limited to prevent abuse:

| Route Type | Limit | Window |
|------------|-------|--------|
| Auth routes | 5 requests | 15 minutes |
| General API | 100 requests | 15 minutes |

**Identifier:** Client IP address (`x-forwarded-for` or `x-real-ip`)

**Note:** For production deployments, use Redis-based rate limiting. See `src/middleware/rate-limit.ts` for implementation guide.

---

## Versioning

### API Versioning Strategy

- **Current Version:** `v1`
- **Format:** Semantic versioning (MAJOR.MINOR.PATCH)
- **URL Pattern:** `/api/v{MAJOR}/...`

### Version Headers

All API responses include version information:

```http
X-API-Version: 1.0.0
X-API-Version-Prefix: v1
X-API-Deprecated: false
```

### Deprecated Versions

When a version is deprecated, responses include:

```http
X-API-Deprecated: true
X-API-Sunset: 2026-01-01T00:00:00Z
Link: <https://docs.canvascollect.com/migration>; rel="deprecation"
```

### Version Support Policy

- **Stable versions:** Supported indefinitely
- **Deprecated versions:** 6 months notice before removal
- **Breaking changes:** Require new major version

---

## Request & Response Headers

### Common Request Headers

```http
Authorization: Bearer {session-token}
Content-Type: application/json
Accept: application/json
```

### Common Response Headers

```http
Content-Type: application/json
X-API-Version: 1.0.0
X-Request-ID: abc123def456
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1700000000
Cache-Control: no-cache (health endpoint only)
```

---

## Best Practices

### 1. Optimistic Concurrency Control

Always include `version` in update/delete requests to prevent conflicts:

```javascript
// Fetch current item
const item = await fetch(`/api/v1/canvas-items/${itemId}`);
const { version } = await item.json();

// Update with version
await fetch(`/api/v1/canvas-items/${itemId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version,
    positionX: 200
  })
});
```

### 2. Viewport-Based Pagination

For large canvases (1000+ items), use viewport filtering:

```javascript
// Only fetch items visible in viewport
const response = await fetch(
  `/api/v1/canvas-items?canvasId=${id}&minX=0&maxX=1920&minY=0&maxY=1080&limit=500`
);
```

### 3. Error Handling

```javascript
try {
  const response = await fetch('/api/v1/canvases', { method: 'POST', ... });

  if (!response.ok) {
    const error = await response.json();

    if (error.type === 'validation-error') {
      // Handle validation errors
      error.errors.forEach(err => {
        console.error(`${err.field}: ${err.message}`);
      });
    } else if (error.status === 409) {
      // Handle version conflict
      console.error('Item was modified, please refresh');
    }
  }
} catch (err) {
  console.error('Network error:', err);
}
```

### 4. Rate Limiting

Respect rate limits and implement exponential backoff:

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, options);

    if (response.status !== 429) {
      return response;
    }

    const retryAfter = parseInt(response.headers.get('Retry-After') || '1');
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
  }

  throw new Error('Max retries exceeded');
}
```

---

## Examples

### Complete CRUD Flow

```javascript
// 1. Create canvas
const canvas = await fetch('/api/v1/canvases', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'My Canvas' })
}).then(r => r.json());

// 2. Add items
const note = await fetch('/api/v1/canvas-items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    canvasId: canvas.id,
    type: 'NOTE',
    positionX: 100,
    positionY: 100,
    width: 300,
    height: 200,
    content: { text: 'Hello World' }
  })
}).then(r => r.json());

// 3. Update item
await fetch(`/api/v1/canvas-items/${note.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version: note.version,
    content: { text: 'Updated text' }
  })
});

// 4. Delete item
await fetch(`/api/v1/canvas-items/${note.id}`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ version: note.version + 1 })
});

// 5. Delete canvas
await fetch(`/api/v1/canvases/${canvas.id}`, {
  method: 'DELETE'
});
```

---

## Security Considerations

1. **Authentication:** All routes except health and auth require valid session
2. **Authorization:** Users can only access their own resources
3. **Input Validation:** All inputs are validated and sanitized
4. **Rate Limiting:** Prevents brute force and abuse
5. **CORS:** Configured per environment
6. **CSP:** Content Security Policy headers enabled
7. **HTTPS:** Required in production

---

## Support & Resources

- **Documentation:** https://docs.canvascollect.com
- **Issue Tracker:** https://github.com/canvascollect/app/issues
- **API Status:** https://status.canvascollect.com
- **Support:** support@canvascollect.com

---

**Last Updated:** 2025-11-15
**API Version:** 1.0.0
