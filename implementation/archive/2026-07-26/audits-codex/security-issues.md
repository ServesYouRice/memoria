# Security and Abuse-Resistance Audit

## Scope

This review covered authentication and verification, authorization boundaries, request throttling, WebSocket admission, uploads and object storage, public links, input validation, secret/log handling, security headers, metrics exposure, and dependency controls. Positive controls observed include Argon2 password hashing, hashed verification/reset/API tokens, session-version invalidation, private asset authorization, SSRF-aware bookmark fetching, CSP nonces, and production environment validation.

## Findings

### SEC-01 — Reverse-proxy deployments collapse all users into one rate-limit identity

- **Severity:** High
- **Location:** `server.ts` client-IP normalization and rate-limiter integration; production reverse-proxy topology
- **Description:** The custom server replaces the client-IP header with the direct TCP peer and intentionally ignores forwarding headers. The Compose application binds to loopback, so a normal host reverse proxy becomes the peer for every public request.
- **Why it matters for production:** Authentication limits (5 requests/15 minutes) and general API limits (100 requests/15 minutes) become global. One user or attacker can exhaust the shared bucket and deny service to everyone.
- **Recommended fix:** Define an explicit trusted-proxy model. Accept an injected client address only from configured proxy networks, strip client-supplied copies at the edge, validate the address, and retain per-account limits for authenticated operations.
- **Blocker before production:** Yes for any reverse-proxied public deployment.
- **Related risks or dependencies:** Test direct, single-proxy, and multi-proxy deployments. Coordinate the proxy contract with Caddy/Nginx/ingress documentation.

### SEC-02 — Public registration and expensive features have no tenant/user quotas

- **Severity:** High
- **Location:** Registration, canvas/item/workspace creation routes, AI operator endpoints, upload policy
- **Description:** Production can expose open registration while creation is governed mainly by IP throttles. There are no durable per-user limits for total canvases/items/workspaces, and AI operations lack per-user spend and concurrency budgets.
- **Why it matters for production:** A valid low-cost account can grow the database, storage, thumbnail work, and paid AI usage until capacity or budget is exhausted.
- **Recommended fix:** Add an explicit registration mode (closed, invite-only, open), durable tenant/user quotas, atomic counters, AI token/cost/concurrency budgets, and operator alerts. Reject before expensive work begins.
- **Blocker before production:** Yes for an open public or AI-enabled launch.
- **Related risks or dependencies:** IP limiting remains useful for anonymous abuse but cannot replace account/tenant policy. Requires product decisions about plans and retention.

### SEC-03 — Uploaded objects can outlive their database records and user deletion

- **Severity:** High
- **Location:** Upload creation, canvas deletion, account deletion, S3/MinIO cleanup
- **Description:** Object upload occurs before its database record is committed, so a database failure or crash can orphan the object. Canvas cascade deletion removes upload rows without deleting the corresponding object. Account deletion attempts physical cleanup after the database transaction and only logs failures, with no durable retry.
- **Why it matters for production:** Deleted personal content can remain in storage indefinitely, storage cost grows silently, and privacy/deletion assurances cannot be proven.
- **Recommended fix:** Use a durable object-lifecycle state machine and cleanup queue. Record intent before upload, finalize only after both sides succeed, enqueue object deletion transactionally, retry idempotently, and run a reconciliation job with retention safeguards.
- **Blocker before production:** Yes where uploads or account deletion are offered.
- **Related risks or dependencies:** Template/duplicate asset references must be redesigned first (`LOG-06`). Backups must include objects (`DEP-02`).

### SEC-04 — Public WebSocket admission is tokenless and has weak abuse boundaries

- **Severity:** High
- **Location:** `src/lib/collaboration/websocket-server.ts`, public canvas connection flow
- **Description:** Anonymous guests can join a public canvas WebSocket using its canvas ID and public flag; the share token is not required. Upgrade requests do not enforce an Origin allowlist or a dedicated IP admission limit. A 100-socket canvas cap can be occupied by an attacker.
- **Why it matters for production:** Public canvas identifiers exposed by APIs become sufficient to consume collaboration capacity, observe presence traffic, and deny legitimate viewers.
- **Recommended fix:** Require the active share capability or a short-lived scoped WebSocket ticket, validate Origin, add trusted-IP and canvas admission limits, cap connections per principal, and expire idle guests.
- **Blocker before production:** Yes if public real-time sharing is enabled.
- **Related risks or dependencies:** Do not put long-lived share secrets in logs or query strings. Cross-instance connection accounting needs Redis or another shared store.

### SEC-05 — Disabling a public link does not rotate its bearer token

- **Severity:** Medium
- **Location:** Public-share enable/disable routes and `Canvas.publicToken`
- **Description:** Turning public access off changes the public flag but retains the old token. Re-enabling restores the same previously distributed URL.
- **Why it matters for production:** Owners reasonably expect disabling a link to revoke it. A previously leaked or intentionally revoked link silently becomes valid again.
- **Recommended fix:** Clear or rotate the token whenever public access is disabled; show rotation/revocation semantics in the UI and audit the event.
- **Blocker before production:** No, provided public links are clearly labeled beta; otherwise fix before public sharing launch.
- **Related risks or dependencies:** Existing links will break on rotation by design. Add explicit confirmation.

