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

type LoggerLike = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  fatal?: (...args: unknown[]) => void;
};

const APPROVED_NEXT_AUTH_VERSION = "5.0.0-beta.31";

async function checkNextAuthVersion(logger: LoggerLike): Promise<void> {
  try {
    const packageJsonModule = await import("../package.json");
    const packageJson = (packageJsonModule.default ?? packageJsonModule) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const nextAuthVersion =
      packageJson.dependencies?.["next-auth"] ??
      packageJson.devDependencies?.["next-auth"];

    if (
      typeof nextAuthVersion === "string" &&
      nextAuthVersion.includes("beta")
    ) {
      const exactPinMessage =
        nextAuthVersion === APPROVED_NEXT_AUTH_VERSION
          ? `Auth.js is intentionally exact-pinned to next-auth@${nextAuthVersion} because the Next.js package still ships on the beta track upstream.`
          : `Unexpected next-auth beta version detected: next-auth@${nextAuthVersion}. Expected ${APPROVED_NEXT_AUTH_VERSION}.`;

      logger.warn(exactPinMessage);
      console.warn("");
      console.warn("WARNING: NextAuth beta in use");
      console.warn(`Current version: next-auth@${nextAuthVersion}`);
      if (nextAuthVersion === APPROVED_NEXT_AUTH_VERSION) {
        console.warn(
          `This build intentionally exact-pins next-auth@${APPROVED_NEXT_AUTH_VERSION}. Keep auth regression coverage green before changing it.`,
        );
      } else {
        console.warn(
          `This repo expects next-auth@${APPROVED_NEXT_AUTH_VERSION}. Review auth behavior before deploying this unexpected beta.`,
        );
      }
      console.warn("");
    }
  } catch (error) {
    logger.warn("Failed to check NextAuth version", error);
  }
}

export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const [{ createLogger }, { validateCorsConfig }] = await Promise.all([
      import("./lib/logger"),
      import("./middleware/cors"),
    ]);

    const logger = createLogger("global-error-handler");

    await import("./lib/env");
    await import("../sentry.server.config");

    await checkNextAuthVersion(logger);

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

        if (process.env.NODE_ENV === "production") {
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
        const Sentry = await import("@sentry/nextjs");
        Sentry.captureException(error);
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

    logger.info("Global error handlers registered (with Sentry integration)");
  }

  if (process.env["NEXT_RUNTIME"] === "edge") {
    await import("../sentry.edge.config");
  }
}
