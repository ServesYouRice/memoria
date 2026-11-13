/**
 * Strict auth route groups. Each group has its own per-IP bucket
 * (`src/middleware/rate-limit.ts`), so spending one step's budget — say,
 * password sign-in — does not lock the same IP out of registration, password
 * reset or email verification.
 */
export const AUTH_RATE_LIMIT_GROUPS = [
  "sign-in",
  "two-factor",
  "passkey",
  "registration",
  "password-reset",
  "email-verification",
  "account",
] as const;
export type AuthRateLimitGroup = (typeof AUTH_RATE_LIMIT_GROUPS)[number];

/**
 * POST routes, by exact path. Better Auth endpoints here check a password, a
 * one-time code, or a passkey assertion. Better Auth's own in-process limiter
 * is disabled (`src/lib/auth/server.ts`), so this shared Redis-backed budget
 * is the only per-client limit in front of them.
 */
const SENSITIVE_POST_ROUTES = new Map<string, AuthRateLimitGroup>([
  ["/api/v1/auth/register", "registration"],
  ["/api/v1/auth/forgot-password", "password-reset"],
  ["/api/v1/auth/reset-password", "password-reset"],
  ["/api/v1/auth/send-verification", "email-verification"],
  ["/api/v1/auth/verify-email", "email-verification"],
  ["/api/auth/sign-in/email", "sign-in"],
  // IMP-099: starting sign-in with an existing login system.
  ["/api/auth/sign-in/social", "sign-in"],
  ["/api/auth/passkey/verify-authentication", "passkey"],
  ["/api/auth/passkey/verify-registration", "passkey"],
]);
const SENSITIVE_POST_PREFIXES: ReadonlyArray<[string, AuthRateLimitGroup]> = [
  ["/api/auth/two-factor/", "two-factor"],
];

/**
 * Account routes that verify the current password (Argon2). Matched on the
 * exact method and path so the account exports and other reads stay out.
 */
const SENSITIVE_ACCOUNT_ROUTES: ReadonlyArray<{
  method: string;
  pathname: string;
}> = [
  { method: "POST", pathname: "/api/v1/users/change-password" },
  { method: "DELETE", pathname: "/api/v1/users/account" },
];

/**
 * The strict auth group a request belongs to, or null when it is not
 * strictly limited (session reads, sign-out and other normal traffic).
 */
export function strictAuthRateLimitGroup(
  pathname: string,
  method: string,
): AuthRateLimitGroup | null {
  const upperMethod = method.toUpperCase();
  if (
    SENSITIVE_ACCOUNT_ROUTES.some(
      (route) => route.method === upperMethod && route.pathname === pathname,
    )
  ) {
    return "account";
  }
  if (upperMethod !== "POST") return null;

  const exact = SENSITIVE_POST_ROUTES.get(pathname);
  if (exact) return exact;
  for (const [prefix, group] of SENSITIVE_POST_PREFIXES) {
    if (pathname.startsWith(prefix)) return group;
  }
  return null;
}

/**
 * Limit credential-changing operations without throttling the session reads
 * and sign-out requests used during normal page rendering.
 */
export function shouldApplyStrictAuthRateLimit(
  pathname: string,
  method: string,
): boolean {
  return strictAuthRateLimitGroup(pathname, method) !== null;
}
