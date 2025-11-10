Title: API Versioning, Error Contract, Idempotency, and Minimal Responses
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Context
- We need stable, evolvable HTTP APIs with predictable error shapes and safe retries.
- Clients benefit from smaller payloads when response bodies are not necessary.

Decision
- Prefix all HTTP routes with `/api/v1` (SemVer). Future breaking changes roll into `/api/v2`.
- Standardize errors on RFC 7807 `application/problem+json` with machine‑readable details for validation errors.
- Require an idempotency key for at‑risk mutation endpoints; deduplicate on the server.
- Support `Prefer: return=minimal` on update endpoints to reduce payload size when callers don't need full resources.

Alternatives Considered
- Unversioned routes with inline deprecations (rejected: brittle for breaking changes).
- Ad‑hoc error shapes (rejected: inconsistent and harder to consume).

Consequences
- Clear upgrade path; explicit deprecation windows.
- Better client ergonomics and safer retries with idempotency.

Implementation Notes
- Add API router middleware to enforce `/api/v1` and map exceptions to problem+json.
- Add idempotency store keyed by request key + route + user (DB or cache).

References
- SENATE.md §3.6 API Conventions (Accepted)
