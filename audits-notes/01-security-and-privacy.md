# Security and privacy audit

## Critical findings

### SEC-01 — Cross-tenant item overwrite/delete through Yjs

**Severity:** Critical  
**Confidence:** Confirmed by data-flow inspection

`persistDocument(canvasId)` trusts item IDs supplied by an editable Yjs document, but its existence lookup and subsequent mutations are not scoped to that document's canvas:

- `src/lib/collaboration/yjs-provider.ts:254-257` looks up every dirty/deleted ID globally.
- `src/lib/collaboration/yjs-provider.ts:321-324` updates by item ID alone.
- `src/lib/collaboration/yjs-provider.ts:336-340` soft-deletes by item ID alone.

An OWNER/EDIT user can connect to a canvas they are allowed to edit, submit a raw Yjs update whose map key is an item ID from another canvas, and cause the persistence cycle to update, undelete, or delete that foreign item. Public/share responses disclose item IDs, so this does not require guessing an unobservable identifier.

**Required fix:** constrain every existence query and mutation to both `id` and `canvasId`; reject an existing ID whose canvas differs; derive actor fields from the authenticated connection; validate the full content/geometry schema; add a regression test that uses two owners and two canvases and proves cross-canvas update/delete is impossible.

### SEC-08 — Service worker caches private, authenticated responses

**Severity:** Critical  
**Confidence:** Confirmed

`public/sw.js:38-47` uses network-first caching for every successful same-origin GET (and attempts the same operation for other methods) and does not exclude `/api`, authenticated HTML, auth routes, or user-specific data. Cache Storage keys do not vary on cookies. A later offline/network-failed request—or another account using the same browser profile—can receive a prior user's cached API/page response. `CACHE_NAME` is also permanently fixed at `canvascollect-v1` (`public/sw.js:6`), so releases do not naturally invalidate these records.

The install step also preloads authenticated routes such as `/dashboard`; install can fail when those responses redirect or are unavailable.

**Required fix:** purge the current cache name on activation; cache only a small explicit list of immutable public assets; never cache API, auth, setup, share-token, or authenticated navigation responses; version the cache from the build; add account-switch and offline privacy tests.

### SEC-09 — Uploads are either broken or globally public

**Severity:** Critical  
**Confidence:** Confirmed architecture contradiction

The upload route stores objects without a public ACL, presigned URL, or authorized read proxy (`src/app/api/v1/upload/route.ts:439-449`) and returns a permanent public URL from `UPLOADS_PUBLIC_URL` (`:192-205`). The setup helper only creates the bucket; it does not establish a read policy. Therefore:

- with the reference MinIO/S3 default (private bucket), returned image URLs produce authorization failures; or
- if an operator makes the bucket public, images from private canvases become world-readable forever by URL and bypass canvas permissions.

Objects are not linked to a canvas ACL in the database, and the repository contains no `GetObject` authorization endpoint, presigned read flow, or `DeleteObject` lifecycle.

**Required fix:** store objects privately; record ownership/attachment; serve through an authorized proxy or short-lived signed URLs; remove public immutable caching for private assets; delete unreferenced/account-deleted objects; test owner, collaborator, revoked collaborator, and anonymous access.

### SEC-10 — Outbound webhook redirects bypass SSRF validation

**Severity:** Critical  
**Confidence:** Confirmed

`deliverSignedWebhook` validates the initial URL with DNS (`src/lib/agents/webhooks.ts:83`) but calls `fetch` with its default redirect behavior (`:104`). A permitted public endpoint can respond with a redirect to loopback, RFC1918, link-local, cloud metadata, or an internal service; the redirected destination is never revalidated.

The existing `safeFetch` implementation demonstrates the intended manual-redirect pattern, but webhook delivery does not use it. DNS validation and connection are also separate operations, leaving a DNS-rebinding window.

