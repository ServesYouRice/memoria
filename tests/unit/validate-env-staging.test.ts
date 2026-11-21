/**
 * IMP-145 (handbook OWN-14) let staging start without a mail provider in
 * src/lib/env.ts; scripts/validate-env.mjs (run by `pnpm build` and `pnpm
 * doctor`) must apply the same rule, or it refuses a valid staging set-up.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts", "validate-env.mjs");

const productionWithoutMail: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  MEMORIA_ENV_FILE: join(process.cwd(), "tests", "no-such-env-file"),
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://memoria:db-password@localhost:5432/memoria",
  AUTH_URL: "https://memoria.example",
  AUTH_SECRET: "auth-secret-prod-0123456789abcdefghijk",
  REDIS_URL: "redis://redis.memoria.example:6379",
  APP_BOOTSTRAP_TOKEN: "bootstrap-token-prod-0123456789ab",
  INTERNAL_OPERATIONS_TOKEN: "operations-token-prod-0123456789abcdef",
  MODEL_CREDENTIAL_ENCRYPTION_KEY: "model-key-prod-0123456789abcdefghij",
  CRON_SECRET: "cron-secret-prod-0123456789abcdef",
  BACKUP_MANIFEST_HMAC_KEY: "backup-hmac-prod-0123456789abcdef",
  BACKUP_BUCKET: "memoria-backups",
  BACKUP_S3_ENDPOINT: "https://backups.memoria.example",
  BACKUP_S3_ACCESS_KEY_ID: "backup-access",
  BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret",
  BACKUP_S3_SSE: "AES256",
  UPLOAD_STORAGE: "s3",
  S3_BUCKET: "memoria-uploads",
  S3_REGION: "us-east-1",
  S3_ENDPOINT: "https://s3.memoria.example",
  S3_ACCESS_KEY_ID: "uploads-access",
  S3_SECRET_ACCESS_KEY: "uploads-secret",
};

function validate(extra: Record<string, string>) {
  const result = spawnSync(process.execPath, [script], {
    env: { ...productionWithoutMail, ...extra },
    encoding: "utf8",
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("validate-env mail rule", () => {
  it("accepts staging without a mail provider", () => {
    const result = validate({ DEPLOYMENT_STAGE: "staging" });
    expect(result.output).toContain("Environment validation passed.");
    expect(result.status).toBe(0);
  });

  it("still requires a mail provider in production", () => {
    const result = validate({});
    expect(result.status).toBe(1);
    expect(result.output).toContain("EMAIL_PROVIDER");
    expect(result.output).toContain("EMAIL_SENDER_VERIFIED");
  });

  it("accepts production with Resend", () => {
    const result = validate({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "resend-key-prod",
      EMAIL_FROM: "noreply@memoria.example",
      EMAIL_SENDER_VERIFIED: "true",
      EMAIL_DELIVERY_PROBE_TO: "operator@memoria.example",
    });
    expect(result.output).toContain("Environment validation passed.");
    expect(result.status).toBe(0);
  });
});
