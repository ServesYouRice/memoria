/**
 * Sentry Edge Configuration
 * This file configures the Sentry SDK for Edge Runtime (middleware).
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,

  // Edge telemetry is opt-in through an explicit DSN.
  enabled: process.env.NODE_ENV === "production" && Boolean(dsn),

  // Adjust sample rate in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
});