**Required fix:** set `redirect: "manual"`; resolve and validate every hop; cap hop count; pin the validated address (or use an egress proxy); block all private/reserved IPv4 and IPv6 ranges; retest the final URL before sending signed content.

## High findings

### SEC-02 — Yjs bypasses content, geometry, version, and attribution rules

Only the enum value is checked before persistence. Numeric geometry is coerced with `Number`, content is cast directly to Prisma JSON, tags are only checked for being an array, and `createdById` / `updatedById` come from the untrusted document (`src/lib/collaboration/yjs-provider.ts:217-250`). This bypasses the Zod schemas used by REST, permits impossible dimensions/content, forges attribution, revives deleted records, and ignores optimistic versions.

Validate the same discriminated content and geometry schema used by REST, use the authenticated connection as actor, and have the server own IDs and versions.

### SEC-03 — WebSocket authorization is never revalidated

Canvas access is evaluated only during upgrade (`src/lib/collaboration/websocket-server.ts:419-458`). Revoking a share, making a public canvas private, deleting/locking a user, changing a role, or rotating a session does not affect an existing socket. The client retains its original role until disconnection.

Add short-lived authorization leases or recheck on privileged messages; publish revocation/role-change events that close or downgrade matching connections; reject locked/deleted users.

### SEC-04 — WebSocket payload and anonymous-connection denial of service

The server uses `new WebSocketServer({ noServer: true })` without a conservative `maxPayload` (`src/lib/collaboration/websocket-server.ts:333`), leaving the library's very large default. JSON message/cursor payloads have no schema or byte limit, binary Yjs updates are applied directly, and the limit is 6,000 messages per minute per connection (`:39`, `:684-699`). Public canvases allow unlimited anonymous connections (`:372-389`), making per-connection limits trivial to multiply.

Set small per-message and per-document limits, validate each message type, limit connection creation by trusted IP/account/canvas, cap Yjs growth/complexity, and apply backpressure before broadcast/Redis publication.

### SEC-05 — Public collaboration presence discloses email addresses

Presence payloads include each authenticated participant's email (`src/lib/collaboration/websocket-server.ts:192-201`, `:750-763`). Any anonymous guest connected to a public canvas receives that list. Email is not needed to render presence and should not cross this trust boundary.

Publish a non-sensitive display name and opaque user ID only; consider per-canvas pseudonyms for public sessions.

### SEC-06 — Shared viewers can request soft-deleted content

`GET /api/v1/canvas-items` accepts `includeDeleted=true` (`src/app/api/v1/canvas-items/route.ts:110`, `:133`) and requires only VIEW access (`:143`). A VIEW collaborator can therefore enumerate records the owner deleted. The UI does not expose a trash/recovery contract that would make this expected.

Restrict deleted-item retrieval to OWNER (or a dedicated restore permission) and define retention/purge semantics.

### SEC-07 — Canvas owners can rewrite another user's comment

Comment PATCH permits either the comment author or canvas owner (`src/app/api/v1/items/[itemId]/comments/[commentId]/route.ts:114-123`). Owner deletion/moderation is defensible, but silent editing changes authorship and audit meaning.

Allow owners to hide/delete with a moderation reason; reserve content edits for the author and preserve edit history.

### SEC-11 — Agent action path can escape the configured webhook origin

`new URL(requestData.path, integrationAccount.externalAccountId)` (`src/lib/agents/service-core.ts:1075-1077`) accepts an absolute URL or scheme-relative path. The action can therefore redirect the signed secret-bearing request to an arbitrary public origin even without an HTTP redirect.

Require a path beginning with a single `/`, reject schemes/hosts/userinfo, then assert that the resulting origin exactly matches the configured integration origin.

### SEC-12 — Webhook responses and audit metadata are unbounded/sensitive

