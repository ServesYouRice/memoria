# Security Audit — Memoria

Context: the codebase already implements an unusually strong baseline — Argon2id everywhere (passwords, API keys), nonce-based strict CSP with `strict-dynamic`, SSRF-protected unfurling with DNS checks, timing-safe bootstrap token comparison, dummy-hash verification to prevent user-enumeration timing, session-version revocation, encrypted BYOK credentials, signed outbound webhooks, and production env invariants. The findings below are the residual gaps.

---

## S-1 — All IP-based abuse controls trust `socket.remoteAddress` with no reverse-proxy support

- **Severity:** High
- **Location:** `server.ts:28-30` (sets `x-memoria-client-ip` from `req.socket.remoteAddress`), `src/lib/rate-limit/index.ts:230-234` and `src/middleware/rate-limit.ts:24-28` (`getClientIdentifier`), all limiter uses in `src/proxy.ts`
- **Description:** The design deliberately ignores `X-Forwarded-For` ("the reference deployment is directly reachable"). But the production model is a Node server on port 3000 with `AUTH_URL` typically `https://…` — TLS has to terminate somewhere, and in virtually every real self-host (Caddy/nginx/Traefik/Cloudflare, or Docker on a host with a proxy) the app sees the proxy's IP for **every** client. Consequences:
  - One noisy user consumes the shared IP budget: auth (5/min), uploads (10/hour), API (100/min) → **instance-wide denial of service by normal usage**.
  - Per-IP auth throttling stops distinguishing attackers from victims, so brute-force protection degrades to the email-keyed lockout only (see S-3).
  - Additionally, when running via `next dev`/any path that bypasses `server.ts`, the header is absent and every client shares the `"unknown"` bucket.
- **Why it matters for production:** This isn't an edge case — it is the *default* topology for the product's own target deployment. The failure mode is silent (metrics just show 429s).
- **Recommended fix:** Add a `TRUSTED_PROXY_HOPS` (or `TRUST_PROXY=cidr,list`) env; when set, derive the client IP from the rightmost untrusted entry of `X-Forwarded-For` in `server.ts` (keep the header-overwrite defense otherwise). Document it in `.env.example` and have `pnpm doctor` warn when `AUTH_URL` is https but no trust config is set. Simultaneously key user-scoped endpoints by session user ID (the dead `endpoint-limits.ts` already models this — see L-2).
- **Blocker:** **Yes** for any deployment behind a proxy, i.e. essentially all of them.
- **Related risks:** L-1 multiplies this (image reads share the 10/hour bucket per proxy IP).

## S-2 — Self-hosted instances have open registration with no disable flag

- **Severity:** High (deployment-model dependent)
- **Location:** `src/app/api/v1/auth/register/route.ts` (no gating), `src/lib/env.ts` (no `REGISTRATION_*` variable; verified by grep), `src/app/auth/register/page.tsx` (public)
- **Description:** After first-run bootstrap, anyone who can reach the instance can create an account (in production they must verify an email — which the instance will happily send them). There is no `DISABLE_REGISTRATION` / invite-only mode / allowed-domain list. For a personal or team self-host on the public internet, strangers can register, consume storage quota (100 MB each), AI routes (BYOK-gated, but the shared `OPENAI_API_KEY` env is also supported), and collaboration resources.
- **Why it matters:** The stated production model is exactly this: a self-hosted, internet-reachable box. Uninvited account creation is both an abuse and a cost problem, and most self-host admins will assume it's closed by default.
- **Recommended fix:** Add `REGISTRATION_MODE=open|invite|closed` (default `closed` after bootstrap for selfhost setup, `open` for dev), enforce in the register route and hide the register UI accordingly. An allowed-email-domain list is a cheap complement.
- **Blocker:** **Yes** for the self-host launch story.

## S-3 — Account lockout is keyed by email alone → trivial targeted lockout DoS

