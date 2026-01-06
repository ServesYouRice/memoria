import { z } from 'zod';

/**
 * Environment Variable Validation (ADR Requirement)
 *
 * Validates all environment variables at startup using Zod.
 * This ensures type safety and catches configuration errors early.
 */

const envSchema = z.object({
  // Node Environment
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database
  DATABASE_URL: z.string().url().min(1, 'DATABASE_URL is required'),

  // Auth.js (NextAuth v5)
  NEXTAUTH_URL: z.string().url().min(1, 'NEXTAUTH_URL is required'),
  NEXTAUTH_SECRET: z.string().min(32, 'NEXTAUTH_SECRET must be at least 32 characters'),

  // Optional: OAuth providers (can be added later)
  // GOOGLE_CLIENT_ID: z.string().optional(),
  // GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Sentry
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  // Cron
  CRON_SECRET: z.string().optional(),

  // Redis (optional)
  REDIS_URL: z.string().url().optional(),

  // Upload storage
  UPLOAD_STORAGE: z.enum(['local', 's3']).optional(),
  UPLOADS_PUBLIC_URL: z.string().url().optional(),
  UPLOAD_SCAN_URL: z.string().url().optional(),
  UPLOAD_SCAN_REQUIRED: z.enum(['true', 'false']).optional(),
  UPLOAD_SCAN_TIMEOUT_MS: z.string().optional(),

  // S3-compatible storage (optional)
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

// Validate environment variables
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    '❌ Invalid environment variables:',
    JSON.stringify(parsed.error.format(), null, 2)
  );
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;

// Type-safe environment variables
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface ProcessEnv extends z.infer<typeof envSchema> {}
  }
}
