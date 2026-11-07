import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import { createServer } from "net";
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

    it("pins the gateway network and passes TRUSTED_PROXY_CIDRS to app, sync and worker (IMP-047)", () => {
      const composeContent = readFileSync(
        path.join(rootDir, "docker-compose.yml"),
        "utf8",
      );
      expect(composeContent).toContain("subnet: 172.29.47.0/28");
      const setupContent = readFileSync(
        path.join(rootDir, "scripts/setup.mjs"),
        "utf8",
      );
      expect(setupContent).toContain("EDGE_NETWORK_CIDR = '172.29.47.0/28'");
      expect(setupContent).toContain("'TRUSTED_PROXY_CIDRS'");
      const services = composeContent.split(/\n(?=  [a-z-]+:\n)/);
      for (const name of ["app", "sync", "outbox-worker"]) {
        const block = services.find((entry) =>
          entry.trimStart().startsWith(`${name}:`),
        );
        expect(block, name).toContain(
          "TRUSTED_PROXY_CIDRS: ${TRUSTED_PROXY_CIDRS:-}",
        );
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
      // The 50MB allowance must cover the real upload routes, not /uploads.
      expect(caddyContent).toContain(
        "path /api/v1/upload /api/v1/canvases/*/thumbnail",
      );
      expect(caddyContent).not.toContain("/api/v1/uploads ");
      expect(caddyContent).toContain(
        "reverse_proxy {$MEMORIA_APP_UPSTREAMS:app:3000}",
      );
      // Every collaboration socket goes to the realtime replicas (IMP-043).
      expect(caddyContent).toContain("path /api/collaboration/*");
      expect(caddyContent).toContain(
        "reverse_proxy @collaboration {$MEMORIA_SYNC_UPSTREAMS:sync:3001}",
      );
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

    it("scripts/doctor.mjs warns when behind a proxy with empty TRUSTED_PROXY_CIDRS (IMP-047)", () => {
      const run = (cidrs: string) => {
        const tempEnv = path.join(
          tmpdir(),
          `.env.test-doctor-proxy-${process.pid}`,
        );
        writeFileSync(
          tempEnv,
          [
            "AUTH_URL=https://memoria.example",
            `TRUSTED_PROXY_CIDRS=${cidrs}`,
          ].join("\n"),
          "utf8",
        );
        try {
          const result = spawnSync(
            process.execPath,
            [path.join(rootDir, "scripts/doctor.mjs"), "--json"],
            {
              env: { ...process.env, MEMORIA_ENV_FILE: tempEnv },
              cwd: rootDir,
            },
          );
          return result.stdout.toString("utf8");
        } finally {
          if (existsSync(tempEnv)) unlinkSync(tempEnv);
        }
      };
      expect(run("")).toContain("trusted-proxy");
      expect(run("172.29.47.0/28")).not.toContain("trusted-proxy");
    }, 25000);
  });

  describe("SMTP as a production email provider (IMP-054)", () => {
    const productionEnv: Record<string, string> = {
      NODE_ENV: "production",
      MEMORIA_SKIP_ENV_FILE_LOAD: "true",
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

    function validateProductionEnv(
      overrides: Record<string, string | undefined>,
    ) {
      const env: Record<string, string> = {
        ...process.env,
        ...productionEnv,
      } as Record<string, string>;
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete env[key];
        } else {
          env[key] = value;
        }
      }
      return spawnSync("pnpm", ["exec", "tsx", "src/lib/env.ts"], {
        env,
        cwd: rootDir,
        shell: true,
      });
    }

    function outputOf(result: ReturnType<typeof spawnSync>) {
      return (
        (result.stderr ? result.stderr.toString("utf8") : "") +
        (result.stdout ? result.stdout.toString("utf8") : "")
      );
    }

    it("accepts EMAIL_PROVIDER=smtp in production when the SMTP settings are present", () => {
      const result = validateProductionEnv({});

      expect(outputOf(result)).not.toContain("EMAIL_PROVIDER must be");
      expect(result.status).toBe(0);
    }, 30000);

    it("requires the SMTP host when EMAIL_PROVIDER=smtp in production", () => {
      const result = validateProductionEnv({ SMTP_HOST: undefined });

      expect(result.status).not.toBe(0);
      expect(outputOf(result)).toContain(
        "SMTP_HOST is required when EMAIL_PROVIDER=smtp.",
      );
    }, 30000);

    it("rejects a REDIS_KEY_PREFIX that is not a literal namespace", () => {
      const result = validateProductionEnv({ REDIS_KEY_PREFIX: "memoria*" });

      expect(result.status).not.toBe(0);
      expect(outputOf(result)).toContain("REDIS_KEY_PREFIX must be");
    }, 30000);

    it("names smtp among the production providers when console is configured", () => {
      const result = validateProductionEnv({ EMAIL_PROVIDER: "console" });

      expect(result.status).not.toBe(0);
      expect(outputOf(result)).toContain(
        "EMAIL_PROVIDER must be sendgrid, resend, or smtp in production.",
      );
    }, 30000);

    it("doctor names the missing SMTP credentials for EMAIL_PROVIDER=smtp", () => {
      const tempEnv = path.join(tmpdir(), ".env.test-doctor-smtp-missing");
      writeFileSync(
        tempEnv,
        [
          "NODE_ENV=development",
          "EMAIL_PROVIDER=smtp",
          "SMTP_HOST=127.0.0.1",
          "SMTP_PORT=1",
        ].join("\n"),
        "utf8",
      );

      try {
        const result = spawnSync(
          process.execPath,
          [path.join(rootDir, "scripts/doctor.mjs")],
          {
            env: { ...process.env, MEMORIA_ENV_FILE: tempEnv },
            cwd: rootDir,
          },
        );

        expect(outputOf(result)).toContain(
          "FAIL email-provider: Missing SMTP_USER, SMTP_PASS for EMAIL_PROVIDER=smtp",
        );
      } finally {
        if (existsSync(tempEnv)) {
          unlinkSync(tempEnv);
        }
      }
    }, 25000);

    it("doctor probes the configured SMTP server port", async () => {
      const listener = createServer();
      await new Promise<void>((resolve) =>
        listener.listen(0, "127.0.0.1", () => resolve()),
      );
      const address = listener.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const tempEnv = path.join(tmpdir(), ".env.test-doctor-smtp-reachable");
      writeFileSync(
        tempEnv,
        [
          "NODE_ENV=development",
          "EMAIL_PROVIDER=smtp",
          "SMTP_HOST=127.0.0.1",
          `SMTP_PORT=${port}`,
          "SMTP_USER=mailer",
          "SMTP_PASS=smtp-password",
        ].join("\n"),
        "utf8",
      );

      try {
        const result = spawnSync(
          process.execPath,
          [path.join(rootDir, "scripts/doctor.mjs")],
          {
            env: { ...process.env, MEMORIA_ENV_FILE: tempEnv },
            cwd: rootDir,
          },
        );

        expect(outputOf(result)).toContain(
          `PASS smtp-server: 127.0.0.1:${port}`,
        );
      } finally {
        await new Promise<void>((resolve) => listener.close(() => resolve()));
        if (existsSync(tempEnv)) {
          unlinkSync(tempEnv);
        }
      }
    }, 25000);
  });
});
