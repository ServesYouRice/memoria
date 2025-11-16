# API Versioning Policy

**FIXED: Issue #23 - API Versioning Strategy**

This document outlines the versioning strategy for the CanvasCollect API.

## Current Version

**API Version:** v1 (1.0.0)
**Status:** Stable
**Released:** 2025-11-15

## Versioning Scheme

We use **semantic versioning** (semver) for our API:

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: Breaking changes that require client updates
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes, backwards compatible

### URL-based Versioning

API endpoints are versioned using URL prefixes:

```
/api/v1/canvases
/api/v1/items
/api/v1/auth/login
```

## Version Headers

All API responses include version information in headers:

```http
X-API-Version: 1.0.0
X-API-Version-Prefix: v1
X-API-Deprecated: false
```

When a version is deprecated:

```http
X-API-Version: 1.0.0
X-API-Version-Prefix: v1
X-API-Deprecated: true
X-API-Sunset: 2026-12-31
Link: <https://docs.canvascollect.com/migration/v1-to-v2>; rel="deprecation"
```

## Deprecation Policy

### Timeline

1. **Announcement** (T+0):
   - New version released
   - Old version marked as deprecated
   - Migration guide published

2. **Deprecation Period** (T+6 months):
   - Both versions supported
   - Deprecation headers added
   - Warning notices in responses

3. **Sunset** (T+12 months):
   - Old version removed
   - 410 Gone responses for old version

### Example Timeline

| Date       | v1 Status    | v2 Status    |
|------------|--------------|--------------|
| 2025-01-01 | Stable       | -            |
| 2026-01-01 | Deprecated   | Stable       |
| 2026-07-01 | Sunset Soon  | Stable       |
| 2027-01-01 | Removed      | Stable       |

## Breaking Changes

A breaking change is any modification that requires clients to update their code. Examples:

### What is Breaking

- Removing an endpoint
- Removing a field from response
- Changing response structure
- Changing field types
- Making required fields
- Changing error codes
- Changing authentication requirements

### What is NOT Breaking

- Adding new endpoints
- Adding optional fields
- Adding new error codes (while keeping existing ones)
- Bug fixes that don't change behavior
- Performance improvements
- Internal refactoring

## Migration Process

### For Developers

When migrating to a new API version:

1. **Review Migration Guide**: Read the specific migration guide for the new version
2. **Test in Development**: Update your code and test thoroughly
3. **Monitor Deprecation Headers**: Check for deprecation warnings
4. **Update Before Sunset**: Ensure migration before the sunset date

### For API Maintainers

When releasing a new API version:

1. **Create Migration Guide**: Document all breaking changes
2. **Update Configuration**: Add new version to `src/lib/api/versioning.ts`
3. **Support Both Versions**: Maintain both old and new during deprecation period
4. **Monitor Usage**: Track usage of deprecated version
5. **Communicate**: Notify users via email, changelog, and headers

## Configuration

### Adding a New Version

Update `src/lib/api/versioning.ts`:

```typescript
// Add to supported versions
export const SUPPORTED_VERSIONS = ['v1', 'v2'];

// Mark old version as deprecated
export const DEPRECATED_VERSIONS = [
  {
    version: 'v1',
    sunsetDate: '2027-01-01',
    migrationGuide: 'https://docs.canvascollect.com/migration/v1-to-v2',
  },
];
```

### Removing an Old Version

1. **Verify Sunset Date**: Ensure deprecation period has passed
2. **Remove from Supported Versions**:
   ```typescript
   export const SUPPORTED_VERSIONS = ['v2']; // Remove v1
   ```
3. **Keep in Deprecated**: Keep for historical reference
4. **Test**: Verify old version returns 400 error
5. **Monitor**: Watch for error logs

## Response Format

### Success Response

All API responses follow consistent format:

```json
{
  "data": {
    "id": "clxxx",
    "name": "My Canvas",
    ...
  },
  "meta": {
    "version": "1.0.0",
    "timestamp": "2025-11-15T10:00:00Z"
  }
}
```

### Error Response

Errors follow [RFC 7807 Problem Details](https://tools.ietf.org/html/rfc7807):

```json
{
  "type": "https://canvascollect.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Canvas with id 'clxxx' not found",
  "instance": "/api/v1/canvases/clxxx"
}
```

### Unsupported Version

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://canvascollect.com/errors/unsupported-version",
  "title": "Unsupported API Version",
  "status": 400,
  "detail": "API version v3 is not supported. Supported versions: v1, v2"
}
```

## Client Implementation

### Checking Version Support

```typescript
// Check version headers in response
const response = await fetch('/api/v1/canvases');
const apiVersion = response.headers.get('X-API-Version');
const deprecated = response.headers.get('X-API-Deprecated') === 'true';
const sunsetDate = response.headers.get('X-API-Sunset');

if (deprecated) {
  console.warn(`API v1 is deprecated and will be removed on ${sunsetDate}`);
  // Show warning to user or log to monitoring service
}
```

### Graceful Degradation

```typescript
async function fetchCanvases() {
  try {
    // Try latest version
    return await fetch('/api/v2/canvases');
  } catch (error) {
    if (error.status === 400) {
      // Fallback to v1 if v2 not supported yet
      return await fetch('/api/v1/canvases');
    }
    throw error;
  }
}
```

## Changelog

### v1.0.0 (2025-11-15)

**Initial stable release**

- Canvas management endpoints
- Item CRUD operations
- Authentication and authorization
- Sharing and collaboration
- Template system
- Comment system

## References

- [Semantic Versioning](https://semver.org/)
- [API Versioning Best Practices](https://restfulapi.net/versioning/)
- [RFC 7807: Problem Details for HTTP APIs](https://tools.ietf.org/html/rfc7807)
- [Google API Design Guide](https://cloud.google.com/apis/design/versioning)
- [Stripe API Versioning](https://stripe.com/docs/api/versioning)

## Future Plans

### v2 (Planned)

Potential breaking changes being considered:

- Pagination format standardization
- Response envelope changes
- WebSocket support for real-time updates
- GraphQL endpoint
- Batch operations API

No timeline set yet. Will announce at least 6 months before v2 release.
