# Security Issues

Scope: authentication, authorization, data exposure, transport/headers, abuse
prevention, secrets. Inspection only — no dynamic testing was performed.

Legend: **B** = blocker before production.

---

## Context: what is already right

Stating this first because it changes how the findings below should be read.
This codebase has a genuinely strong security baseline:

- Strict env validation with **production invariants** ([lib/env.ts](src/lib/env.ts)):
  Redis required, local uploads refused, S3 mandatory, bootstrap token required,
  `INTERNAL_OPERATIONS_TOKEN` ≥32 chars, `MODEL_CREDENTIAL_ENCRYPTION_KEY` ≥32
  chars **and** required to differ from `AUTH_SECRET`.
- argon2id password hashing with a dummy-hash timing equaliser for unknown users.
- Session revocation via `sessionVersion`, enforced in the JWT callback *and*
  re-checked on live WebSocket connections.
- Zod validation at effectively every HTTP boundary; Prisma parameterised queries
  throughout, including the hand-written `$queryRaw` fragments.
- Share-aware authorization with an explicit access hierarchy.
- Nonce-based CSP with `'strict-dynamic'`, HSTS, `frame-ancestors 'none'`,
  `X-Content-Type-Options`, a restrictive `Permissions-Policy`.
- Upload defence in depth: magic-byte detection, declared-type cross-check, SVG
  deliberately excluded, private storage behind an authorized read proxy.
- The client IP used for abuse controls is derived from the socket in
  `server.ts` and **cannot** be spoofed via `X-Forwarded-For`.
- CI runs `pnpm audit --prod --audit-level=high`, dependency review with license
  denial, a clean container build, and SBOM generation.

The findings below are gaps in an otherwise well-constructed perimeter, not
evidence of a careless one.

---

## SEC-01 — Login reveals account existence before verifying the password

