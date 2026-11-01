/**
 * Next.js Instrumentation (src/)
 *
 * Runs once at server startup. Use this to:
 * - Validate env vars (fail fast)
 * - Initialize server-only services
 * - Register global error handlers
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const sentryEnabled =
      process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN);
    const [{ createLogger }, { validateCorsConfig }] = await Promise.all([
      import("./lib/logger"),
      import("./middleware/cors"),
    ]);

    const logger = createLogger("global-error-handler");

    await import("./lib/env");
    if (sentryEnabled) await import("../sentry.server.config");

    validateCorsConfig();

    process.on(
      "unhandledRejection",
      async (reason: unknown, promise: Promise<unknown>) => {
        logger.error("Unhandled Promise Rejection");
        logger.error(
          JSON.stringify({
            reason,
            promise: String(promise),
            stack: reason instanceof Error ? reason.stack : undefined,
          }),
        );

        if (sentryEnabled) {
          const Sentry = await import("@sentry/nextjs");
          Sentry.captureException(reason);
          console.error("CRITICAL: Unhandled Promise Rejection:", reason);
        }
      },
    );

    process.on("uncaughtException", async (error: Error) => {
      logger.error("Uncaught Exception");
      logger.error(JSON.stringify({ error, stack: error.stack }));

      if (process.env.NODE_ENV === "production") {
        if (sentryEnabled) {
          const Sentry = await import("@sentry/nextjs");
          Sentry.captureException(error);
        }
        console.error("CRITICAL: Uncaught Exception:", error);
        if (logger.fatal) {
          logger.fatal("Exiting due to uncaught exception");
        }
        process.exit(1);
      }
    });

    process.on("warning", (warning: Error) => {
      logger.warn("Process Warning");
      logger.warn(
        JSON.stringify({
          name: warning.name,
          message: warning.message,
          stack: warning.stack,
        }),
      );
    });

    logger.info(
      sentryEnabled
        ? "Global error handlers registered with Sentry integration"
        : "Global error handlers registered without external telemetry",
    );
  }

  if (process.env["NEXT_RUNTIME"] === "edge") {
    if (process.env.NODE_ENV === "production" && process.env.SENTRY_DSN) {
      await import("../sentry.edge.config");
    }
  }
}
