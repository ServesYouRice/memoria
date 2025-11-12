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

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
