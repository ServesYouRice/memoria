Title: Nonce‑Based Strict CSP with Explicit Allowlists
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Context
- MUI/emotion and dynamic content require a CSP that is effective without weakening policies.

Decision
- Use nonce‑based CSP for scripts/styles. Forbid 'unsafe-inline' and 'unsafe-eval' in all environments.
- Explicitly allowlist img-src (e.g., S3 domain), connect-src (API + telemetry if enabled), font-src.
- Set frame-ancestors 'none'.

Alternatives
- Hash‑based CSP (viable but more overhead with dynamic chunks).

Consequences
- Tighter XSS posture; some libraries may require adjustments.

Implementation
- Generate a per‑request nonce; attach via headers; pass to emotion/MUI injection.
- Document any required CSP exceptions.

References
- SENATE.md Security Checklist (Accepted)
