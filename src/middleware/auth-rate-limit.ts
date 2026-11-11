const SENSITIVE_V1_AUTH_ROUTES = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/reset-password",
  "/api/v1/auth/send-verification",
  "/api/v1/auth/verify-email",
]);

/**
 * Better Auth endpoints that check a password, a one-time code, or a passkey
 * assertion. Better Auth's own in-process limiter is disabled
 * (`src/lib/auth/server.ts`), so this shared Redis-backed budget is the only
 * per-client limit in front of them.
 */
const SENSITIVE_BETTER_AUTH_ROUTES = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/passkey/verify-authentication",
  "/api/auth/passkey/verify-registration",
]);
const SENSITIVE_BETTER_AUTH_PREFIXES = ["/api/auth/two-factor/"];

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
 * Limit credential-changing operations without throttling the session reads
 * and sign-out requests used during normal page rendering.
 */
export function shouldApplyStrictAuthRateLimit(
  pathname: string,
  method: string,
): boolean {
  const upperMethod = method.toUpperCase();
  if (
    SENSITIVE_ACCOUNT_ROUTES.some(
      (route) => route.method === upperMethod && route.pathname === pathname,
    )
  ) {
    return true;
  }
  if (upperMethod !== "POST") return false;

  return (
    SENSITIVE_V1_AUTH_ROUTES.has(pathname) ||
    SENSITIVE_BETTER_AUTH_ROUTES.has(pathname) ||
    SENSITIVE_BETTER_AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
