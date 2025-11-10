Title: SSRF‑Protected Bookmark Unfurling
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Context
- Fetching remote pages for metadata is high‑risk for SSRF, data exfiltration, and abuse.

Decision
- Restrict to http/https; block private IP ranges; DNS pinning; response size ≤ 2MB; redirects ≤ 3; timeout ≤ 5s.
- Cache results keyed by URL hash with default TTL 24h; sanitize extracted HTML server‑side.

Alternatives
- Client‑side unfurling (rejected: leaks tokens/origins; weak security).

Consequences
- Lower SSRF/XSS risk; additional infra checks.

Implementation
- Hardened fetcher utility + allowlist/denylist; DOMPurify on server; structured cache layer.

References
- SENATE.md Security Checklist (Accepted)
