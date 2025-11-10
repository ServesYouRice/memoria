import pino from 'pino';
import { nanoid } from 'nanoid';

// Create base logger with structured JSON output
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
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return nanoid();
}

/**
 * Create a child logger with correlation ID and additional context
 */
export function createRequestLogger(correlationId?: string, userId?: string) {
  return logger.child({
    correlationId: correlationId || generateCorrelationId(),
    ...(userId && { userId }),
  });
}

/**
 * Create a logger for a specific module/feature
 */
export function createLogger(module: string) {
  return logger.child({ module });
}

export default logger;
