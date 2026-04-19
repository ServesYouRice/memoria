import { existsSync } from 'fs';
import path from 'path';
import { config as loadDotenvSafe } from 'dotenv-safe';
import { z } from 'zod';

const envFilePath = process.env.MEMORIA_ENV_FILE || '.env';
const exampleFilePath = '.env.example';
const resolvedEnvPath = path.resolve(process.cwd(), envFilePath);
const resolvedExamplePath = path.resolve(process.cwd(), exampleFilePath);

if (existsSync(resolvedExamplePath) && (existsSync(resolvedEnvPath) || process.env.NODE_ENV === 'test')) {
  loadDotenvSafe({
    allowEmptyValues: true,
    path: envFilePath,
    example: exampleFilePath,
    silent: true,
  });
}

const emptyToUndefined = (value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

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
    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'sendgrid', 'resend']).default('console'),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SENDGRID_API_KEY: optionalString,
    RESEND_API_KEY: optionalString,
    UPLOAD_STORAGE: z.enum(['local', 's3']).default('local'),
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ENDPOINT: optionalUrl,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    APP_BOOTSTRAP_TOKEN: optionalString,
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required in production.',
      });
    }

    if (data.NODE_ENV === 'production' && data.UPLOAD_STORAGE !== 's3') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['UPLOAD_STORAGE'],
        message: 'UPLOAD_STORAGE must be s3 in production.',
      });
    }

    if (data.NODE_ENV === 'production' && !data.APP_BOOTSTRAP_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_BOOTSTRAP_TOKEN'],
        message: 'APP_BOOTSTRAP_TOKEN is required in production.',
      });
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
  });

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

console.log('Environment validation passed.');
