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

interface ProcessErrorLogger {
  error: (payload: unknown, message?: string) => void;
  warn: (message: string) => void;
  fatal?: (message: string) => void;
}

export interface ProcessErrorHandlerOptions {
  logger: ProcessErrorLogger;
  sentryEnabled: boolean;
  isProduction: boolean;
  loadSentry: () => Promise<{ captureException: (error: unknown) => unknown }>;
  exit: (code: number) => void;
  isClientAbortError: (error: unknown) => boolean;
}

/**
 * Copy a value into something any serializer can write: bigint becomes a
 * string and a repeated object becomes "[Circular]". Errors keep their name,
 * message, stack and own enumerable fields.
 */
export function toLoggableValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => toLoggableValue(entry, seen));
  }
  const copy: Record<string, unknown> = {};
  if (value instanceof Error) {
    copy.name = value.name;
    copy.message = value.message;
    copy.stack = value.stack;
  }
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = toLoggableValue(entry, seen);
  }
  return copy;
}

function safeLogError(
  logger: ProcessErrorLogger,
  payload: () => Record<string, unknown>,
  message: string,
  fallback: unknown,
) {
  try {
    logger.error(payload(), message);
  } catch {
    try {
      console.error(message, String(fallback));
    } catch {
      // Nothing left to report to.
    }
  }
}

async function safeCapture(
  options: ProcessErrorHandlerOptions,
  error: unknown,
): Promise<void> {
  if (!options.sentryEnabled) return;
  try {
    const Sentry = await options.loadSentry();
    Sentry.captureException(error);
  } catch {
    // Telemetry failure must not hide the original error or block exit.
  }
}

export function createUnhandledRejectionHandler(
  options: ProcessErrorHandlerOptions,
) {
  return async (reason: unknown, promise: Promise<unknown>): Promise<void> => {
    safeLogError(
      options.logger,
      () => ({
        reason: toLoggableValue(reason),
        promise: String(promise),
        stack: reason instanceof Error ? reason.stack : undefined,
      }),
      "Unhandled Promise Rejection",
      reason,
    );
    if (options.sentryEnabled) {
      await safeCapture(options, reason);
      try {
        console.error("CRITICAL: Unhandled Promise Rejection:", reason);
      } catch {
        // console may be closed during shutdown.
      }
    }
  };
}

export function createUncaughtExceptionHandler(
  options: ProcessErrorHandlerOptions,
) {
  return async (error: Error): Promise<void> => {
    if (options.isClientAbortError(error)) {
      options.logger.warn(
        "Client aborted a request before its body was consumed",
      );
      return;
    }

    try {
      safeLogError(
        options.logger,
        () => ({ error: toLoggableValue(error), stack: error?.stack }),
        "Uncaught Exception",
        error,
      );
      if (options.isProduction) {
        await safeCapture(options, error);
        try {
          console.error("CRITICAL: Uncaught Exception:", error);
          options.logger.fatal?.("Exiting due to uncaught exception");
        } catch {
          // Exit below regardless.
        }
      }
    } finally {
      if (options.isProduction) options.exit(1);
    }
  };
}

/**
 * Next.js calls this for errors thrown while rendering or handling a request
 * on the server (the ones users see only as a digest). Sentry is loaded
 * lazily, and only when server telemetry is enabled.
 */
export async function onRequestError(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  if (process.env.NODE_ENV !== "production" || !process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(error, request, context);
  } catch {
    // Telemetry failure must not affect the response.
  }
}

export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const sentryEnabled =
      process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN);
    const [{ createLogger }, { validateCorsConfig }, { isClientAbortError }] =
      await Promise.all([
        import("./lib/logger"),
        import("./middleware/cors"),
        import("./lib/network/client-abort"),
      ]);

    const logger = createLogger("global-error-handler");

    await import("./lib/env");
    if (sentryEnabled) await import("../sentry.server.config");

    validateCorsConfig();

    const loadSentry = () => import("@sentry/nextjs");
    const isProduction = process.env.NODE_ENV === "production";
    process.on(
      "unhandledRejection",
      createUnhandledRejectionHandler({
        logger,
        sentryEnabled,
        isProduction,
        loadSentry,
        exit: (code) => process.exit(code),
        isClientAbortError,
      }),
    );
    process.on(
      "uncaughtException",
      createUncaughtExceptionHandler({
        logger,
        sentryEnabled,
        isProduction,
        loadSentry,
        exit: (code) => process.exit(code),
        isClientAbortError,
      }),
    );

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
