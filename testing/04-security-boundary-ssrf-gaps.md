# 04 — Security Boundaries, SSRF & Abuse Prevention Testing Gaps

## Domain Overview & Architecture

Memoria enforces defense-in-depth across multiple security layers:
- **Request Boundary**: `src/proxy.ts` applies Content Security Policy (CSP) with dynamic nonces, CORS headers, API versioning, and tiered rate limiting.
- **SSRF Defense**: `src/lib/security/ssrf.ts` inspects external URLs before bookmark unfurling.
- **Access Control & Permissions**: Canvas-level roles (`OWNER`, `EDIT`, `COMMENT`, `VIEW`) and Public Share Tokens.
- **AI / Agent Guardrails**: BYOK model credentials, agent action auditing, and signed webhook delivery.

```
Client Request
   v
src/proxy.ts
   ├── Client IP Verification (Trusted Proxy CIDR)
   ├── Rate Limiting (Auth, Uploads, Agent, API)
   ├── Security Headers & CSP Nonce Injection
   └── Route & Version Guardrails
   v
API Route Handlers (AuthZ + SSRF + AI Cost Controls)
```

---

## Detailed Testing Gaps & Audit Findings

### GAP-SEC-01: SSRF DNS Rebinding & Time-Of-Check to Time-Of-Use (TOCTOU)
- **Severity**: **High**
- **Affected Files**: `src/lib/security/ssrf.ts`, `src/app/api/v1/unfurl/route.ts`
- **Defect Description**: The bookmark unfurler resolves DNS to check for private IP ranges (127.0.0.1, 10.0.0.0/8, 169.254.169.254), but then passes the original URL string to `fetch()`. An attacker controlling a DNS server with TTL=0 can return a public IP for the initial check and 127.0.0.1 for the actual HTTP connection (DNS rebinding).
- **Current Test Gap**: `tests/unit/ssrf-hostile.test.ts` only tests static private IP strings and blocked domains; it never simulates DNS rebinding or socket-level IP connection pinning.
- **Invariant Requirement**: `fetch()` or the HTTP client must connect directly to the validated IP address while preserving the `Host:` header, or use custom agent socket pinning.

### GAP-SEC-02: Public Share Token Leakage to Read-Only Collaborators (`SEC-03`)
- **Severity**: **High**
- **Affected Files**: `src/app/api/v1/canvases/[canvasId]/route.ts`, `src/lib/sharing/`
- **Defect Description**: When returning canvas metadata to collaborators with the `VIEW` or `COMMENT` role, the API returns the raw `shareToken`. This allows any read-only viewer to distribute the public share link or access unredacted share configuration.
- **Current Test Gap**: Unit tests for canvas details only test the canvas owner persona. No test verifies role-based field redaction for non-owner collaborators.
- **Invariant Requirement**: The `shareToken` field must only be visible to users with `OWNER` or `ADMIN` permissions on the canvas; it must be redacted (`null` or omitted) for all other roles.

### GAP-SEC-03: AI Endpoints Lack Per-User Cost & Rate Ceilings (`SEC-08`)
- **Severity**: **High**
- **Affected Files**: `src/app/api/ai/generate/route.ts`, `src/app/api/agent/v1/`
- **Defect Description**: AI endpoints (`/api/ai/*`, `/api/agent/*`) invoke OpenAI/Claude/Gemini models without enforcing per-user daily token budgets or burst spend ceilings. A compromised session or malicious user can exhaust API quotas or drive up cloud costs.
- **Current Test Gap**: Existing tests mock the AI response without asserting token budget tracking, rate exhaustion, or 429 quota errors.
- **Invariant Requirement**: Each AI invocation must check against a daily user token budget in Redis/Postgres and reject with `429 Too Many Requests` (Quota Exceeded) when breached.

### GAP-SEC-04: Client IP Spoofing via `X-Forwarded-For`
- **Severity**: **Medium**
- **Affected Files**: `server.ts`, `src/proxy.ts`, `src/lib/network/client-ip.ts`
- **Defect Description**: If `TRUSTED_PROXY_CIDRS` is improperly configured or omitted in self-hosted deployments, an attacker can supply custom `X-Forwarded-For` headers to bypass rate limits and IP ban policies.
- **Current Test Gap**: `tests/unit/client-ip.test.ts` tests CIDR parsing, but there is no integration test validating that `src/proxy.ts` rejects spoofed headers when receiving traffic from untrusted upstream sockets.
- **Invariant Requirement**: `x-memoria-client-ip` must only trust forwarding headers from explicitly configured proxy CIDRs. Untrusted connections must use `req.socket.remoteAddress`.

---

## Actionable Test Implementation Matrix

| Test ID | Scope | Target File | Test Strategy | Target Model |
| --- | --- | --- | --- | --- |
| `TEST-SEC-01` | Adversarial / Security | `tests/unit/ssrf-dns-rebinding.test.ts` | Mock DNS resolver flipping from public to 127.0.0.1; assert request is blocked | Opus (Security Advisor) |
| `TEST-SEC-02` | API / AuthZ | `tests/api/share-token-redaction.test.ts` | Query canvas as VIEW collaborator; assert `shareToken === undefined` | Sonnet |
| `TEST-SEC-03` | Unit / RateLimit | `tests/unit/ai-budget-ceiling.test.ts` | Consume max daily token budget; assert subsequent request returns 429 | Sonnet |
| `TEST-SEC-04` | Integration | `tests/integration/proxy-ip-spoofing.test.ts` | Send forged `X-Forwarded-For` from untrusted IP; assert rate limit tracks true IP | Sonnet |

---

## Advisor-Executor Prompt Specification

```xml
<test_specification domain="security_and_ssrf">
  <context>
    Memoria enforces security boundaries in src/proxy.ts, src/lib/security/ssrf.ts, and canvas role authorization.
  </context>
  <task>
    Implement adversarial test suites verifying SSRF DNS-rebinding immunity, role-based shareToken redaction, and AI budget ceilings.
  </task>
  <invariants>
    1. A URL whose second DNS resolution resolves to loopback/private CIDR MUST NOT connect.
    2. GET /api/v1/canvases/:id MUST NOT expose shareToken to non-owner roles.
    3. AI generation requests that exceed the configured token ceiling MUST return HTTP 429 Problem Details.
  </invariants>
  <verification>
    pnpm test tests/unit/ssrf-dns-rebinding.test.ts tests/api/share-token-redaction.test.ts tests/unit/ai-budget-ceiling.test.ts
  </verification>
</test_specification>
```
