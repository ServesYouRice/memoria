import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import path from "path";

describe("self-host configuration enforceability (IMP-042 / IMP-055)", () => {
  const rootDir = path.resolve(import.meta.dirname, "../../");

  describe(".env.example completeness", () => {
    it("contains all critical security and operational variables", () => {
      const envExample = readFileSync(
        path.join(rootDir, ".env.example"),
        "utf8",
      );

      const requiredKeys = [
        "DATABASE_URL",
        "REDIS_URL",
        "AUTH_SECRET",
        "APP_BOOTSTRAP_TOKEN",
        "REGISTRATION_MODE",
        "INTERNAL_OPERATIONS_TOKEN",
        "TRUSTED_PROXY_CIDRS",
        "AUTH_RATE_LIMIT_MAX_REQUESTS",
        "API_RATE_LIMIT_MAX_REQUESTS",
        "UPLOAD_RATE_LIMIT_MAX_REQUESTS",
        "CRON_SECRET",
        "MODEL_CREDENTIAL_ENCRYPTION_KEY",
        "UPLOAD_STORAGE",
        "S3_BUCKET",
        "BACKUP_BUCKET",
        "BACKUP_MANIFEST_HMAC_KEY",
      ];

      for (const key of requiredKeys) {
        expect(envExample).toContain(`${key}=`);
      }
    });
  });

  describe("docker-compose.yml configuration pass-through", () => {
    it("passes all critical variables through to the app service", () => {
      const composeContent = readFileSync(
        path.join(rootDir, "docker-compose.yml"),
        "utf8",
      );

      const expectedAppEnv = [
        "REGISTRATION_MODE: ${REGISTRATION_MODE:-open}",
        "TRUSTED_PROXY_CIDRS: ${TRUSTED_PROXY_CIDRS:-}",
        "AUTH_RATE_LIMIT_MAX_REQUESTS: ${AUTH_RATE_LIMIT_MAX_REQUESTS:-5}",
        "API_RATE_LIMIT_MAX_REQUESTS: ${API_RATE_LIMIT_MAX_REQUESTS:-100}",
        "UPLOAD_RATE_LIMIT_MAX_REQUESTS: ${UPLOAD_RATE_LIMIT_MAX_REQUESTS:-10}",
        "INTERNAL_OPERATIONS_TOKEN: ${INTERNAL_OPERATIONS_TOKEN}",
        "MODEL_CREDENTIAL_ENCRYPTION_KEY: ${MODEL_CREDENTIAL_ENCRYPTION_KEY}",
        "CRON_SECRET: ${CRON_SECRET}",
        "BACKUP_MANIFEST_HMAC_KEY: ${BACKUP_MANIFEST_HMAC_KEY:-}",
      ];

      for (const envLine of expectedAppEnv) {
        expect(composeContent).toContain(envLine);
      }
    });

    it("separates host port from fixed container port 3000", () => {
      const composeContent = readFileSync(
        path.join(rootDir, "docker-compose.yml"),
        "utf8",
      );
      expect(composeContent).toContain("127.0.0.1:${APP_HOST_PORT:-3000}:3000");
    });
  });

  describe("Caddyfile ingress topology", () => {
    it("exists and defines operations route blocking and body size limits", () => {
      expect(existsSync(path.join(rootDir, "Caddyfile"))).toBe(true);
      const caddyContent = readFileSync(
        path.join(rootDir, "Caddyfile"),
        "utf8",
      );

      expect(caddyContent).toContain("/api/operations/*");
      expect(caddyContent).toContain("max_size 50MB");
      expect(caddyContent).toContain("reverse_proxy app:3000");
    });
  });

  describe("production environment validation and doctor enforcement", () => {
    it("rejects placeholder secrets in src/lib/env.ts under NODE_ENV=production", () => {
      const result = spawnSync("pnpm", ["exec", "tsx", "src/lib/env.ts"], {
        env: {
          ...process.env,
          NODE_ENV: "production",
          MEMORIA_SKIP_ENV_FILE_LOAD: "true",
          AUTH_SECRET: "replace-me-placeholder-secret-1234567890123456",
          DATABASE_URL: "postgresql://memoria:pass@localhost:5432/memoria",
          AUTH_URL: "https://memoria.example",
        },
        cwd: rootDir,
        shell: true,
      });

      expect(result.status).not.toBe(0);
      const output =
        (result.stderr ? result.stderr.toString("utf8") : "") +
        (result.stdout ? result.stdout.toString("utf8") : "");
      expect(output).toContain("AUTH_SECRET contains a known placeholder");
    }, 20000);

    it("scripts/doctor.mjs reports failure and exits non-zero on placeholder values in production", () => {
      // Written outside the repository so an interrupted run cannot leave an
      // untracked `.env.*` file behind: .gitignore lists specific env files,
      // not a wildcard.
      const tempEnv = path.join(tmpdir(), ".env.test-doctor-placeholder");
      writeFileSync(
        tempEnv,
        [
          "NODE_ENV=production",
          "AUTH_SECRET=replace-me-placeholder-secret-12345",
          "APP_BOOTSTRAP_TOKEN=replace-me-token-12345678901234",
          "INTERNAL_OPERATIONS_TOKEN=replace-me-token-12345678901234",
          "MODEL_CREDENTIAL_ENCRYPTION_KEY=replace-me-token-12345678901234",
          "CRON_SECRET=replace-me-token-12345678901234",
          "BACKUP_MANIFEST_HMAC_KEY=replace-me-token-12345678901234",
        ].join("\n"),
        "utf8",
      );

      try {
        const result = spawnSync(
          process.execPath,
          [path.join(rootDir, "scripts/doctor.mjs"), "--json"],
          {
            env: {
              ...process.env,
              MEMORIA_ENV_FILE: tempEnv,
            },
            cwd: rootDir,
          },
        );

        expect(result.status).not.toBe(0);
        const output = result.stdout.toString("utf8");
        expect(output).toContain("Contains a known placeholder value");
      } finally {
        if (existsSync(tempEnv)) {
          unlinkSync(tempEnv);
        }
      }
    }, 25000);
  });
});
