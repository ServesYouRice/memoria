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

async function checkNextAuthVersion(logger: LoggerLike): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const nextAuthVersion =
      packageJson.dependencies?.['next-auth'] ?? packageJson.devDependencies?.['next-auth'];

    if (typeof nextAuthVersion === 'string' && nextAuthVersion.includes('beta')) {
      logger.warn(`NextAuth v5 beta detected: next-auth@${nextAuthVersion}`);
      console.warn('');
      console.warn('WARNING: NextAuth v5 beta detected');
      console.warn(`Current version: next-auth@${nextAuthVersion}`);
      console.warn('Monitor release notes and test auth flows before deploying.');
      console.warn('');
    }
  } catch (error) {
    logger.warn('Failed to check NextAuth version', error);
  }
}

export async function register() {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const [{ createLogger }, { validateCorsConfig }] = await Promise.all([
      import('./lib/logger'),
      import('./middleware/cors'),
    ]);

    const logger = createLogger('global-error-handler');

    await import('./lib/env');
    await import('../sentry.server.config');

    await checkNextAuthVersion(logger);

    validateCorsConfig();

    process.on('unhandledRejection', async (reason: unknown, promise: Promise<unknown>) => {
      logger.error('Unhandled Promise Rejection');
      logger.error(JSON.stringify({
        reason,
        promise: String(promise),
        stack: reason instanceof Error ? reason.stack : undefined,
      }));

      if (process.env.NODE_ENV === 'production') {
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureException(reason);
        console.error('CRITICAL: Unhandled Promise Rejection:', reason);
      }
    });

    process.on('uncaughtException', async (error: Error) => {
      logger.error('Uncaught Exception');
      logger.error(JSON.stringify({ error, stack: error.stack }));

      if (process.env.NODE_ENV === 'production') {
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureException(error);
        console.error('CRITICAL: Uncaught Exception:', error);
        if (logger.fatal) {
          logger.fatal('Exiting due to uncaught exception');
        }
        process.exit(1);
      }
    });

    process.on('warning', (warning: Error) => {
      logger.warn('Process Warning');
      logger.warn(JSON.stringify({
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      }));
    });

    logger.info('Global error handlers registered (with Sentry integration)');
  }

  if (process.env['NEXT_RUNTIME'] === 'edge') {
    await import('../sentry.edge.config');
  }
}
