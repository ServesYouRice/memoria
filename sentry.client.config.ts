/**
 * Sentry Client Configuration
 * This file configures the Sentry SDK for the browser.
 *
 * To enable Sentry, set the NEXT_PUBLIC_SENTRY_DSN environment variable.
 * Get your DSN from: https://sentry.io/settings/projects/YOUR_PROJECT/keys/
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',

    // Only enable in production
    enabled: process.env.NODE_ENV === "production",

    // Adjust sample rate in production
    // Set to 1.0 to capture 100% of transactions for development
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Session replay for debugging (optional, can be expensive)
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Don't send transactions for static assets
    beforeSend(event) {
        // Filter out common noise
        if (event.exception?.values?.[0]?.value?.includes("ResizeObserver")) {
            return null;
        }
        return event;
    },

    // Capture console errors
    integrations: [
        Sentry.replayIntegration({
            // Mask all text and inputs for privacy
            maskAllText: true,
            maskAllInputs: true,
        }),
    ],
});
