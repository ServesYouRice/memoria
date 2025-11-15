/**
 * Prisma Client Singleton
 * Prevents multiple instances in development
 *
 * ENHANCED: Issue #13, #22 - Connection pool and timeout configuration
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
 * Serverless Recommendations:
 * - Vercel/AWS Lambda: connection_limit=5, pool_timeout=10
 * - Traditional server: connection_limit=20, pool_timeout=30
 * - Use PgBouncer for additional connection pooling
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger';

const logger = createLogger('database');

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaConnected: boolean;
};

// Determine optimal pool size based on environment
const getConnectionPoolConfig = () => {
  // In serverless environments, use smaller pool
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return {
      recommended: 5,
      environment: 'serverless',
    };
  }

  // In traditional servers, allow larger pool
  return {
    recommended: 20,
    environment: 'server',
  };
};

const poolConfig = getConnectionPoolConfig();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'error' },
            { emit: 'stdout', level: 'warn' },
          ]
        : [{ emit: 'stdout', level: 'error' }],

    // Connection pool configuration (Issues #13, #22)
    // Helps manage connections in serverless environments
    // Note: Connection pooling is primarily controlled via DATABASE_URL query params
    // Example: postgresql://user:pass@host:5432/db?connection_limit=5&pool_timeout=10
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Log query events in development for debugging
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query' as never, ((e: { query: string; duration: number }) => {
    if (e.duration > 1000) {
      logger.warn({ query: e.query, duration: e.duration }, 'Slow query detected');
    }
  }) as never);
}

// Graceful shutdown handling (Issue #22)
if (process.env.NODE_ENV === 'production') {
  // Log connection pool configuration
  logger.info(
    {
      environment: poolConfig.environment,
      recommended_pool_size: poolConfig.recommended,
    },
    'Database connection pool initialized'
  );

  // Connect eagerly in production to fail fast
  if (!globalForPrisma.prismaConnected) {
    prisma
      .$connect()
      .then(() => {
        globalForPrisma.prismaConnected = true;
        logger.info('Database connected successfully');
      })
      .catch((error: Error) => {
        logger.fatal({ error }, 'Failed to connect to database');
        console.error('Failed to connect to database:', error);
        process.exit(1);
      });
  }

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down database connection');
    await prisma.$disconnect();
    globalForPrisma.prismaConnected = false;
  };

  process.on('beforeExit', async () => {
    await shutdown('beforeExit');
  });

  process.on('SIGINT', async () => {
    await shutdown('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await shutdown('SIGTERM');
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
  timeoutMs: number = 5000
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Database query timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}
