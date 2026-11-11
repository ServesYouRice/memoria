import { afterEach, describe, expect, it, vi } from "vitest";

const productionEnv: Record<string, string> = {
  NODE_ENV: "production",
  MEMORIA_SKIP_ENV_FILE_LOAD: "true",
  MEMORIA_BUILD_PHASE: "",
  DATABASE_URL:
    "postgresql://memoria:strong-db-password@localhost:5432/memoria",
  AUTH_URL: "https://memoria.example",
  AUTH_SECRET: "auth-secret-prod-0123456789abcdefghijk",
  APP_BOOTSTRAP_TOKEN: "bootstrap-token-prod-0123456789ab",
  INTERNAL_OPERATIONS_TOKEN: "operations-token-prod-0123456789abcdef",
  MODEL_CREDENTIAL_ENCRYPTION_KEY: "model-key-prod-0123456789abcdefghij",
  CRON_SECRET: "cron-secret-prod-0123456789abcdef",
  BACKUP_MANIFEST_HMAC_KEY: "backup-hmac-prod-0123456789abcdef",
  REDIS_URL: "redis://redis.memoria.example:6379",
  UPLOAD_STORAGE: "s3",
  S3_BUCKET: "memoria-uploads",
  S3_REGION: "us-east-1",
  S3_ENDPOINT: "https://s3.memoria.example",
  S3_ACCESS_KEY_ID: "uploads-access",
  S3_SECRET_ACCESS_KEY: "uploads-secret",
  EMAIL_PROVIDER: "smtp",
  EMAIL_FROM: "noreply@memoria.example",
  EMAIL_SENDER_VERIFIED: "true",
  EMAIL_DELIVERY_PROBE_TO: "operator@memoria.example",
  SMTP_HOST: "smtp.memoria.example",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "mailer",
  SMTP_PASS: "smtp-password-prod",
};

async function loadEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    ...productionEnv,
    ...overrides,
  })) {
    vi.stubEnv(key, value);
  }
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.map(String).join(" "));
  });
  try {
    await import("@/lib/env");
    return { ok: true, output: errors.join("\n") };
  } catch {
    return { ok: false, output: errors.join("\n") };
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const placeholderCases: Array<[string, Record<string, string | undefined>]> = [
  ["S3_ACCESS_KEY_ID", { S3_ACCESS_KEY_ID: "minioadmin" }],
  ["S3_SECRET_ACCESS_KEY", { S3_SECRET_ACCESS_KEY: "minioadmin" }],
  ["MINIO_ROOT_USER", { MINIO_ROOT_USER: "minioadmin" }],
  ["MINIO_ROOT_PASSWORD", { MINIO_ROOT_PASSWORD: "minioadmin" }],
  ["DATABASE_PASSWORD", { DATABASE_PASSWORD: "devpassword" }],
  ["SMTP_PASS", { SMTP_PASS: "replace-me-smtp" }],
  ["SMTP_PASS", { SMTP_PASS: undefined, SMTP_PASSWORD: "devpassword" }],
];

describe("production credential placeholders", () => {
  it("accepts real-looking credentials in production", async () => {
    const result = await loadEnv({
      MINIO_ROOT_USER: "storage-admin",
      MINIO_ROOT_PASSWORD: "a-long-random-storage-password",
      DATABASE_PASSWORD: "a-long-random-db-password",
    });
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  });

  it.each(placeholderCases)(
    "rejects a placeholder in %s without echoing it",
    async (name, overrides) => {
      const result = await loadEnv(overrides);
      expect(result.ok).toBe(false);
      expect(result.output).toContain(`${name} contains a known placeholder`);
      const value = Object.values(overrides).find(Boolean)!;
      expect(result.output).not.toContain(value);
    },
  );

  it.each(placeholderCases)(
    "leaves %s alone outside production",
    async (_name, overrides) => {
      const result = await loadEnv({ ...overrides, NODE_ENV: "development" });
      expect(result.ok).toBe(true);
    },
  );
});