Webhook delivery reads the entire response with `response.text()` (`src/lib/agents/webhooks.ts:117`) and stores delivery/request metadata in action records (`src/lib/agents/service-core.ts:1089-1113`). A remote endpoint can return an enormous body and consume memory/database space. Custom headers and bodies can include bearer tokens or customer secrets and are stored in plaintext. A crash/retry can duplicate the external side effect because there is no downstream idempotency contract.

Stream with a strict byte cap, redact/allowlist persisted fields, encrypt secret metadata, send an idempotency key, and separate side-effect completion from audit persistence with a durable job/outbox.

### SEC-13 — Wildcard CORS matching accepts sibling attacker domains

For `*.example.com`, `isOriginAllowed` uses `origin.endsWith(domain)` (`src/middleware/cors.ts:91-96`). An origin such as `https://notexample.com` ends with `example.com` and is accepted. Credentials are enabled by default.

Parse origins with `URL`, require HTTPS as configured, and match `hostname === domain || hostname.endsWith('.' + domain)` with explicit port rules.

### SEC-16 — Rate limits are spoofable, per-process, and memory-unbounded

The edge limiter trusts the first caller-controlled `x-forwarded-for` value (`src/middleware/rate-limit.ts:41-44`), stores entries in a global in-process Map (`:27-38`), and never removes empty/expired keys (`:83-100`). An attacker can rotate the header to bypass limits and grow the map indefinitely. Restarts and multiple instances reset/split limits.

Only trust proxy-sanitized connection identity, use a bounded distributed store, expire keys server-side, and add adversarial proxy-header/multi-instance tests.

### SEC-17 — Login lockout is raceable and enables victim denial of service

Redis lockout performs `GET`, increments in application memory, then `SETEX` (`src/lib/auth/account-lockout.ts:90-111`) rather than an atomic increment/script. Parallel attempts can lose counts. Conversely, any attacker can intentionally lock a known victim email, and the auth middleware's five-request shared IP budget can lock out legitimate users behind NAT. A nonexistent user skips Argon2 verification (`src/lib/auth.ts:49-65`), retaining a timing-enumeration difference.

Use an atomic Redis script, combine account and trusted-IP/device controls, add progressive delay, perform a dummy password hash check for unknown users, and avoid hard victim lockout as the primary defense.

### SEC-18 — JWT sessions survive deletion, lock, and password change

Auth.js uses JWT sessions (`src/lib/auth.ts:16-17`). The JWT callback explicitly does not re-fetch the user (`:82-99`), while the database `Session.revokedAt` field is unused. Deleting/locking a user or changing/resetting a password does not invalidate existing cookies until token expiry.

Add a user session-version/security-stamp to JWTs, compare it on requests, increment it on security events, and enforce locked/deleted state.

### SEC-19 — Production recovery tokens can be printed to logs

The default production-compatible `EMAIL_PROVIDER` is `console`. The provider prints full text and HTML (`src/lib/email/providers/console.ts:16-42`), including password-reset and verification URLs. The reference Compose file does not pass SendGrid/Resend credentials. The unit test run visibly printed the complete token URLs, confirming the path.

Reject `console` in production, require a verified delivery provider at readiness, and redact all token/query values from structured and console logs.

### SEC-20 — Recovery tokens are plaintext and reset is not single-use atomic

Password-reset and verification tokens are stored directly in indexed columns (`prisma/schema.prisma:255-276`). Reset performs a read/check/password update sequence rather than atomically consuming a token, so concurrent requests can both pass and the last password wins. Reset/change does not revoke JWT sessions.

Store a hash of the token, consume with a conditional transaction/update, and revoke all sessions/security stamps in the same transaction.

### SEC-21 — Full request URLs leak secrets and private searches

Middleware logs `request.url` for every request (`src/middleware.ts:31-41`). That includes setup, reset, verification, public-share tokens, and search queries. The search route additionally logs the raw query (`src/app/api/v1/search/route.ts:80`). Browser history/referrer/analytics can also capture the setup query token.

