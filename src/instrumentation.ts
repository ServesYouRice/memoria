/**
 * Next.js Instrumentation File
 *
 * This file is executed once when the Next.js server starts.
 * It's the ideal place for global initialization code.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * FIXED: Issue #20 - Unhandled Promise Rejections
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('instrumentation');

/**
 * Register global error handlers
 *
 * This function sets up handlers for:
 * - Unhandled promise rejections
 * - Uncaught exceptions
 *
 * These handlers ensure that unexpected errors are properly logged
 * and can be sent to error tracking services (Sentry, etc.)
 */
export function register() {
  // Only register once (for Node.js runtime)
  if (typeof window === 'undefined') {
    // Handle unhandled promise rejections (Issue #20)
    process.on('unhandledRejection', (reason, promise) => {
      logger.error(
        {
          reason,
          promise: String(promise),
          stack: reason instanceof Error ? reason.stack : undefined,
        },
        'Unhandled promise rejection detected'
      );

      // TODO: Send to error tracking service (Sentry, etc.)
      // if (process.env.NODE_ENV === 'production') {
      //   Sentry.captureException(reason, {
      //     contexts: {
      //       promise: { promise: String(promise) },
      //     },
      //   });
      // }
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.fatal(
        {
          error: error.message,
          stack: error.stack,
        },
        'Uncaught exception detected'
      );

      // TODO: Send to error tracking service
      // if (process.env.NODE_ENV === 'production') {
      //   Sentry.captureException(error);
      // }

      // In production, we might want to gracefully shut down
      if (process.env.NODE_ENV === 'production') {
        logger.fatal('Process will exit due to uncaught exception');
        process.exit(1);
      }
    });

    // Handle graceful shutdown signals
    const gracefulShutdown = (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

      // Close database connections
      // Note: Prisma will automatically handle this, but we can add custom cleanup here
      setTimeout(() => {
        logger.info('Graceful shutdown completed');
        process.exit(0);
      }, 5000); // Give 5 seconds for cleanup
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    logger.info('Global error handlers registered');
  }

  // Browser-side error handling
  if (typeof window !== 'undefined') {
    // Handle unhandled promise rejections in the browser
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled promise rejection (browser):', event.reason);

      // TODO: Send to error tracking service
      // if (process.env.NODE_ENV === 'production') {
      //   Sentry.captureException(event.reason);
      // }

      // Prevent the default browser behavior (console error)
      // Comment this out if you want to see the errors in the console during development
      // event.preventDefault();
    });

    // Handle global errors in the browser
    window.addEventListener('error', (event) => {
      console.error('Global error (browser):', event.error);

      // TODO: Send to error tracking service
      // if (process.env.NODE_ENV === 'production') {
      //   Sentry.captureException(event.error);
      // }
    });

    console.log('Browser error handlers registered');
  }
}

/**
 * Example of how to integrate Sentry (when ready):
 *
 * ```typescript
 * import * as Sentry from '@sentry/nextjs';
 *
 * export function register() {
 *   if (process.env.NODE_ENV === 'production') {
 *     Sentry.init({
 *       dsn: process.env.SENTRY_DSN,
 *       tracesSampleRate: 0.1,
 *       environment: process.env.NODE_ENV,
 *       integrations: [
 *         new Sentry.Integrations.Prisma({ client: prisma }),
 *       ],
 *     });
 *   }
 * }
 * ```
 *
 * See docs/MONITORING.md for more details on error tracking setup.
 */
