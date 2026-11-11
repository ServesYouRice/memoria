/**
 * Next.js client instrumentation (src/, next to the app directory).
 *
 * Next.js runs this before the app hydrates. It loads the browser Sentry
 * config, whose single Sentry.init stays disabled unless the build is a
 * production build with NEXT_PUBLIC_SENTRY_DSN set.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
 */
import "../sentry.client.config";