Log pathname plus an allowlisted/redacted query summary; move bootstrap/recovery secrets to body or fragment-to-body exchanges; configure analytics exclusion for secret routes.

### SEC-23 — Account deletion is not complete or reliably executable

The route deletes items only in canvases owned by the user (`src/app/api/v1/users/account/route.ts:61-88`), but `CanvasItem.createdById` is required and does not cascade. If the user created an item in someone else's shared canvas, deleting the User can fail on that foreign key. Password-reset/verification records, idempotency records, audit records, stale share emails, and object-storage files are not all removed or anonymized.

Define a retention/anonymization policy, handle every relation and object key, revoke sessions first, and test deletion for a user who collaborated in another owner's canvas.

### SEC-24 — BYOK encryption silently reuses the auth signing secret

Agent credentials use AES-GCM correctly, but the key is `MODEL_CREDENTIAL_ENCRYPTION_KEY || AUTH_SECRET` (`src/lib/agents/crypto.ts:9-13`). Setup and Compose do not set the dedicated key. Rotating the auth secret then makes all stored provider credentials undecryptable; compromise also crosses two trust domains.

Require a dedicated versioned encryption key in production, add key IDs/rotation, and pass it explicitly through self-host orchestration.

## Additional security hardening findings

| ID | Severity | Finding | Evidence / action |
|---|---|---|---|
| SEC-14 | Medium | CSP report endpoint is an unauthenticated log-flood/injection sink. | `src/app/api/csp-report/route.ts:28-57` accepts arbitrary JSON and logs attacker-controlled URLs/script samples without a schema, size cap, or rate limit. Validate, cap, sample, and isolate security telemetry. |
| SEC-15 | Medium | Invalid API/integration token attempts can force expensive Argon2 work without a pre-verification limit. | API-key limiting occurs only after successful authentication; `/api/agent/*` is outside middleware limits. Rate-limit on trusted IP/prefix before Argon2 and cap keys/tokens per account. |
| SEC-22 | High | `pnpm doctor` prints secrets. | `scripts/doctor.mjs:34`, `:72`, `:137-142` includes raw `AUTH_SECRET`, database URL, and other details in human/JSON output. Redact credentials and query components. |
| SEC-25 | Medium | Public health response can disclose raw database errors. | `src/app/api/health/route.ts:51-56` returns `error.message`. Return a stable code publicly; keep details in protected logs. |
| SEC-26 | High | Registration does not require verified email for login. | `src/lib/auth.ts:49-76` authenticates without checking `emailVerified`; open registration plus console-only email makes identity assurance ineffective. Decide and enforce a verification policy. |
| SEC-27 | High | Bootstrap secret has weak handling. | Setup uses a published placeholder, setup accepts the token through a browser-facing flow, and request URL logging can capture it. Generate a real secret, compare in constant time, make it one-use, and never put it in a logged URL. |
| SEC-28 | High | Agent/MCP routes are not covered by the general `/api/v1` limiter. | `src/middleware.ts:60-108` has no `/api/agent` branch. Valid integration tokens can produce unbounded DB writes/Argon2 checks/external actions. Apply actor/capability-specific distributed budgets. |
| SEC-29 | Medium | Unknown WebSocket upgrade paths are left untouched by the collaboration listener. | The `server.on('upgrade')` callback handles only `/api/collaboration/` and has no rejection branch (`src/lib/collaboration/websocket-server.ts:336-478`). Explicitly destroy unsupported upgrades to avoid hanging sockets. |

## Positive controls worth preserving

- Passwords and API/integration keys use Argon2id.
- Agent secret encryption uses random IVs and authenticated AES-256-GCM.
- Normal REST item content uses discriminated Zod schemas and parameterized SQL.
- `safeFetch` manually checks redirect hops and streams with a size limit; reuse and strengthen that model for webhooks.
- CSP nonces, frame denial, MIME sniffing protection, and the general security-header baseline are directionally sound.
