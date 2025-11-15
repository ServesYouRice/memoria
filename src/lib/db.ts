/**
 * Prisma Client Singleton
 * Prevents multiple instances in development
 *
 * ENHANCED: Issue #13 - Added connection pool and timeout configuration
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],

    // Connection pool configuration (Issue #13)
    // Helps manage connections in serverless environments
    // Note: Connection pooling is also controlled via DATABASE_URL query params
    // Example: postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=10
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown handling
if (process.env.NODE_ENV === 'production') {
  // Connect eagerly in production
  prisma.$connect().catch((error) => {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });

  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await prisma.$disconnect();
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
