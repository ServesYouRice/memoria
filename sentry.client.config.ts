/**
 * Browser telemetry. Loaded only by `src/instrumentation-client.ts`, and only
 * when the server rendered a browser DSN into the page (IMP-116, IMP-151).
 */
import * as Sentry from "@sentry/nextjs";
import type { BrowserSentryConfig } from "@/lib/telemetry/browser-sentry";

export function initBrowserSentry(config: BrowserSentryConfig): void {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    enabled: process.env.NODE_ENV === "production" && Boolean(config.dsn),
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      if (event.exception?.values?.[0]?.value?.includes("ResizeObserver")) {
        return null;
      }
      return event;
    },
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
      }),
    ],
  });
}
