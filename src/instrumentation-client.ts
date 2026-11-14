/**
 * Next.js client instrumentation (src/, next to the app directory).
 *
 * Next.js runs this before the app hydrates. Browser telemetry is opt-in:
 * only a production build with NEXT_PUBLIC_SENTRY_DSN set loads the Sentry
 * config, and it loads as its own chunk. The public DSN is inlined at build
 * time, so a build without one carries no Sentry code in the JavaScript
 * every page loads (IMP-116: that code was most of the shared budget).
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
 */
const sentryEnabled =
  process.env.NODE_ENV === "production" &&
  Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (sentryEnabled) void import("../sentry.client.config");
