/**
 * Sentry Edge Configuration
 * This file configures the Sentry SDK for Edge Runtime (middleware).
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // Only enable in production
    enabled: process.env.NODE_ENV === "production",

    // Adjust sample rate in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
});
