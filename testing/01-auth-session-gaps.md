# 01 — Authentication, Session Lifecycle & Lockout Testing Gaps

## Domain Overview & Architecture

Memoria uses **Auth.js (NextAuth v5 beta)** with credentials-based authentication, Argon2id password hashing, email verification tokens, and Redis-backed session/lockout management.

```
Client (Browser)
   |  POST /api/v1/auth/login
   v
src/proxy.ts (Auth Rate Limiting)
   v
src/lib/auth.ts (authorize() -> Lockout Check -> Argon2id Verify -> Session Token)
   v
PostgreSQL (User / Session) + Redis (Account Lockout & Session Cache)
```

---

## Detailed Testing Gaps & Audit Findings

### GAP-AUTH-01: Lockout Checked After Argon2 Verification (`LOG-03`)
- **Severity**: **Critical**
- **Affected Files**: `src/lib/auth.ts`, `tests/unit/account-lockout.test.ts`
- **Defect Description**: The authentication handler performs compute-heavy `argon2.verify(user.passwordHash, password)` *before* verifying if the account is locked out in Redis or database state. A locked account providing valid credentials succeeds in logging in or consumes high-cost Argon2 CPU resources.
- **Current Test Gap**: Existing tests in `account-lockout.test.ts` mock `argon2.verify` but do not assert the strict execution order. There is no test verifying that an already locked account rejects immediately with zero Argon2 compute invocations.
- **Invariant Requirement**: `isAccountLocked(email)` must execute prior to `argon2.verify()`, and a locked state must immediately throw `AccountLockedError` without touching password verification.

### GAP-AUTH-02: Account Enumeration on Login Route (`SEC-01`)
- **Severity**: **High**
- **Affected Files**: `src/lib/auth.ts`, `src/app/api/v1/auth/login/route.ts`
- **Defect Description**: The login flow returns distinct error messages or response timings when an email does not exist in the database versus when a password is incorrect. This permits attackers to enumerate registered users.
- **Current Test Gap**: Unit tests assert success vs invalid password separately, but no test measures timing parity or response payload uniformity between non-existent users and wrong passwords.
- **Invariant Requirement**: For both missing users and incorrect credentials, the response status (401), error code (`INVALID_CREDENTIALS`), and constant-time dummy hashing must be identical.

### GAP-AUTH-03: Session Invalidation Under Redis Partition
- **Severity**: **High**
- **Affected Files**: `src/lib/auth/session-cache.ts`, `src/lib/cache/redis.ts`, `tests/unit/account-lockout-redis-failure.test.ts`
- **Defect Description**: When Redis experiences a connection drop or partition, the session validation logic defaults to an in-memory fallback. If a user was revoked during the partition, stale sessions may persist until node restart.
- **Current Test Gap**: `account-lockout-redis-failure.test.ts` only tests lockout increment failure; it does not test session revocation broadcast failure when Redis is down or reconnecting.
- **Invariant Requirement**: When Redis is partitioned, session verification must fail closed or query PostgreSQL directly as the durable authority for revoked session timestamps.

### GAP-AUTH-04: Concurrent Email Verification Token Consumption Race
- **Severity**: **Medium**
- **Affected Files**: `src/app/api/v1/auth/verify-email/route.ts`, `tests/api/auth-verification.test.ts`
- **Defect Description**: If an email verification token is submitted in parallel via two concurrent requests, there is no database transaction locking (`SELECT ... FOR UPDATE`) or atomic CAS condition on `usedAt: null`, risking double-consumption side effects.
- **Current Test Gap**: `tests/api/auth-verification.test.ts` only tests single sequential token verification. No parallel invocation test exists.
- **Invariant Requirement**: Token redemption must use an atomic single-statement update `UPDATE "EmailVerificationToken" SET "usedAt" = NOW() WHERE "id" = $1 AND "usedAt" IS NULL` and assert rows affected == 1.

---

## Actionable Test Implementation Matrix

| Test ID | Scope | Target File | Test Strategy | Target Model |
| --- | --- | --- | --- | --- |
| `TEST-AUTH-01` | Unit | `tests/unit/auth-lockout-order.test.ts` | Spy on `argon2.verify` and assert 0 calls when `isLocked === true` | Sonnet |
| `TEST-AUTH-02` | Unit / Security | `tests/unit/auth-enumeration-timing.test.ts` | Assert identical error structure and constant-time execution | Sonnet + Opus |
| `TEST-AUTH-03` | Integration | `tests/integration/session-revocation-redis.test.ts` | Test session invalidation against real Redis + Postgres rollback | Sonnet |
| `TEST-AUTH-04` | Integration | `tests/integration/auth-token-race.test.ts` | Fire 10 parallel HTTP POSTs to verify token and assert exactly 1 success | Sonnet |

---

## Advisor-Executor Prompt Specification

```xml
<test_specification domain="auth_and_session">
  <context>
    Memoria uses NextAuth v5 credentials provider with Argon2id and Redis lockout caching.
    Source: src/lib/auth.ts, src/app/api/v1/auth/
  </context>
  <task>
    Implement hermetic tests verifying that account lockout checks strictly precede Argon2id verification,
    and that token verification handles concurrent attempts atomically.
  </task>
  <invariants>
    1. If user account is locked, argon2.verify MUST NOT be called.
    2. Missing account vs incorrect password MUST return identical 401 Problem Details payloads.
    3. Token redemption under 10 concurrent requests must produce exactly one 200 OK and nine 400 Bad Request responses.
  </invariants>
  <verification>
    pnpm test tests/unit/auth-lockout-order.test.ts tests/integration/auth-token-race.test.ts
  </verification>
</test_specification>
```
