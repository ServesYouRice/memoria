/**
 * The SMTP password from the environment. SMTP_PASSWORD is an alias for
 * SMTP_PASS, which wins when both are set. env.ts validates this value and
 * the email module sends it, so both read it here.
 */
export function resolveSmtpPassword(
  source: Record<string, string | undefined>,
): string | undefined {
  return source.SMTP_PASS ?? source.SMTP_PASSWORD;
}
