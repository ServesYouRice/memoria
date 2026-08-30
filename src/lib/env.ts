import { existsSync } from "fs";
import path from "path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const envFilePath = process.env.MEMORIA_ENV_FILE || ".env";
const resolvedEnvPath = path.resolve(process.cwd(), envFilePath);

if (!process.env.MEMORIA_SKIP_ENV_FILE_LOAD) {
  const hasEnvFile = existsSync(resolvedEnvPath);

  if (hasEnvFile) {
    loadDotenv({ path: resolvedEnvPath, quiet: true });
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
const optionalEmail = emptyToUndefined(z.string().email());
const optionalInt = emptyToUndefined(z.coerce.number().int());
const optionalPositiveInt = emptyToUndefined(
  z.coerce.number().int().positive(),
);

const rawEnv = {
  ...process.env,
  AUTH_URL: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL,
  AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  SMTP_PASS: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD,
};

const KNOWN_PLACEHOLDER_REGEX =
  /^(replace-me|replace-with|devpassword|minioadmin)/i;

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
    INTERNAL_OPERATIONS_TOKEN: optionalString,
    MEMORIA_E2E_MODE: z.enum(["true"]).optional(),
    TRUSTED_PROXY_CIDRS: optionalString,
    AUTH_RATE_LIMIT_MAX_REQUESTS: optionalPositiveInt,
    API_RATE_LIMIT_MAX_REQUESTS: optionalPositiveInt,
    UPLOAD_RATE_LIMIT_MAX_REQUESTS: optionalPositiveInt,
    REGISTRATION_MODE: z.enum(["open", "invite", "closed"]).default("open"),
    FEATURE_BOOKMARK_UNFURLING: z.enum(["true", "false"]).optional(),
    BOOKMARK_REFRESH_INTERVAL_MS: optionalPositiveInt,
    // DEC-013: the AR canvas layer stays off until the real-device matrix
    // passes. Deployments opt in explicitly.
    NEXT_PUBLIC_ENABLE_AR_CANVAS: z.enum(["true", "false"]).optional(),
    NEXT_PUBLIC_SENTRY_DSN: optionalString,
    SENTRY_DSN: optionalString,
    SENTRY_AUTH_TOKEN: optionalString,
    CRON_SECRET: optionalString,
    EMAIL_PROVIDER: z
      .enum(["console", "smtp", "sendgrid", "resend"])
      .default("console"),
    EMAIL_FROM: optionalEmail,
    EMAIL_FROM_NAME: optionalString,
    EMAIL_SENDER_VERIFIED: z.enum(["true", "false"]).optional(),
    EMAIL_DELIVERY_PROBE_TO: optionalEmail,
    SMTP_HOST: optionalString,
    SMTP_PORT: optionalInt,
    SMTP_SECURE: z.enum(["true", "false"]).optional(),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SENDGRID_API_KEY: optionalString,
    SENDGRID_API_URL: optionalUrl,
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
    BACKUP_BUCKET: optionalString,
    BACKUP_RETENTION_DAYS: optionalInt,
    BACKUP_MANIFEST_HMAC_KEY: optionalString,
    AI_ACTION_BUDGET_DAILY: optionalPositiveInt,
    AI_ENABLED: z.enum(["true", "false"]).optional(),
    AI_MODEL: optionalString,
    AI_DAILY_TOKEN_BUDGET: optionalPositiveInt,
    AI_DAILY_COST_MICRO_USD: optionalPositiveInt,
    AI_MAX_CONCURRENT_PER_USER: optionalPositiveInt,
    AI_MAX_PROMPT_BYTES: optionalPositiveInt,
    AI_INPUT_COST_MICRO_USD_PER_MILLION: optionalPositiveInt,
    AI_OUTPUT_COST_MICRO_USD_PER_MILLION: optionalPositiveInt,
    ACCOUNT_EXPORT_MAX_INPUT_BYTES: optionalPositiveInt,
    ACCOUNT_EXPORT_MAX_ARCHIVE_BYTES: optionalPositiveInt,
    ACCOUNT_EXPORT_TIMEOUT_MS: optionalPositiveInt,
    OPENAI_API_KEY: optionalString,
    APP_BOOTSTRAP_TOKEN: optionalString,
    DATABASE_PASSWORD: optionalString,
    MINIO_ROOT_USER: optionalString,
    MINIO_ROOT_PASSWORD: optionalString,
  })
  .superRefine((data, ctx) => {
    const validateProductionRuntime =
      data.NODE_ENV === "production" &&
      process.env.MEMORIA_BUILD_PHASE !== "true";

    if (validateProductionRuntime) {
      const securitySecrets = [
        { name: "AUTH_SECRET", val: data.AUTH_SECRET },
        {
          name: "INTERNAL_OPERATIONS_TOKEN",
          val: data.INTERNAL_OPERATIONS_TOKEN,
        },
        { name: "APP_BOOTSTRAP_TOKEN", val: data.APP_BOOTSTRAP_TOKEN },
        {
          name: "MODEL_CREDENTIAL_ENCRYPTION_KEY",
          val: data.MODEL_CREDENTIAL_ENCRYPTION_KEY,
        },
        { name: "CRON_SECRET", val: data.CRON_SECRET },
        {
          name: "BACKUP_MANIFEST_HMAC_KEY",
          val: data.BACKUP_MANIFEST_HMAC_KEY,
        },
      ] as const;

      for (const { name, val } of securitySecrets) {
        if (val && KNOWN_PLACEHOLDER_REGEX.test(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: `${name} contains a known placeholder. A distinct, randomly generated secret is required in production.`,
          });
        }
      }
    }

    if (validateProductionRuntime && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message:
          "REDIS_URL is required in production for collaboration, rate limiting, and agent safety.",
      });
    }

    if (validateProductionRuntime && data.UPLOAD_STORAGE !== "s3") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["UPLOAD_STORAGE"],
        message: "UPLOAD_STORAGE must be set to s3 in production.",
      });
    }

    if (validateProductionRuntime && !data.APP_BOOTSTRAP_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_BOOTSTRAP_TOKEN"],
        message:
          "APP_BOOTSTRAP_TOKEN is required in production for first-run bootstrap.",
      });
    }

    if (
      validateProductionRuntime &&
      (!data.INTERNAL_OPERATIONS_TOKEN ||
        data.INTERNAL_OPERATIONS_TOKEN.length < 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_OPERATIONS_TOKEN"],
        message:
          "INTERNAL_OPERATIONS_TOKEN of at least 32 characters is required in production.",
      });
    }

    if (
      validateProductionRuntime &&
      (!data.MODEL_CREDENTIAL_ENCRYPTION_KEY ||
        data.MODEL_CREDENTIAL_ENCRYPTION_KEY.length < 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MODEL_CREDENTIAL_ENCRYPTION_KEY"],
        message:
          "MODEL_CREDENTIAL_ENCRYPTION_KEY of at least 32 characters is required in production.",
      });
    }

    if (data.MODEL_CREDENTIAL_ENCRYPTION_KEY === data.AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MODEL_CREDENTIAL_ENCRYPTION_KEY"],
        message:
          "MODEL_CREDENTIAL_ENCRYPTION_KEY must be distinct from AUTH_SECRET.",
      });
    }

    if (
      validateProductionRuntime &&
      data.EMAIL_PROVIDER !== "sendgrid" &&
      data.EMAIL_PROVIDER !== "resend"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_PROVIDER"],
        message: "EMAIL_PROVIDER must be sendgrid or resend in production.",
      });
    }

    if (validateProductionRuntime && !data.EMAIL_FROM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_FROM"],
        message: "EMAIL_FROM is required in production.",
      });
    }

    if (
      validateProductionRuntime &&
      data.MEMORIA_E2E_MODE !== "true" &&
      data.EMAIL_FROM &&
      /@(localhost|[^@]+\.local)$/i.test(data.EMAIL_FROM)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_FROM"],
        message: "EMAIL_FROM must use a verified, publicly routable domain.",
      });
    }

    if (validateProductionRuntime && data.EMAIL_SENDER_VERIFIED !== "true") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_SENDER_VERIFIED"],
        message:
          "EMAIL_SENDER_VERIFIED=true is required after provider sender/domain verification.",
      });
    }

    if (validateProductionRuntime && !data.EMAIL_DELIVERY_PROBE_TO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_DELIVERY_PROBE_TO"],
        message:
          "EMAIL_DELIVERY_PROBE_TO is required for the setup delivery proof.",
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

    if (
      data.SENDGRID_API_URL &&
      data.SENDGRID_API_URL !== "https://api.sendgrid.com/v3/mail/send" &&
      data.MEMORIA_E2E_MODE !== "true"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SENDGRID_API_URL"],
        message:
          "A custom SENDGRID_API_URL is allowed only in the isolated E2E runtime.",
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