| | |
| --- | --- |
| **Severity** | **High** |
| **Location** | [auth.ts:79-81](src/lib/auth.ts#L79-L81), [LoginForm.tsx:73-78](src/features/auth/components/LoginForm.tsx#L73-L78) |
| **Blocker** | **B** |

**Problem.** In `authorize()`, the email-verification check runs *before*
`argon2.verify`:

```ts
if (process.env.NODE_ENV === "production" && !user.emailVerified) {
  throw new EmailNotVerifiedError();          // L79-81
}
const isValidPassword = await argon2.verify(...);   // L83 — never reached
```

`EmailNotVerifiedError` carries `code = "email_not_verified"`, which NextAuth
surfaces to the client. The login form then renders:

> "Your password is correct, but your email is not verified yet."

**Two problems.**

1. **The message is false.** The password was never checked. An attacker
   submitting an arbitrary password against an unverified account is told their
   password is correct.
2. **It is an enumeration oracle.** Any unauthenticated party can distinguish
   *"this email has an unverified account"* from *"invalid credentials"* with a
   single request and no password knowledge — defeating the careful dummy-hash
   timing equalisation two lines above.

**Why it matters.** Combined with SEC-02, an attacker can enumerate the full
user list of an installation, then target unverified accounts for verification-
flow abuse or credential stuffing knowing the account exists.

**Fix.** Verify the password **first**; only then check `emailVerified`. Correct
the UI copy to "If those credentials are correct, this account still needs email
verification." Return the same generic failure shape either way and rely on the
resend flow rather than a discriminating error.

---

## SEC-02 — Registration confirms whether an email is already registered

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [auth/register/route.ts:98-107](src/app/api/v1/auth/register/route.ts#L98-L107) |
| **Blocker** | No |

```ts
if (existingUser) {
  return problemToResponse(Problems.Conflict("A user with this email already exists"));
}
```

A distinct 409 for existing emails is a direct enumeration oracle on an
unauthenticated endpoint. Note the file *already* handles invite failures
carefully — the comment at L57-59 says invite failures "deliberately share one
response" — so the intent exists; registration just doesn't follow it.

**Fix.** Return an identical 202 in both cases and branch by email: new account →
verification link; existing account → "someone tried to register with your
address, sign in instead". This is the standard pattern and preserves UX.

**Secondary.** Ordering also wastes work: `validatePasswordStrength` (zxcvbn,
tens of ms) and `hashPassword` (argon2id) both run before the duplicate check.
Cheap checks should come first.

---

## SEC-03 — `shareToken` is leaked to every user with VIEW access

| | |
| --- | --- |
| **Severity** | **High** |
| **Location** | [canvases/[canvasId]/route.ts:43-70](src/app/api/v1/canvases/[canvasId]/route.ts#L43-L70) |
| **Blocker** | **B** |

**Problem.** The handler authorizes at `VIEW` level, then returns the whole row:

```ts
const canvasData = await prisma.canvas.findUnique({ where: { id: canvasId } });  // no select
...
return NextResponse.json({ ...canvasData, ... });   // spreads every column
```

`Canvas.shareToken` is a `@unique` secret used as the public-link capability
([schema.prisma:108](prisma/schema.prisma#L108)). It is now handed to every
VIEW- and COMMENT-role collaborator.

**Failure scenario.** Alice shares a canvas with Bob at VIEW. Bob's browser
receives `shareToken`. Bob keeps it. Later Alice enables public sharing — the
token is unchanged, so Bob (or anyone he gave it to) can hand out
`/share/<token>` to the world. Because `isValidGuestShare` requires only
`isPublic && token === shareToken`
([websocket-server.ts:111-118](src/lib/collaboration/websocket-server.ts#L111-L118)),
that link also grants WebSocket access.

`isPublic: false` limits immediate exploitation, which is why this is High and
not Critical — but the token is a long-lived capability that should never leave
the owner.

**Fix.** Add an explicit `select` listing only the fields the client needs.
`shareToken`, and arguably `isPublic`, should be returned only when
`accessLevel === "OWNER"`. Audit every other handler for bare row spreads —
this pattern is what makes such leaks invisible in review.

---

## SEC-04 — CORS responses lack `Vary: Origin`

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [middleware/cors.ts:116-155](src/middleware/cors.ts#L116-L155) |
| **Blocker** | No |

`applyCors` reflects the request origin into `Access-Control-Allow-Origin` and
sets `Access-Control-Allow-Credentials: true`, but never sets `Vary: Origin`.

**Why it matters.** Any shared cache (CDN, reverse proxy) may store a response
carrying `Access-Control-Allow-Origin: https://a.example` and serve it to a
request from `https://b.example`. With credentials allowed, that is a
cross-origin read primitive created purely by caching. It becomes live the moment
this app is deployed behind a CDN — normal for the self-host target.

**Fix.** `response.headers.append("Vary", "Origin")` whenever the origin is
reflected. Add `Vary: Origin, Cookie` on authenticated responses.

**Secondary.** The wildcard-subdomain matcher (L98-110) compares only hostname,
so `http://evil.example.com` matches `*.example.com` — scheme is not checked.

---

## SEC-05 — CSP `connect-src` and `img-src` permit any HTTPS host

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [middleware/csp.ts:23-27](src/middleware/csp.ts#L23-L27) |
| **Blocker** | No |

```ts
"img-src":     ["'self'", "data:", "blob:", "https:"],
"connect-src": ["'self'", "wss:", "https:"],
```

`https:` as a source expression matches **every** HTTPS origin on the internet.
CSP's main residual value after XSS is limiting exfiltration; `connect-src https:`
removes it entirely — injected script can `fetch()` canvas contents to any host.
`wss:` is likewise unrestricted rather than same-origin.

**Why it matters.** The rest of the CSP is strict and nonce-based, which implies
the exfiltration control was intended. This directive quietly negates it.

**Fix.** Narrow to what is actually needed: `connect-src 'self' wss://<AUTH_URL host>`
plus the Sentry ingest origin when `SENTRY_DSN` is set. For `img-src`, if
arbitrary remote images are a product requirement (bookmark favicons), proxy them
through the existing private-upload proxy rather than opening `https:`.

**Also verify:** `style-src` has a nonce but no `'unsafe-inline'`. Since
`style-src-attr` is unset it falls back to `style-src`, so inline `style={{...}}`
attributes — including `<html style={{colorScheme}}>` in
[layout.tsx:53](src/app/layout.tsx#L53) — should be blocked by a conforming
browser. Confirm against `/api/csp-report` output before changing anything; if
reports are firing, this is a real bug rather than a hardening note.

---

## SEC-06 — Query cache is not cleared on sign-out

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [AppShell.tsx:249-259](src/components/layout/AppShell.tsx#L249-L259), [providers.tsx:36-50](src/app/providers.tsx#L36-L50) |
| **Blocker** | No |

The `QueryClient` is constructed at **module scope**, so it lives for the whole
page session. Sign-out calls `signOut({ callbackUrl: "/" })` and nothing else —
no `queryClient.clear()`, no cache reset.

**Failure scenario.** User A signs out; user B signs in on the same browser
without a hard reload (a client-side navigation is enough). Until each query
refetches, B's UI renders A's canvas list, activity feed, and notifications from
cache. `staleTime` is 5 minutes, so the window is real.

**Why it matters.** Shared and kiosk machines are ordinary in the team settings
this product targets.

**Fix.** `await signOut({ redirect: false }); queryClient.clear(); router.push("/")`.
Also clear the `canvas-preferences` Zustand persistence and the
`canvas:<id>:viewport` `localStorage` keys written by
[use-canvas-data.ts:131](src/features/canvas/hooks/use-canvas-data.ts#L131),
which otherwise persist one user's board positions for the next.

---

## SEC-07 — Abuse controls are keyed by IP only, never by principal

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [middleware/rate-limit.ts:28-33](src/middleware/rate-limit.ts#L28-L33) |
| **Blocker** | No |

`getClientIdentifier` returns `x-memoria-client-ip` for every limiter. No limiter
incorporates the authenticated user id.

**Two-sided failure:**

- **False positives.** An office, university, or CGNAT range shares one budget.
  `canvasesRateLimit` is 50/min; a handful of colleagues on one canvas will 429
  each other during ordinary work.
- **False negatives.** One authenticated account can multiply its budget across
  IPs (VPN, cloud, IPv6 rotation) against expensive authenticated endpoints —
  notably the AI routes (SEC-08).

**Fix.** Key authenticated routes by `userId` and fall back to IP only for
anonymous traffic. Keep IP keying for `/api/v1/auth/*`.

---

## SEC-08 — AI endpoints have no per-user quota or cost ceiling

| | |
| --- | --- |
| **Severity** | **High** |
| **Location** | [lib/ai/service.ts](src/lib/ai/service.ts), `/api/v1/ai/{summarize,tags,generate,chat,serendipity}` |
| **Blocker** | **B** (if AI is enabled in production) |

**Problem.** Every AI route runs against the **operator's** `OPENAI_API_KEY`.
There is no per-user quota, no token accounting, no daily cap, and no
kill switch beyond unsetting the key. `summarizeCanvas` sends up to
**100,000 characters** per call (`.slice(0, 100_000)`, ~25k tokens) and the only
brake is the generic per-IP `apiRateLimit`.

**Failure scenario.** Any authenticated user — on an installation with open
registration (`REGISTRATION_MODE` defaults to `"open"`) — scripts summarize
against a large canvas in a loop and bills the operator without limit. There is
no telemetry that would reveal it: `/api/metrics` exposes process and outbox
counters only.

**Fix.** Before enabling AI in production: per-user daily token budget persisted
in PostgreSQL and checked pre-flight; `max_tokens` already set but input length
also needs a hard cap; per-user rate limits (SEC-07); a `FEATURE_AI` env flag so
operators can disable it; token counters in `/api/metrics`.

**Secondary.**
- `console.error("AI Generation Error:", error)`
  ([service.ts:40](src/lib/ai/service.ts#L40)) bypasses the redacting pino logger
  and may write prompt content — which is user note content — to stdout.
- `throw new Error("Failed to generate text")` discards the upstream status, so
  an OpenAI 429 or auth failure surfaces to users as a generic 500.
- **Prompt injection:** note content flows into prompts and results return to the
  canvas. Impact is bounded today (output becomes note text), but treat model
  output as untrusted before any future tool-calling.

---

## SEC-09 — Redis unavailability takes authentication down with it

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [account-lockout.ts:41-46](src/lib/auth/account-lockout.ts#L41-L46) |
| **Blocker** | No (documented trade-off) |

```ts
function redisFailure(error: unknown, operation: string): never | void {
  logger.warn({ error, operation }, "Login attempt store unavailable");
  if (process.env.NODE_ENV === "production") {
    throw new LockoutStoreUnavailableError();
  }
}
```

Every lockout path (`getLoginDelay`, `isAccountLocked`, `recordFailedAttempt`,
`clearFailedAttempts`) fails closed in production. A Redis blip therefore blocks
**all** logins, including the operator's.

Failing closed on a security control is defensible and appears deliberate. The
finding is that the blast radius is undocumented and there is no break-glass
path — during a Redis outage nobody can reach the app to fix it.

**Fix.** Keep fail-closed, but: document it in the runbook, alert on it
distinctly from generic 5xx, and consider a short in-process fallback window
(the in-memory store already exists) that fails closed only after N seconds of
sustained Redis failure.

---

## SEC-10 — Lockout is keyed per (account, IP), so distributed attempts bypass it

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [account-lockout.ts:33-39, 74-92](src/lib/auth/account-lockout.ts#L33-L39) |
| **Blocker** | No |

The lock lives on the `pair` key (`account:client`). The `account` key tracks
attempts but only ever produces a **delay**, capped at
`MAX_ACCOUNT_DELAY_MS = 2000`.

So an attacker distributing guesses across IPs never triggers a lockout — each
IP has its own counter — and pays at most 2 seconds per attempt. That 2 s is
also served by `await new Promise(setTimeout)` in `authorize()`, holding a
request slot rather than shedding load.

**Fix.** Add an account-level lockout threshold independent of client id (with a
higher bound to limit denial-of-service against a targeted user), and consider a
CAPTCHA or proof-of-work step past a threshold instead of a server-held sleep.

---

## SEC-11 — Malware scanning is off by default

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [upload/route.ts:214-232](src/app/api/v1/upload/route.ts#L214-L232), [env.ts:80](src/lib/env.ts#L80) |
| **Blocker** | No |

`UPLOAD_SCAN_URL` is optional and `UPLOAD_SCAN_REQUIRED` defaults to `"false"`,
so a stock production deployment does **no** AV scanning — `runMalwareScan`
returns immediately.

Content-level risk is well controlled (magic-byte validation, declared-type
cross-check, no SVG, private storage, `Content-Disposition: attachment`,
`nosniff`), so uploaded files are unlikely to execute against this origin. The
real exposure is Memoria acting as a **hosting and distribution point for
malware** shared between collaborators.

**Fix.** Make `UPLOAD_SCAN_REQUIRED=true` the documented production default and
ship a ClamAV service in the reference compose stack. The scanning code is
already written — only the default and the stack entry are missing.

---

## SEC-12 — Upload body is fully buffered before the size check

| | |
| --- | --- |
| **Severity** | Medium |
| **Location** | [upload/route.ts:288-323](src/app/api/v1/upload/route.ts#L288-L323) |
| **Blocker** | No |

`await request.formData()` (L290) materialises the entire request body before
`file.size > MAX_FILE_SIZE` is evaluated at L316. A client can send a 500 MB body
and force the server to buffer all of it before rejection.

`uploadRateLimit` (10/hour) bounds the frequency, and it is per-IP (SEC-07), so a
handful of hosts can sustain memory pressure on the single stateful Node process.

**Fix.** Reject on `Content-Length` before parsing, and set `bodyParser`/route
size limits so the runtime refuses oversized bodies at the boundary.

---

## SEC-13 — Third-party analytics on a self-hosted, privacy-positioned product

| | |
| --- | --- |
| **Severity** | Low |
| **Location** | [layout.tsx:62](src/app/layout.tsx#L62) |
| **Blocker** | No |

`<Analytics />` from `@vercel/analytics` is mounted in the root layout of an
application whose README states the primary target is self-host/VPS and whose
service worker is explicitly documented as "privacy-preserving".

Every self-hosted install ships beacons to Vercel by default. Operators are not
told, and there is no opt-out flag.

**Fix.** Gate on an explicit `NEXT_PUBLIC_ENABLE_ANALYTICS` env var, default off,
and document it. Note this also interacts with SEC-05: tightening `connect-src`
will break the beacon, which is arguably the correct outcome.

---

## Summary

| ID | Severity | Title | Blocker |
| --- | --- | --- | --- |
| SEC-01 | High | Login reveals account existence pre-password | **Yes** |
| SEC-03 | High | `shareToken` leaked to VIEW collaborators | **Yes** |
| SEC-08 | High | AI endpoints have no per-user cost ceiling | **Yes** (if AI on) |
| SEC-02 | Medium | Registration enumeration | No |
| SEC-04 | Medium | Missing `Vary: Origin` | No |
| SEC-05 | Medium | `connect-src`/`img-src` allow any HTTPS host | No |
| SEC-06 | Medium | Query cache survives sign-out | No |
| SEC-07 | Medium | Rate limits keyed by IP only | No |
| SEC-09 | Medium | Redis outage blocks all logins | No |
| SEC-10 | Medium | Lockout bypassable by distributing attempts | No |
| SEC-11 | Medium | Malware scanning off by default | No |
| SEC-12 | Medium | Upload buffered before size check | No |
| SEC-13 | Low | Vercel analytics on self-host builds | No |

### Recommended order

1. **SEC-01** and **LOG-03** together — both are in `authorize()`.
2. **SEC-03** — add `select`, then grep for other bare row spreads.
3. **SEC-08** — decide whether AI ships at all; if yes, quotas are mandatory.
4. **SEC-04**, **SEC-06** — small, high-value, low-risk.
5. **SEC-02**, **SEC-07**, **SEC-10** — the enumeration/abuse cluster.
6. **SEC-05**, **SEC-11**, **SEC-12**, **SEC-13** — hardening pass.

### Not assessed

No dynamic testing, dependency CVE review (CI covers this), secret scanning of
git history, or review of `/api/agent/v1/*` authorization depth beyond its
route-level checks. The agent control plane handles BYOK credentials and signed
outbound webhooks and deserves a dedicated review before it is exposed.
