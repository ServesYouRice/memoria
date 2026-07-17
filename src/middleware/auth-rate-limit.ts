const SENSITIVE_V1_AUTH_ROUTES = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/reset-password",
  "/api/v1/auth/send-verification",
  "/api/v1/auth/verify-email",
]);

/**
 * Limit credential-changing operations without throttling Auth.js session,
 * CSRF, and provider discovery requests used during normal page rendering.
 */
export function shouldApplyStrictAuthRateLimit(
  pathname: string,
  method: string,
): boolean {
  if (method.toUpperCase() !== "POST") return false;

  return (
    SENSITIVE_V1_AUTH_ROUTES.has(pathname) ||
    pathname === "/api/auth/callback/credentials"
  );
}
