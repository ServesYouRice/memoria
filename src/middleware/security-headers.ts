import { type NextResponse } from "next/server";
import { SECURITY_HEADERS } from "@/lib/security/headers";
import { HSTS_MAX_AGE_SECONDS } from "@/lib/constants";

/**
 * Apply security headers following ADR-0012
 */
export function applySecurityHeaders(
  response: NextResponse,
  options: { allowFraming?: boolean } = {},
): void {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Verified embeds are framed by their allow-listed origins via CSP
  // `frame-ancestors`; X-Frame-Options has no allow-list syntax, so drop it.
  if (options.allowFraming) {
    response.headers.delete("X-Frame-Options");
  }

  // Strict-Transport-Security: Force HTTPS in production
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains; preload`,
    );
  }
}
