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
});
