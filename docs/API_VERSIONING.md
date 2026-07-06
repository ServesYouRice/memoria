# API Versioning Policy

Memoria uses URL-based API versioning for the user-facing API surface.

## Current Version

- API version: `1.0.0`
- URL prefix: `/api/v1`
- Supported versions: `v1`
- Deprecated versions: none

The source of truth for these values is `src/lib/api/versioning.ts`.

## Versioned Routes

Versioned user routes use the `/api/v1/*` prefix:

```http
GET /api/v1/canvases
POST /api/v1/canvas-items
GET /api/v1/templates
```

Agent routes are versioned separately under `/api/agent/v1/*` because they use a
different authentication and policy model.

Operational routes such as `/api/health`, `/api/metrics`, `/api/csp-report`,
and the WebSocket upgrade path `/api/collaboration/:canvasId` are not part of
the `/api/v1` version contract.

## Version Headers

Middleware adds these headers to `/api/v*` responses:

```http
X-API-Version: 1.0.0
X-API-Version-Prefix: v1
X-API-Deprecated: false
```

When a version is deprecated, responses should also include:

```http
X-API-Deprecated: true
X-API-Sunset: 2027-01-01
Link: <https://docs.example.com/migration/v1-to-v2>; rel="deprecation"
```

## Deprecation Policy

1. Announce the new version and publish a migration guide.
2. Mark the old version deprecated for at least six months.
3. Add deprecation and sunset headers during the migration window.
4. Remove the old version only after the sunset date.

## Response Shapes

Success responses are route-specific and usually return the resource or list
shape directly. Examples include:

```json
{
  "canvases": [],
  "pagination": {
    "total": 0,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

Errors use RFC 7807-style problem JSON:

```json
{
  "type": "https://canvascollect.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Canvas not found",
  "instance": "/api/v1/canvases/example"
}
```

The legacy `canvascollect.com` error type namespace is still present in the
error helpers and should be changed in a separate compatibility-aware pass.

## Unsupported Versions

Unsupported versioned paths return `400` with a problem JSON body before route
handling:

```json
{
  "type": "https://canvascollect.com/errors/unsupported-version",
  "title": "Unsupported API Version",
  "status": 400,
  "detail": "API version v2 is not supported. Supported versions: v1"
}
```

## Adding A Version

1. Add the new prefix to `SUPPORTED_VERSIONS`.
2. Keep existing v1 routes during the deprecation window.
3. Add deprecation metadata for any version being sunset.
4. Update API docs and client hooks.
5. Add tests for version headers and unsupported-version behavior.