- **Severity:** Medium–High
- **Location:** `src/lib/auth/account-lockout.ts:20-22` (`auth:lockout:${email}`), threshold 5 attempts / 15 min lock, recorded for unknown users too (`src/lib/auth.ts:61-68`)
- **Description:** Anyone who knows a victim's email can send 5 wrong passwords and lock the account for 15 minutes, repeatable indefinitely (and cheaply scripted within the auth rate limit, especially once S-1 collapses IP buckets). The victim's *correct* password is rejected during lockout with no notification or self-service recovery.
- **Recommended fix:** Standard mitigations, pick at least one: (a) key hard lockout to email+IP and apply only escalating delays (not hard lock) for email-only signals; (b) allow login attempts with correct credentials to clear/bypass email-keyed lockout after a CAPTCHA; (c) notify the account owner by email on lockout with a secure unlock link.
- **Blocker:** Should be fixed before launch; actual exploitation requires knowing target emails, but those are shared in the product's own collaboration flow.
- **Related:** L-3 (fails open on Redis error — the two together mean the control is both bypassable and abusable).

## S-4 — Read-only viewers and anonymous guests can broadcast arbitrary payloads to all canvas collaborators

- **Severity:** Medium
- **Location:** `src/lib/collaboration/websocket-server.ts:672-694` (`case "message"` has no `accessLevel` gate), guest path `:352-368` (cookie-less users on public canvases get `VIEW` and full message rights), schema `:71-79` (`payload: z.record(z.unknown())` — any keys)
- **Description:** The share model (VIEW/COMMENT/EDIT) is not enforced for realtime `message` broadcasts. VIEW users and anonymous guests can push 8 KB arbitrary-JSON payloads at 600 msgs/min each to every connected client. The client components (CursorChat/RemoteReaction, React-rendered) escape text, so this is spam/DoS and client-logic abuse (unexpected `payload` keys reach all peers' handlers) rather than XSS — but it directly contradicts the advertised permission model.
- **Recommended fix:** Require `accessLevel` ≥ COMMENT for `message` type; validate the payload against a closed schema (chat text / reaction enum) instead of `z.record(z.unknown())`; drop guest messaging.
- **Blocker:** No, but before promoting public canvases.

## S-5 — No cross-canvas or per-IP WebSocket connection budget for guests

- **Severity:** Medium
- **Location:** `src/lib/collaboration/websocket-server.ts:44` (`MAX_COLLABORATORS_PER_CANVAS = 100` is the only cap); upgrade path does no per-IP accounting
- **Description:** An unauthenticated client can open up to 100 sockets on *each* public canvas (and canvas IDs of public boards are discoverable from share pages). Each socket costs heartbeat DB queries (L-5) and Redis fanout. There is no per-IP/per-user global socket cap, and the HTTP rate limiter does not see upgrade requests (they bypass `proxy.ts`).
- **Recommended fix:** Track sockets per client IP (respecting the S-1 proxy fix) with a small cap (e.g. 10), and a global server cap; rate-limit upgrade attempts in `server.ts`.
- **Blocker:** No.

## S-6 — Public share tokens are never rotated; disabling sharing does not invalidate the URL

- **Severity:** Medium
- **Location:** `src/app/api/v1/canvases/[canvasId]/public/route.ts:39` (`canvas.shareToken || nanoid(16)`), DELETE `:96-101` (keeps token)
- **Description:** `nanoid(16)` (~95 bits) is unguessable, but the token is permanent: turn public off → link 403s; turn public on again (even much later) → the **old leaked link works again**. There is also no way for the owner to rotate a token that leaked while sharing stays on.
- **Recommended fix:** Null the token (or rotate) on disable by default; add an explicit "reset link" action. Keep an opt-in "keep same link".
- **Blocker:** No (document behavior in UI meanwhile — UI-10).

## S-7 — Missing `Strict-Transport-Security` header

- **Severity:** Medium
- **Location:** `src/lib/security/headers.ts:14-30` (`SECURITY_HEADERS` has no HSTS), `src/middleware/security-headers.ts`
- **Description:** The app sets a thorough header set but never emits HSTS. Since TLS is terminated by the operator's proxy, the app can't be certain of HTTPS — but it knows `AUTH_URL`; when that is `https:`, emitting `Strict-Transport-Security: max-age=15552000; includeSubDomains` is safe and protects session cookies from downgrade.
- **Recommended fix:** Add HSTS conditionally on `AUTH_URL` scheme; document that operators may also set it at the proxy.
- **Blocker:** No.

## S-8 — Deprecated `X-XSS-Protection: 1; mode=block` header

- **Severity:** Low
- **Location:** `src/lib/security/headers.ts:17`
- **Description:** The XSS auditor is removed from all modern browsers; `1; mode=block` historically *introduced* infoleak side channels in old ones. Current guidance (OWASP) is `X-XSS-Protection: 0` or omission when a strong CSP exists (it does).
- **Recommended fix:** Set to `0` or drop the header.
- **Blocker:** No.

## S-9 — CORS reflects credentials with env-driven origin list; localhost fallback in production

- **Severity:** Low
- **Location:** `src/middleware/cors.ts:40-49` (production default origin falls back to `"https://localhost:3000"` when `AUTH_URL` unset — can't happen when env validation runs, but the fallback masks misconfig), `CORS_ALLOW_CREDENTIALS` defaults to `true`
- **Description:** Defaults are same-origin-only, which is correct. Risk is operational: if an operator sets `CORS_ALLOWED_ORIGINS` broadly (e.g. `*` or a staging domain) the credentials flag makes it dangerous, and nothing validates the combination (`*` + credentials is browser-rejected, but `https://staging.example.com` + credentials is silently accepted).
- **Recommended fix:** Log a startup warning when `CORS_ALLOWED_ORIGINS` contains origins other than `AUTH_URL` while credentials are enabled; reject `*` explicitly.
- **Blocker:** No.

## S-10 — Legacy plaintext API-key comparison is not constant-time and plaintext keys persist until first use

- **Severity:** Low
- **Location:** `src/lib/api/api-key-auth.ts:96-101` (`apiKey.key === header` for legacy rows; the code's own comment acknowledges it), upgrade-on-use path below it
- **Description:** Argon2 hashing for new keys is right. Legacy rows: (a) remain plaintext at rest until the key is next used; (b) are compared with `===` (timing side channel is largely mitigated by the prefix/suffix DB filter, so practical exploitability is very low). Since this is a pre-launch product, there may be no real legacy keys at all.
- **Recommended fix:** Run a one-time migration hashing all remaining plaintext rows (a script can verify-by-format), then delete the legacy branch entirely.
- **Blocker:** No.

## S-11 — SSRF protection: verify redirect/DNS re-resolution and IPv6-mapped forms are covered before exposing unfurl more broadly

- **Severity:** Medium (verification item)
- **Location:** `src/lib/utils/ssrf-protection.ts` (private ranges, blocked hostnames, IPv6 checks reviewed; `safeFetch` supports `maxRedirects: 5` per `src/app/api/v1/unfurl/route.ts:23`)
- **Description:** The blocklist is solid for the common cases (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, fe80::, fc00::/7, `::ffff:127.0.0.1`). Residual classes to verify with tests: (a) **DNS rebinding** — is the IP checked *per redirect hop* and is the connection pinned to the vetted IP (or could a second resolution reach a private address)? (b) decimal/octal IPv4 forms (`http://2130706433/`, `0x7f000001`), which `net.isIP` does not flag and the regexes don't match — these depend on how `URL`+`dns.resolve` normalize; (c) `::ffff:10.0.0.1`-style mapped addresses beyond the single hard-coded `::ffff:127.0.0.1`. The cron route also unfurls **stored** bookmark URLs with the same `safeFetch` (good), so any gap is reachable by saving a bookmark and waiting for the scheduler.
- **Recommended fix:** Add unit tests for the cases above; pin the socket to the resolved-and-vetted IP (undici `connect` hook or resolve-then-fetch-by-IP with `Host` header); normalize mapped IPv6 before pattern checks.
- **Blocker:** No, but do the test pass before increasing unfurl usage (agent flows fetch external content too).

## S-12 — Delivery/atomicity gap on outbound webhooks (known: SEC-12)

- **Severity:** High (tracked)
- **Location:** `REMAINING-WORK.md` SEC-12; agent webhook execution path
- **Description:** Already documented by the team: DB commit and network delivery are not atomic; needs a transactional outbox + retry worker. Repeated here only so this audit is a complete launch checklist — approved external actions can be lost or double-fired across a crash.
- **Blocker:** Yes if agent external actions are enabled for launch; otherwise gate the feature off.

---

## Priority order (security only)

1. **S-1** proxy-aware client IP + per-user rate keys — everything else assumes abuse controls actually work.
2. **S-2** registration gating for self-host.
3. **S-3** lockout DoS mitigation (with L-3 fail-closed fix).
4. **S-12** webhook outbox (or feature-gate agent external actions at launch).
5. **S-4/S-5** realtime permission gate + connection budgets before promoting public canvases.
6. **S-6/S-7** token rotation + HSTS.
7. **S-8/S-9/S-10/S-11** hygiene and verification items.
