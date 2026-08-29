import { existsSync } from 'fs';
import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const envFilePath = process.env.MEMORIA_ENV_FILE || '.env';
const resolvedEnvPath = path.resolve(process.cwd(), envFilePath);

if (existsSync(resolvedEnvPath)) {
  loadDotenv({ path: resolvedEnvPath, quiet: true });
}

const emptyToUndefined = (value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());
const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);

const rawEnv = {
  ...process.env,
  AUTH_URL: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL,
  AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  SMTP_PASS: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD,
};

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    AUTH_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    REDIS_URL: optionalUrl,
    INTERNAL_OPERATIONS_TOKEN: optionalString,
    MEMORIA_E2E_MODE: z.enum(['true']).optional(),
    AUTH_RATE_LIMIT_MAX_REQUESTS: optionalPositiveInt,
    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'sendgrid', 'resend']).default('console'),
    EMAIL_FROM: optionalEmail,
    EMAIL_SENDER_VERIFIED: z.enum(['true', 'false']).optional(),
    EMAIL_DELIVERY_PROBE_TO: optionalEmail,
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SENDGRID_API_KEY: optionalString,
    SENDGRID_API_URL: optionalUrl,
    RESEND_API_KEY: optionalString,
    UPLOAD_STORAGE: z.enum(['local', 's3']).default('local'),
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ENDPOINT: optionalUrl,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    APP_BOOTSTRAP_TOKEN: optionalString,
    MODEL_CREDENTIAL_ENCRYPTION_KEY: optionalString,
    CRON_SECRET: optionalString,
    BACKUP_BUCKET: optionalString,
    BACKUP_MANIFEST_HMAC_KEY: optionalString,
    BACKUP_S3_ENDPOINT: optionalUrl,
    BACKUP_S3_ACCESS_KEY_ID: optionalString,
    BACKUP_S3_SECRET_ACCESS_KEY: optionalString,
    BACKUP_S3_SSE: optionalString,
  })
  .superRefine((data, ctx) => {
    const validateProductionRuntime =
      data.NODE_ENV === 'production' && process.env.MEMORIA_BUILD_PHASE !== 'true';

    if (validateProductionRuntime && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required in production.',
      });
    }

    if (validateProductionRuntime && data.UPLOAD_STORAGE !== 's3') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['UPLOAD_STORAGE'],
        message: 'UPLOAD_STORAGE must be s3 in production.',
      });
    }

    if (validateProductionRuntime && !data.APP_BOOTSTRAP_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_BOOTSTRAP_TOKEN'],
        message: 'APP_BOOTSTRAP_TOKEN is required in production.',
      });
    }

    if (
      validateProductionRuntime &&
      (!data.MODEL_CREDENTIAL_ENCRYPTION_KEY || data.MODEL_CREDENTIAL_ENCRYPTION_KEY.length < 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MODEL_CREDENTIAL_ENCRYPTION_KEY'],
        message: 'MODEL_CREDENTIAL_ENCRYPTION_KEY of at least 32 characters is required in production.',
      });
    }

    if (data.MODEL_CREDENTIAL_ENCRYPTION_KEY === data.AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MODEL_CREDENTIAL_ENCRYPTION_KEY'],
        message: 'MODEL_CREDENTIAL_ENCRYPTION_KEY must be distinct from AUTH_SECRET.',
      });
    }

    if (validateProductionRuntime && !['sendgrid', 'resend'].includes(data.EMAIL_PROVIDER)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER'],
        message: 'EMAIL_PROVIDER must be sendgrid or resend in production.',
      });
    }

    if (validateProductionRuntime) {
      for (const field of [
        'INTERNAL_OPERATIONS_TOKEN',
        'CRON_SECRET',
        'BACKUP_MANIFEST_HMAC_KEY',
      ]) {
        if (!data[field] || data[field].length < 24) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} of at least 24 characters is required in production.`,
          });
        }
      }

      if (!data.EMAIL_FROM || /@(localhost|[^@]+\.local)$/i.test(data.EMAIL_FROM)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM'],
          message: 'EMAIL_FROM must use a verified, publicly routable domain.',
        });
      }
      if (data.EMAIL_SENDER_VERIFIED !== 'true') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_SENDER_VERIFIED'],
          message: 'EMAIL_SENDER_VERIFIED=true is required in production.',
        });
      }
      if (!data.EMAIL_DELIVERY_PROBE_TO) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_DELIVERY_PROBE_TO'],
          message: 'EMAIL_DELIVERY_PROBE_TO is required in production.',
        });
      }
      for (const field of [
        'BACKUP_BUCKET',
        'BACKUP_S3_ACCESS_KEY_ID',
        'BACKUP_S3_SECRET_ACCESS_KEY',
      ]) {
        if (!data[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required for off-host production backups.`,
          });
        }
      }
      if (data.BACKUP_S3_SSE === 'none') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BACKUP_S3_SSE'],
          message: 'BACKUP_S3_SSE must enable production backup encryption.',
        });
      }
      if (data.BACKUP_S3_ENDPOINT && data.BACKUP_S3_ENDPOINT === data.S3_ENDPOINT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BACKUP_S3_ENDPOINT'],
          message: 'Production backup storage must be off-host.',
        });
      }
    }

    if (data.UPLOAD_STORAGE === 's3') {
      for (const field of ['S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
        if (!data[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when UPLOAD_STORAGE=s3.`,
          });
        }
      }
    }

    if (data.EMAIL_PROVIDER === 'smtp') {
      for (const field of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) {
        if (!data[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when EMAIL_PROVIDER=smtp.`,
          });
        }
      }
    }

    if (
      data.SENDGRID_API_URL &&
      data.SENDGRID_API_URL !== 'https://api.sendgrid.com/v3/mail/send' &&
      data.MEMORIA_E2E_MODE !== 'true'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SENDGRID_API_URL'],
        message: 'A custom SENDGRID_API_URL is allowed only in the isolated E2E runtime.',
      });
    }
  });

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

console.log('Environment validation passed.');