### SEC-06 — Canvas payload validation permits resource-exhaustion shapes

- **Severity:** High
- **Location:** Canvas item schemas for geometry, drawings, polls, text/frame/embed/bookmark metadata, extension clipping
- **Description:** Geometry is mostly checked only for finite/positive values; many strings and nested arrays have no practical maximum. Drawing paths, poll voter arrays, dimensions, and extension selections can be arbitrarily large within the request-body ceiling.
- **Why it matters for production:** An authorized editor can create records that are expensive to validate, serialize, snapshot, render in Konva, send to every viewer, or store repeatedly in history.
- **Recommended fix:** Establish per-type schemas with coordinate/dimension bounds, maximum encoded bytes, point/option/vote counts, normalized text limits, nesting limits, and a per-canvas aggregate budget. Validate identically on all write paths.
- **Blocker before production:** Yes for shared or publicly viewable canvases.
- **Related risks or dependencies:** Existing oversized data needs a migration/quarantine strategy. Align limits with import, templates, versioning, and WebSocket messages.

### SEC-07 — Operational endpoints disclose internals without authentication

- **Severity:** Medium
- **Location:** `/api/metrics`, `/api/health`
- **Description:** Public responses expose process/runtime measurements, application version, uptime/start information, memory state, and dependency readiness.
- **Why it matters for production:** The data improves attacker reconnaissance and can reveal deploy/restart timing or degraded dependencies.
- **Recommended fix:** Expose a minimal liveness response publicly only if required. Restrict detailed readiness/metrics to an internal network, service identity, or monitoring credential.
- **Blocker before production:** No if the edge firewall already restricts these routes; otherwise address before internet exposure.
- **Related risks or dependencies:** Monitoring infrastructure must be configured before restricting access.

### SEC-08 — Uploads are buffered in memory before complete safety checks

- **Severity:** High
- **Location:** Upload POST route and asset GET route
- **Description:** Multipart parsing and `arrayBuffer()` materialize the upload in process memory. File checks focus on signatures; dimension/decompression limits are not consistently enforced, and malware scanning is configurable rather than an invariant. Asset downloads also materialize the full S3 object before responding.
- **Why it matters for production:** Concurrent near-limit uploads/downloads can exhaust heap. Crafted image dimensions or compressed content can shift risk to image tooling or clients, and malware may be redistributed.
- **Recommended fix:** Stream to quarantined object storage with byte limits, validate media structure and dimensions, scan asynchronously before activation, stream authorized downloads with range support, and cap concurrent processing.
- **Blocker before production:** Yes for an unrestricted public upload feature; otherwise disable uploads until the pipeline is hardened.
- **Related risks or dependencies:** Coordinate with `PERF-04`, CSP content rules, and durable cleanup in `SEC-03`.

### SEC-09 — Log redaction does not reliably cover nested or stringified secrets

- **Severity:** Medium
- **Location:** Logger configuration and call sites that serialize errors, headers, request bodies, or external responses
- **Description:** Redaction targets known field names, primarily in structured objects. Nested aliases, copied headers, and pre-stringified JSON/errors can bypass path-based redaction.
- **Why it matters for production:** Authentication tokens, API keys, share links, email addresses, or third-party payloads can enter centralized logs with longer retention and broader access than application data.
- **Recommended fix:** Use structured safe serializers, an explicit allowlist of logged request fields, recursive case-insensitive secret filtering, and tests with nested/capitalized/stringified examples. Never log full authorization headers or bearer URLs.
- **Blocker before production:** No, but complete before enabling verbose production logging or external log export.
- **Related risks or dependencies:** Sentry/event scrubbing needs the same policy.

### SEC-10 — Dependency vulnerability status is not a dependable release gate

- **Severity:** Medium
- **Location:** CI dependency-audit job and production dependency tree
- **Description:** CI fails only at the high-severity threshold. The local production audit could not reach the registry in the restricted audit environment, so there is no current independent advisory result in this report.
- **Why it matters for production:** Known moderate vulnerabilities or a broken/skipped advisory source can pass unnoticed, and a point-in-time audit cannot substitute for continuous review.
- **Recommended fix:** Store audit output as a CI artifact, fail on an agreed policy including exploitable moderate issues, use a lockfile-aware scanner/SBOM, define time-bound exceptions, and automate dependency updates.
- **Blocker before production:** Yes unless a fresh successful production-dependency scan is attached to the release candidate.
- **Related risks or dependencies:** This is an evidence gap, not a claim that a known vulnerability exists. Preserve registry credentials and avoid publishing private dependency metadata.

## Security priorities before production

1. Correct trusted-proxy addressing and add durable account/tenant quotas.
2. Bound every canvas/upload payload and harden streaming upload/download behavior.
3. Make object deletion durable and include object storage in privacy and recovery procedures.
4. Require scoped WebSocket/public-share capabilities and rotate revoked public links.
5. Restrict operational endpoints, verify log scrubbing, and attach a successful dependency scan to the release candidate.
