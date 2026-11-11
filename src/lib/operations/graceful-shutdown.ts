/**
 * Ordered graceful shutdown for the HTTP server: stop accepting connections,
 * wait for in-flight requests, then close the database pool and exit. A single
 * deadline covers the whole sequence, including the disconnect.
 */

interface ShutdownLogger {
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
}

export interface GracefulShutdownOptions {
  closeServer: () => Promise<void>;
  disconnect: () => Promise<void>;
  exit: (code: number) => void;
  deadlineMs: number;
  logger: ShutdownLogger;
}

export function createGracefulShutdown({
  closeServer,
  disconnect,
  exit,
  deadlineMs,
  logger,
}: GracefulShutdownOptions): (signal: NodeJS.Signals) => Promise<void> {
  let shuttingDown = false;
  return async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");

    const deadline = setTimeout(() => {
      logger.error("Graceful shutdown deadline exceeded");
      exit(1);
    }, deadlineMs);
    deadline.unref?.();

    await closeServer();
    try {
      await disconnect();
    } catch (error) {
      logger.error({ error }, "Database disconnect failed during shutdown");
    }
    clearTimeout(deadline);
    logger.info("Graceful shutdown complete");
    exit(0);
  };
}
