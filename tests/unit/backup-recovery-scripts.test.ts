import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const backup = readFileSync("scripts/backup-database.sh", "utf8");
const restore = readFileSync("scripts/restore-database.sh", "utf8");
const schedule = readFileSync("scripts/run-backup-schedule.sh", "utf8");
const freshness = readFileSync("scripts/check-backup-freshness.sh", "utf8");
const compose = readFileSync("docker-compose.yml", "utf8");
const restoreCompose = readFileSync("docker-compose.restore.yml", "utf8");

describe("backup and recovery scripts", () => {
  it("publishes an authenticated database and object manifest", () => {
    expect(backup).toContain('"schema_version": 1');
    expect(backup).toContain("backup_object_storage");
    expect(backup).toContain("openssl dgst -sha256 -hmac");
    expect(backup).toContain("inventory.sha256");
    expect(backup).toContain('COMPRESSION_LEVEL="-9"');
    expect(backup).toContain('BACKUP_S3_SSE" != "none"');
    expect(backup).toContain("get-bucket-versioning");
    expect(backup).toContain("Production backup storage must be off-host");
    expect(backup).toContain("--no-owner");
    expect(backup).toContain("--no-privileges");
    expect(backup.indexOf('"${manifest_file}.hmac"')).toBeLessThan(
      backup.lastIndexOf('s3 cp "$manifest_file"'),
    );
  });

  it("retention deletes expired daily/<date>/ prefixes recursively", () => {
    expect(backup).toContain('"$marker" == "PRE"');
    expect(backup).toContain(
      'backup_aws s3 rm "s3://${BACKUP_BUCKET}/daily/$prefix" --recursive',
    );
    expect(backup).not.toContain("read -r date time size file");
  });

  it("pins the backup client to the PostgreSQL server major", () => {
    const backupImage = readFileSync("Dockerfile.backup", "utf8");
    const clientMajor = /^FROM postgres:(\d+)/m.exec(backupImage)?.[1];
    const serverMajors = [compose, restoreCompose].map(
      (file) => /pgvector\/pgvector:pg(\d+)/.exec(file)?.[1],
    );
    expect(clientMajor).toBeDefined();
    for (const serverMajor of serverMajors) {
      expect(serverMajor).toBe(clientMajor);
    }
  });

  it("fails closed before restore and stops on SQL errors", () => {
    expect(restore).toContain("Backup manifest authentication failed");
    expect(restore).toContain("-v ON_ERROR_STOP=1");
    expect(restore).toContain("sha256sum -c");
    expect(restore).toContain(
      'download_backup "$BACKUP_DATE" "$backup_file" "$manifest_file"',
    );
    expect(restore).toContain('actual=$(sha256sum "$backup_file"');
    expect(restore).not.toContain(
      "Checksum file not found, skipping verification",
    );
  });

  it("schedules backup and freshness checks independently", () => {
    expect(schedule).toContain(
      'INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-3600}"',
    );
    expect(schedule).toContain("memoria-backup.lock");
    expect(freshness).toContain("backup_freshness_failures_total");
    expect(freshness).toContain("backup_last_success_timestamp_seconds");
    expect(compose).toContain("backup-monitor:");
    expect(compose).not.toContain("backup-minio:");
  });

  it("restores an exact candidate only into the isolated drill stack", () => {
    expect(restore).toContain("--manifest-key");
    expect(restore).toContain("Restore drills require an exact --manifest-key");
    expect(restore).toContain("Measured RPO");
    expect(restore).toContain("Measured RTO");
    expect(restoreCompose).toContain("restore-postgres:");
    expect(restoreCompose).toContain("RESTORE_ISOLATED_ACK: 'true'");
    expect(restoreCompose).not.toContain("postgres:5432");
  });

  describe("S3 client settings for Cloudflare R2", () => {
    // Evaluate the script's own settings block (from the AWS_REGION default to
    // the end of the R2 region switch) in bash, so the test fails if the
    // exports or the endpoint match drift, not just if the text changes.
    function awsSettings(script: string, env: Record<string, string>) {
      const start = script.indexOf('AWS_REGION="${AWS_REGION:-us-east-1}"');
      const endMarker = '    AWS_REGION="auto"\nfi\n';
      const end = script.indexOf(endMarker, start) + endMarker.length;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const result = spawnSync(
        "bash",
        [
          "-c",
          `set -euo pipefail\n${script.slice(start, end)}\n` +
            'echo "$AWS_REGION|${AWS_REQUEST_CHECKSUM_CALCULATION:-}|${AWS_RESPONSE_CHECKSUM_VALIDATION:-}"',
        ],
        {
          encoding: "utf8",
          env: { PATH: process.env["PATH"] ?? "", ...env },
        },
      );
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const [region, request, response] = result.stdout.trim().split("|");
      return { region, request, response };
    }

    const scripts = { backup, restore, freshness };

    for (const [name, script] of Object.entries(scripts)) {
      it(`${name} sends checksums only when required`, () => {
        const settings = awsSettings(script, {});
        expect(settings.request).toBe("when_required");
        expect(settings.response).toBe("when_required");
      });

      it(`${name} selects region auto only for R2 endpoints`, () => {
        const r2 = "https://abc123.r2.cloudflarestorage.com";
        expect(awsSettings(script, { BACKUP_S3_ENDPOINT: r2 }).region).toBe(
          "auto",
        );
        expect(awsSettings(script, { S3_ENDPOINT: `${r2}/` }).region).toBe(
          "auto",
        );
        expect(
          awsSettings(script, { BACKUP_S3_ENDPOINT: "http://seaweedfs:8333" })
            .region,
        ).toBe("us-east-1");
        expect(
          awsSettings(script, {
            S3_ENDPOINT: "https://r2.cloudflarestorage.com.example.test",
          }).region,
        ).toBe("us-east-1");
        expect(
          awsSettings(script, {
            S3_ENDPOINT: "https://example.test/x.r2.cloudflarestorage.com",
          }).region,
        ).toBe("us-east-1");
        expect(
          awsSettings(script, {
            AWS_REGION: "eu-west-1",
            S3_ENDPOINT: "http://seaweedfs:8333",
          }).region,
        ).toBe("eu-west-1");
      });
    }
  });

  it("documents the restore drill so a finished init job cannot abort it", () => {
    const doc = readFileSync("docs/operations/backup-recovery.md", "utf8");
    expect(doc).toContain(
      "--exit-code-from restore-runner \\\n  --attach restore-runner",
    );
  });
});
