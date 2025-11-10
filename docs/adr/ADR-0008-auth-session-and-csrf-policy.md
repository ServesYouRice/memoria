Title: Auth Hashing, Session Management, and CSRF Policy
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Decision
- Password hashing: Argon2id; enforce zxcvbn ≥ 3; min length 10.
- Sessions: HttpOnly Secure cookies; SameSite=Lax; rotate on use; support device/session revocation.
- CSRF: Require CSRF tokens for all mutating Route Handlers (beyond Auth.js flows).

Consequences
- Stronger account security; slightly more implementation work.

References
- SENATE.md Security Checklist (Accepted)
