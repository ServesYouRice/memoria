import { existsSync } from "fs";
import path from "path";
import { config as loadDotenvSafe } from "dotenv-safe";
import { z } from "zod";

const envFilePath = process.env.MEMORIA_ENV_FILE || ".env";
const exampleFilePath = ".env.example";
const resolvedEnvPath = path.resolve(process.cwd(), envFilePath);
const resolvedExamplePath = path.resolve(process.cwd(), exampleFilePath);

if (!process.env.MEMORIA_SKIP_ENV_FILE_LOAD) {
  const hasEnvFile = existsSync(resolvedEnvPath);
  const hasExampleFile = existsSync(resolvedExamplePath);

  if (hasExampleFile && (hasEnvFile || process.env.NODE_ENV === "test")) {
    loadDotenvSafe({
      allowEmptyValues: true,
      path: envFilePath,
      example: exampleFilePath,
      silent: true,
    });
  }
}

const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }
    return value;
  }, schema.optional());

const optionalString = emptyToUndefined(z.string());
const optionalUrl = emptyToUndefined(z.string().url());
const optionalInt = emptyToUndefined(z.coerce.number().int());

const rawEnv = {
  ...process.env,
  AUTH_URL: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL,
  AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  SMTP_PASS: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD,
};

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    AUTH_URL: z.string().url("AUTH_URL or NEXTAUTH_URL must be a valid URL"),
    AUTH_SECRET: z
      .string()
      .min(32, "AUTH_SECRET or NEXTAUTH_SECRET must be at least 32 characters"),
    NEXTAUTH_URL: optionalUrl,
    NEXTAUTH_SECRET: optionalString,
    REDIS_URL: optionalUrl,
    LOG_LEVEL: optionalString,
    FEATURE_BOOKMARK_UNFURLING: z.enum(["true", "false"]).optional(),
    NEXT_PUBLIC_SENTRY_DSN: optionalString,
    SENTRY_DSN: optionalString,
    SENTRY_AUTH_TOKEN: optionalString,
    CRON_SECRET: optionalString,
    EMAIL_PROVIDER: z
      .enum(["console", "smtp", "sendgrid", "resend"])
      .default("console"),
    EMAIL_FROM: optionalString,
    EMAIL_FROM_NAME: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: optionalInt,
    SMTP_SECURE: z.enum(["true", "false"]).optional(),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SENDGRID_API_KEY: optionalString,
    RESEND_API_KEY: optionalString,
    MODEL_CREDENTIAL_ENCRYPTION_KEY: optionalString,
    UPLOAD_STORAGE: z.enum(["local", "s3"]).default("local"),
    UPLOADS_PUBLIC_URL: optionalUrl,
    UPLOAD_SCAN_URL: optionalUrl,
    UPLOAD_SCAN_REQUIRED: z.enum(["true", "false"]).default("false"),
    UPLOAD_SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ENDPOINT: optionalUrl,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    APP_BOOTSTRAP_TOKEN: optionalString,
    DATABASE_PASSWORD: optionalString,
    MINIO_ROOT_USER: optionalString,
    MINIO_ROOT_PASSWORD: optionalString,
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "production" && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message:
          "REDIS_URL is required in production for collaboration, rate limiting, and agent safety.",
      });
    }

    if (data.NODE_ENV === "production" && data.UPLOAD_STORAGE !== "s3") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["UPLOAD_STORAGE"],
        message: "UPLOAD_STORAGE must be set to s3 in production.",
      });
    }

    if (data.NODE_ENV === "production" && !data.APP_BOOTSTRAP_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_BOOTSTRAP_TOKEN"],
        message:
          "APP_BOOTSTRAP_TOKEN is required in production for first-run bootstrap.",
      });
    }

    if (data.UPLOAD_STORAGE === "s3") {
      const requiredS3Fields = [
        "S3_BUCKET",
        "S3_REGION",
        "S3_ENDPOINT",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const;

      for (const field of requiredS3Fields) {
        if (!data[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when UPLOAD_STORAGE=s3.`,
          });
        }
      }
    }

    if (data.EMAIL_PROVIDER === "smtp") {
      const smtpFields = [
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASS",
      ] as const;
      for (const field of smtpFields) {
        if (!data[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when EMAIL_PROVIDER=smtp.`,
          });
        }
      }
    }

    if (data.EMAIL_PROVIDER === "sendgrid" && !data.SENDGRID_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SENDGRID_API_KEY"],
        message: "SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid.",
      });
    }

    if (data.EMAIL_PROVIDER === "resend" && !data.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend.",
      });
    }
  });

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  throw new Error("Invalid environment variables");
}

export const env = {
  ...parsed.data,
  AUTH_URL: parsed.data.AUTH_URL,
  AUTH_SECRET: parsed.data.AUTH_SECRET,
  NEXTAUTH_URL: parsed.data.NEXTAUTH_URL ?? parsed.data.AUTH_URL,
  NEXTAUTH_SECRET: parsed.data.NEXTAUTH_SECRET ?? parsed.data.AUTH_SECRET,
  SMTP_PASS: parsed.data.SMTP_PASS,
  MODEL_CREDENTIAL_ENCRYPTION_KEY: parsed.data.MODEL_CREDENTIAL_ENCRYPTION_KEY,
};
