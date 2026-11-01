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
 * Limit credential-changing operations without throttling the session reads
 * and sign-out requests used during normal page rendering.
 */
export function shouldApplyStrictAuthRateLimit(
  pathname: string,
  method: string,
): boolean {
  if (method.toUpperCase() !== "POST") return false;

  return (
    SENSITIVE_V1_AUTH_ROUTES.has(pathname) ||
    SENSITIVE_BETTER_AUTH_ROUTES.has(pathname) ||
    SENSITIVE_BETTER_AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}
