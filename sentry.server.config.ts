/**
 * Sentry Server Configuration
 * This file configures the Sentry SDK for the Node.js server.
 *
 * To enable Sentry, set the SENTRY_DSN environment variable.
 * Get your DSN from: https://sentry.io/settings/projects/YOUR_PROJECT/keys/
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,

  // Server telemetry is opt-in through an explicit DSN.
  enabled: process.env.NODE_ENV === "production" && Boolean(dsn),

  // Adjust sample rate in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Useful for debugging issues
  debug: false,

  // Capture unhandled promise rejections
  beforeSend(event) {
    // Filter out common noise
    if (event.exception?.values?.[0]?.value?.includes("ECONNREFUSED")) {
      return null;
    }
    return event;
  },
});
