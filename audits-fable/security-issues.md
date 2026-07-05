# Security Issues

Severity: Critical / High / Medium / Low. "Blocker" = should not launch without fixing.

---

## S-1. CORS: any origin with no `Origin` header is allowed in production paths, and wildcard-subdomain matching is unanchored

- **Severity:** High
- **Location:** `src/middleware/cors.ts:83-106`
- **Problem:** Two issues:
  1. `isOriginAllowed(null, …)` returns `true` only in development — good — but the wildcard matcher `origin.endsWith(domain)` for a config entry like `*.example.com` (domain = `example.com`) also matches `evil-example.com` and `notexample.com` because there's no leading-dot / boundary check.
  2. `Access-Control-Allow-Credentials: true` is combined with a reflected origin; if an operator ever sets `CORS_ALLOWED_ORIGINS=*` the validator only *warns* and still reflects, which with credentials is a serious cross-origin data-exposure config footgun.
- **Fix:** Anchor wildcard matches to `.` + domain (or exact suffix with a dot); refuse to start (not warn) if credentials + wildcard are configured together.
- **Blocker:** Yes if any non-default `CORS_ALLOWED_ORIGINS` is used.

## S-2. Rate-limit identifier is a spoofable header and collapses to a shared bucket

- **Severity:** High
- **Location:** `src/middleware/rate-limit.ts:40-47`, `src/lib/rate-limit/index.ts:221-237`
- **Problem:** Client identity = first value of `x-forwarded-for` (client-controlled) or the literal `"unknown"`. An attacker rotates `X-Forwarded-For` to get unlimited attempts; legitimate users behind a proxy that doesn't set the header all share the `"unknown"` bucket (see L-2/L-3). Brute-force protection on `/auth` is therefore both bypassable and self-DoSing.
- **Fix:** Trust only a configured proxy hop count; derive IP from the connection when the header is absent; never key on a constant.
- **Blocker:** Yes.

## S-3. WebSocket messages are unvalidated, unauthorized, and leak emails

- **Severity:** High
- **Location:** `src/lib/collaboration/websocket-server.ts:610-773`
- **Problem:** (a) `type: "message"` (chat/reactions) is broadcast verbatim with no schema/size validation and **no permission check** — VIEW-only shares and anonymous guests on public canvases can spam every participant, and payloads are echoed to clients (stored XSS risk if a client renders unsanitized fields — `RemoteCursorChat` renders `message.content`). (b) Presence broadcasts every user's **email address** to all connected clients including public-canvas guests. (c) `cursor`/`awareness` messages are unvalidated.
- **Fix:** Zod-validate every inbound WS frame; enforce COMMENT+ for chat/reactions; cap payload size and rate (chat separate from Yjs); remove email from presence (name + color only); sanitize any client-rendered strings.
- **Blocker:** Yes for public/shared canvases.

## S-4. Public share endpoint leaks full item content and infrastructure URLs

- **Severity:** Medium
- **Location:** `src/app/api/v1/share/[token]/route.ts:23-57`, WS guest path `websocket-server.ts:371-391`
- **Problem:** `GET /api/v1/share/[token]` returns all items including any private notes/images on the canvas (by design for public canvases) — but there is no field filtering, so `content` may include internal image URLs, `createdById`, tags, etc. Public canvases also accept anonymous WS connections (guests), exposing presence/chat. Owner name is returned (acceptable) but ensure no PII beyond that.
- **Fix:** Return a projected read-only shape; scrub internal identifiers; confirm public-share exposure is intentional and documented.
- **Blocker:** No, but review before enabling public sharing.

## S-5. Model-credential encryption falls back to `AUTH_SECRET`

- **Severity:** Medium
- **Location:** `src/lib/agents/crypto.ts:9-13` (`MODEL_CREDENTIAL_ENCRYPTION_KEY || AUTH_SECRET`), env schema makes the key optional
- **Problem:** BYOK provider secrets (OpenAI/Anthropic keys, etc.) are AES-256-GCM encrypted with a key derived from `MODEL_CREDENTIAL_ENCRYPTION_KEY`, but when unset it silently uses `AUTH_SECRET`. This couples secret-at-rest encryption to the session-signing secret: rotating `AUTH_SECRET` (a routine security action) makes all stored provider credentials undecryptable, and anyone with `AUTH_SECRET` (already sensitive) can decrypt them. The GCM implementation itself is correct.
- **Fix:** Require a dedicated `MODEL_CREDENTIAL_ENCRYPTION_KEY` in production (env `superRefine`), independent of `AUTH_SECRET`, and document rotation with re-encryption.
- **Blocker:** Yes if the agent/BYOK feature ships.

## S-6. `/setup` bootstrap: token compared non-constant-time; dev bypass keyed on hostname

- **Severity:** Medium
- **Location:** `src/app/api/setup/initialize/route.ts:22-45`
- **Problem:** (a) `providedToken !== expectedToken` is a non-constant-time string comparison of the bootstrap secret. (b) `isLocalDevelopmentRequest` bypasses the token entirely when `NODE_ENV !== production` and hostname is localhost — fine for dev, but the check trusts `request.nextUrl.hostname`, which can be influenced by the `Host` header behind some proxies; ensure `NODE_ENV` is authoritative. (c) `isBootstrapAvailable()` gates re-runs, but there's no rate limit on the setup route (auth RL doesn't cover `/api/setup`).
- **Fix:** Use `crypto.timingSafeEqual`; rely solely on `NODE_ENV` for the dev bypass; add rate limiting to `/api/setup/*`.
- **Blocker:** No (single-use, but harden it).

