/**
 * Global Error Handlers
 *
 * FIXED: Issue #20 - Unhandled promise rejections
 *
 * This file is automatically loaded by Next.js before the application starts.
 * It registers global handlers for unhandled errors and promise rejections.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { createLogger } from './src/lib/logger';
import { validateCorsConfig } from './src/middleware/cors';

const logger = createLogger('global-error-handler');

/**
 * Check NextAuth version and warn about beta status
 *
 * FIXED: Issue #6 - NextAuth v5 Migration Warning
 */
function checkNextAuthVersion(): void {
  try {
    // Read package.json to get NextAuth version
    const fs = require('fs');
    const path = require('path');
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const nextAuthVersion = packageJson.dependencies['next-auth'];

    if (nextAuthVersion?.includes('beta')) {
      console.warn('');
      console.warn('⚠️  WARNING: NextAuth v5 Beta Detected');
      console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.warn(`Current version: next-auth@${nextAuthVersion}`);
      console.warn('');
      console.warn('You are using a BETA version of NextAuth v5.');
      console.warn('');
      console.warn('Action items:');
      console.warn('  1. Monitor for breaking changes and security updates');
      console.warn('     https://github.com/nextauthjs/next-auth/releases');
      console.warn('');
      console.warn('  2. Subscribe to migration guides when v5 stable is released');
      console.warn('     https://authjs.dev/getting-started/migrating-to-v5');
      console.warn('');
      console.warn('  3. Test authentication flows thoroughly before deploying');
      console.warn('');
      console.warn('  4. Consider pinning to a specific beta version in package.json');
      console.warn('     to avoid unexpected breaking changes on updates');
      console.warn('');
      console.warn('  5. When v5 stable is released, budget time for migration:');
      console.warn('     - Review CHANGELOG for breaking changes');
      console.warn('     - Update configuration in src/lib/auth.ts');
      console.warn('     - Test all auth flows (login, register, OAuth, sessions)');
      console.warn('     - Update environment variables if needed');
      console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.warn('');
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to check NextAuth version');
  }
}

export async function register() {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    // Import Sentry server config
    await import('./sentry.server.config');

    // Check NextAuth v5 beta status (Issue #6)
    checkNextAuthVersion();

    // Validate CORS configuration on startup (Issue #15)
    validateCorsConfig();

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason: unknown, promise: Promise<unknown>) => {
      logger.error(
        {
          reason,
          promise: String(promise),
          stack: reason instanceof Error ? reason.stack : undefined,
        },
        'Unhandled Promise Rejection'
      );

      // Send to Sentry in production
      if (process.env.NODE_ENV === 'production') {
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureException(reason);
        console.error('CRITICAL: Unhandled Promise Rejection:', reason);
      }
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error: Error) => {
      logger.error(
        {
          error,
          stack: error.stack,
        },
        'Uncaught Exception'
      );

      // Send to Sentry in production
      if (process.env.NODE_ENV === 'production') {
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureException(error);
        console.error('CRITICAL: Uncaught Exception:', error);
      }

      // For uncaught exceptions, it's often safer to exit the process
      // and let a process manager (like PM2, Docker, or Kubernetes) restart it
      if (process.env.NODE_ENV === 'production') {
        logger.fatal('Exiting due to uncaught exception');
        process.exit(1);
      }
    });

    // Handle warnings (optional, useful for debugging)
    process.on('warning', (warning: Error) => {
      logger.warn(
        {
          name: warning.name,
          message: warning.message,
          stack: warning.stack,
        },
        'Process Warning'
      );
    });

    logger.info('Global error handlers registered (with Sentry integration)');
  }

  if (process.env['NEXT_RUNTIME'] === 'edge') {
    // Import Sentry edge config
    await import('./sentry.edge.config');
  }
}

