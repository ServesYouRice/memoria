Title: Security Headers and CORS Policy
Date: 2025-11-09
Status: Accepted
Owners: CodexCLI

Decision
- Headers: Referrer‑Policy `strict-origin-when-cross-origin`, X‑Content‑Type‑Options `nosniff`, X‑Frame‑Options `DENY` (or CSP frame‑ancestors), minimal Permissions‑Policy.
- CORS: Disallow wildcard origins with credentials; allow only configured origins.

References
- SENATErefactoring.md §3.6 Security Policies
