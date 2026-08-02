/**
 * Prisma Database Client
 *
 * Singleton instance of Prisma Client for database operations.
 * Prevents multiple instances in development with hot-reloading.
 *
 * @module lib/db
 *
 * ## Configuration
 * - Development: Logs queries, errors, and warnings
 * - Production: Logs errors only
 * - Singleton pattern prevents connection pool exhaustion
 *
 * ## ENHANCED: Issue #13, #22 - Connection pool and timeout configuration
 *
 * Connection Pooling Configuration:
 * The database connection pool is configured via DATABASE_URL query parameters:
 *
 * - connection_limit: Max number of connections (default: 10)
 * - pool_timeout: Connection timeout in seconds (default: 10)
 * - connect_timeout: Initial connection timeout (default: 5)
 *
 * Example DATABASE_URL:
 * postgresql://user:pass@host:5432/db?connection_limit=5&pool_timeout=10&connect_timeout=5
 *
 * Production runs through the supervised Node server in `server.ts`.
 * Set the pool size explicitly in DATABASE_URL for that deployment.
 *
 * ## Usage
 * ```typescript
 * import { prisma } from '@/lib/db';
 *
 * const users = await prisma.user.findMany();
 * const canvas = await prisma.canvas.create({
 *   data: { name: 'My Canvas', userId: user.id }
 * });
 * ```
 *
 * @see {@link https://www.prisma.io/docs Prisma Documentation}
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createLogger } from "./logger";

const logger = createLogger("database");

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaConnected: boolean;
};

const skipEagerConnect =
  process.env.MEMORIA_SKIP_DB_EAGER_CONNECT === "true" ||
  process.env.NEXT_PHASE === "phase-production-build";

// Prisma 7 connects through a driver adapter rather than a `datasources`
// block. Pooling still comes from the DATABASE_URL query parameters, which the
// pg pool reads directly.
// Example: postgresql://user:pass@host:5432/db?connection_limit=5&pool_timeout=10
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "error" },
            { emit: "stdout", level: "warn" },
          ]
        : [{ emit: "stdout", level: "error" }],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Log query events in development for debugging
if (process.env.NODE_ENV === "development") {
  prisma.$on(
    "query" as never,
    ((e: { query: string; duration: number }) => {
      if (e.duration > 1000) {
        logger.warn(
          { query: e.query, duration: e.duration },
          "Slow query detected",
        );
      }
    }) as never,
  );
}

// Graceful shutdown handling (Issue #22)
if (process.env.NODE_ENV === "production") {
  logger.info("Database connection pool initialized for supervised server");

  // Connect eagerly in production to fail fast
  if (!skipEagerConnect && !globalForPrisma.prismaConnected) {
    prisma
      .$connect()
      .then(() => {
        globalForPrisma.prismaConnected = true;
        logger.info("Database connected successfully");
      })
      .catch((error: Error) => {
        logger.fatal({ error }, "Failed to connect to database");
        process.exit(1);
      });
  } else if (skipEagerConnect) {
    logger.info("Skipping eager database connect during build-time execution");
  }

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down database connection");
    await prisma.$disconnect();
    globalForPrisma.prismaConnected = false;
  };

  process.on("beforeExit", async () => {
    await shutdown("beforeExit");
  });

  process.on("SIGINT", async () => {
    await shutdown("SIGINT");
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await shutdown("SIGTERM");
    process.exit(0);
  });
}

/**
 * Database query timeout wrapper
 *
 * Usage:
 * ```typescript
 * const result = await withTimeout(
 *   prisma.user.findMany(),
 *   5000 // 5 second timeout
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 5000,
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Database query timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Database retry wrapper with exponential backoff
 *
 * Retry transient database failures.
 *
 * Automatically retries database operations on transient failures like:
 * - Connection timeouts
 * - Connection pool exhausted
 * - Temporary network issues
 * - Deadlocks
 *
 * Usage:
 * ```typescript
 * const user = await withRetry(
 *   () => prisma.user.findUnique({ where: { id: userId } }),
 *   3,    // max retries
 *   1000  // initial delay in ms
 * );
 * ```
 *
 * @param operation - The database operation to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param initialDelayMs - Initial delay in milliseconds (default: 1000)
 * @returns The result of the operation
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 0; attempt < maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        logger.warn(
          { error, attempt },
          "Database operation failed with non-retryable error",
        );
        throw error;
      }

      // Calculate exponential backoff delay
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 0.3 * delayMs; // Add 0-30% jitter
      const totalDelay = delayMs + jitter;

      logger.warn(
        {
          error,
          attempt: attempt + 1,
          maxRetries,
          delayMs: Math.round(totalDelay),
        },
        "Database operation failed, retrying...",
      );

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, totalDelay));
    }
  }

  // All retries exhausted
  logger.error(
    { error: lastError, maxRetries },
    "Database operation failed after all retries",
  );
  throw lastError;
}

/**
 * Determine if an error is retryable
 *
 * Retryable errors include:
 * - Connection errors (P1001, P1002, P1008, P1017)
 * - Timeout errors (P2024)
 * - Pool exhausted (P1008)
 * - Deadlock (P2034)
 * - Transaction conflicts
 *
 * Non-retryable errors include:
 * - Validation errors (P2000-P2023, except P2024)
 * - Not found errors (P2025)
 * - Unique constraint violations (P2002)
 * - Foreign key constraint violations (P2003)
 */
function isRetryableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  // Check for Prisma error codes
  if ("code" in error && typeof error.code === "string") {
    const code = error.code;

    // Retryable Prisma error codes
    const retryableCodes = [
      "P1001", // Can't reach database server
      "P1002", // Database server timeout
      "P1008", // Operations timed out
      "P1017", // Server closed connection
      "P2024", // Timed out fetching connection from pool
      "P2034", // Transaction failed due to write conflict or deadlock
    ];

    if (retryableCodes.includes(code)) {
      return true;
    }

    // Don't retry validation, constraint, or not found errors
    const nonRetryableCodes = [
      "P2000", // Value too long
      "P2001", // Record not found
      "P2002", // Unique constraint failed
      "P2003", // Foreign key constraint failed
      "P2025", // Record to update/delete not found
    ];

    if (nonRetryableCodes.includes(code)) {
      return false;
    }
  }

  // Check error message for common transient issues
  if ("message" in error && typeof error.message === "string") {
    const message = error.message.toLowerCase();
    const transientMessages = [
      "connection",
      "timeout",
      "timed out",
      "econnrefused",
      "econnreset",
      "epipe",
      "etimedout",
      "pool",
      "deadlock",
    ];

    return transientMessages.some((msg) => message.includes(msg));
  }

  // Conservative default: don't retry unknown errors
  return false;
}

/**
 * Convenience wrapper combining retry and timeout
 *
 * Usage:
 * ```typescript
 * const user = await withRetryAndTimeout(
 *   () => prisma.user.findUnique({ where: { id } }),
 *   5000,  // timeout in ms
 *   3,     // max retries
 *   1000   // initial retry delay
 * );
 * ```
 */
export async function withRetryAndTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = 5000,
  maxRetries: number = 3,
  initialDelayMs: number = 1000,
): Promise<T> {
  return withRetry(
    () => withTimeout(operation(), timeoutMs),
    maxRetries,
    initialDelayMs,
  );
}
