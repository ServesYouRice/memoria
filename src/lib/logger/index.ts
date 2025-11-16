/**
 * Structured Logging with Pino
 *
 * Provides a structured JSON logger with automatic secret redaction,
 * correlation ID support, and pretty printing in development.
 *
 * @module lib/logger
 *
 * ## Features
 * - Structured JSON logging for production
 * - Pretty printed colorized output in development
 * - Automatic redaction of sensitive fields (passwords, tokens, etc.)
 - Correlation ID generation for request tracing
 * - Child logger creation for module/request context
 *
 * ## Configuration
 * Set `LOG_LEVEL` environment variable to control verbosity:
 * - `debug`: Verbose logging for development
 * - `info`: Standard logging (default)
 * - `warn`: Warnings and errors only
 * - `error`: Errors only
 *
 * ## Redacted Fields
 * The following fields are automatically removed from logs:
 * - password, passwordHash
 * - token, accessToken, refreshToken
 * - secret, apiKey, authorization
 *
 * @example
 * ```typescript
 * import { logger } from '@/lib/logger';
 *
 * // Basic logging
 * logger.info('User logged in');
 * logger.error({ error, userId }, 'Failed to save canvas');
 *
 * // With correlation ID (for request tracing)
 * const requestLogger = createRequestLogger(req.headers['x-correlation-id']);
 * requestLogger.info({ userId }, 'Processing request');
 *
 * // Module-specific logger
 * const dbLogger = createLogger('database');
 * dbLogger.debug({ query }, 'Executing query');
 * ```
 *
 * @see {@link https://getpino.io Pino Documentation}
 */

import pino from 'pino';
import { nanoid } from 'nanoid';

/**
 * Base Pino logger instance with structured JSON output
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'secret',
      'apiKey',
      'authorization',
    ],
    remove: true,
  },
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  }),
});

/**
 * Generate a unique correlation ID for request tracing
 *
 * Correlation IDs enable tracing a single request across multiple
 * services and log entries. Pass the ID to child loggers to link all
 * related log entries.
 *
 * @returns A unique 21-character nanoid
 *
 * @example
 * ```typescript
 * const correlationId = generateCorrelationId();
 * const requestLogger = createRequestLogger(correlationId);
 * // All logs from this request will include the same correlationId
 * ```
 */
export function generateCorrelationId(): string {
  return nanoid();
}

/**
 * Create a child logger with correlation ID and user context
 *
 * Child loggers inherit all parent logger configuration and add
 * additional context fields. All log entries from this logger will
 * include the correlation ID and user ID (if provided).
 *
 * @param correlationId - Optional correlation ID (generates one if not provided)
 * @param userId - Optional user ID for user-specific context
 * @returns Child logger with request context
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const correlationId = request.headers.get('x-correlation-id') || generateCorrelationId();
 *   const session = await getServerSession();
 *   const logger = createRequestLogger(correlationId, session?.user?.id);
 *
 *   logger.info({ method: 'POST', path: request.url }, 'Request received');
 *   // ... handle request
 *   logger.info('Request completed');
 * }
 * ```
 */
export function createRequestLogger(correlationId?: string, userId?: string) {
  return logger.child({
    correlationId: correlationId || generateCorrelationId(),
    ...(userId && { userId }),
  });
}

/**
 * Create a child logger for a specific module or feature
 *
 * Module loggers add a `module` field to all log entries, making it
 * easy to filter logs by feature area. Use this for domain-specific
 * logging contexts.
 *
 * @param module - Module name (e.g., 'auth', 'database', 'email')
 * @returns Child logger with module context
 *
 * @example
 * ```typescript
 * const authLogger = createLogger('auth');
 * authLogger.info({ userId }, 'User authenticated');
 * authLogger.error({ error }, 'Authentication failed');
 *
 * const emailLogger = createLogger('email');
 * emailLogger.info({ to, subject }, 'Email sent');
 * ```
 */
export function createLogger(module: string) {
  return logger.child({ module });
}

/**
 * Export base logger as default
 *
 * Use the base logger for general-purpose logging.
 * For request or module-specific logging, use `createRequestLogger`
 * or `createLogger` instead.
 */
export { logger };
export default logger;
