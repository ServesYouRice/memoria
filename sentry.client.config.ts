/** Browser telemetry is opt-in through an explicit public DSN. */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: process.env.NODE_ENV === "production" && Boolean(dsn),
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