## S-7. API-key lookup relies on prefix/suffix and still supports plaintext legacy keys

- **Severity:** Medium
- **Location:** `src/lib/api/api-key-auth.ts:58-148`, schema `ApiKey.key @unique` (:359-374)
- **Problem:** Lookups filter by `keyPrefix`(7)+`keySuffix`(4); if several keys share those (birthday-ish for short suffixes, or legacy rows with null prefix/suffix), the code argon2-verifies each in a loop — acceptable, but the legacy branch does a **non-constant-time** `apiKey.key === header` plaintext compare and stores plaintext keys until first use. Also the `lastUsedAt`/upgrade update is fire-and-forget with a swallowed error, so upgrades can silently never happen.
- **Fix:** Migrate/expire all legacy plaintext keys before launch (one-off script), drop the plaintext branch; make the format pre-check mandatory; log upgrade failures.
- **Blocker:** No (only if legacy keys exist in the target DB).

## S-8. CSP allows `https:` broadly for images and connections; `report-uri` only

- **Severity:** Low-Medium
- **Location:** `src/middleware/csp.ts:15-33`
- **Problem:** `img-src` includes `https:` (any HTTPS host) and `connect-src` includes `https:` + `wss:` — reasonable for a bookmarking app that embeds arbitrary link images, but it broadens exfiltration surface. `report-uri` is deprecated (no `report-to`). `frame-src 'none'` will block the EMBED item type if that feature renders iframes.
- **Fix:** Acknowledge the trade-off explicitly; add `report-to`; verify EMBED items against `frame-src`.
- **Blocker:** No.

## S-9. Registration is open with no email-verification gate on login

- **Severity:** Medium (abuse/spam)
- **Location:** `src/app/api/v1/auth/register/route.ts`, `src/lib/auth.ts:49-78` (authorize doesn't check `emailVerified`)
- **Problem:** Anyone can register; login succeeds without verifying email (`authorize` never checks `user.emailVerified`). Combined with the ineffective rate limiting (S-2), this allows automated account creation and resource consumption. Email-verification tokens exist in the schema but aren't enforced.
- **Fix:** Decide the policy: gate login on `emailVerified` (or a grace period), add CAPTCHA/rate limiting to `/register`, consider invite-only for self-host.
- **Blocker:** No (depends on deployment model — a private self-host instance may want open registration off entirely).

## S-10. SSRF protection is solid but has a TOCTOU gap and doesn't cover the cron/unfurl body size on redirects

- **Severity:** Low-Medium
- **Location:** `src/lib/utils/ssrf-protection.ts:189-304`
- **Problem:** `safeFetch` validates DNS then fetches, but between the `dns.lookup` in `validateUrlForSsrfWithDns` and the actual `fetch`, DNS can rebind to a private IP (classic TOCTOU) because Node's fetch re-resolves. Redirects are re-validated (good), but only `content-length` header is trusted for the size cap on the first check (streaming cap exists, good). Reserved ranges like `100.64.0.0/10` (CGNAT) and IPv4-mapped edge cases aren't all covered.
- **Fix:** Pin the resolved IP and connect to it directly (custom agent/lookup), or use an egress proxy/allowlist; add CGNAT and `192.0.0.0/24`, `198.18.0.0/15` ranges.
- **Blocker:** No, but relevant since bookmarks/unfurl fetch user-supplied URLs server-side.

## S-11. Secrets and infra defaults committed in `.env.example` / compose

- **Severity:** Low
- **Location:** `.env.example` (minio `minioadmin/minioadmin123`, sample DB password), `docker-compose.yml` (same defaults with `:-` fallbacks)
- **Problem:** The compose file defaults every secret (`AUTH_SECRET`, `APP_BOOTSTRAP_TOKEN` have no default and will fail — good; but MinIO creds and DB password default to well-known values). A copy-paste self-host deploy runs with `minioadmin123` and a known DB password exposed on published ports `5432`/`6379`/`9000`.
- **Fix:** Remove weak defaults for anything network-exposed; don't publish DB/Redis ports by default; document required secret generation (the setup script does generate some — ensure it covers all).
- **Blocker:** No, but a real risk for naive self-hosters.

## S-12. Security headers are well-covered (positive finding) — minor notes

- **Severity:** Low (mostly informational)
- **Location:** `src/middleware/security-headers.ts`, `src/lib/security/headers.ts`
- **Status:** **Verified good.** The middleware sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and `Strict-Transport-Security` (`max-age; includeSubDomains; preload`) gated to production. CSP also sets `frame-ancestors 'none'`.
- **Minor notes:** `X-XSS-Protection: 1; mode=block` is deprecated and can introduce vulnerabilities in old browsers — modern guidance is to set it to `0` and rely on CSP. `Permissions-Policy` allows `camera=(self)` — confirm the app actually needs camera access (AR mode?); otherwise set to `()`.
- **Fix:** Optional: drop/zero `X-XSS-Protection`; tighten `camera` if unused.
- **Blocker:** No.

---

## Security summary

The security *foundations* are unusually good for this stage: argon2id hashing, account lockout, SSRF-aware unfurling, nonce CSP, AES-GCM credential encryption, RFC 7807 errors, ownership checks on data routes, idempotency. The exploitable gaps that matter most for launch are **the rate-limit design (S-2, ties to L-2/L-3), unvalidated/unauthorized WebSocket traffic with email leakage (S-3), CORS wildcard/credentials handling (S-1), and the credential-encryption key fallback (S-5)**. Fix those four before exposing the app to the internet.
