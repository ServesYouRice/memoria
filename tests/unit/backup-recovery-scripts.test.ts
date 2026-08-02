import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const backup = readFileSync("scripts/backup-database.sh", "utf8");
const restore = readFileSync("scripts/restore-database.sh", "utf8");

describe("backup and recovery scripts", () => {
  it("publishes an authenticated database and object manifest", () => {
    expect(backup).toContain('"schema_version": 1');
    expect(backup).toContain("backup_object_storage");
    expect(backup).toContain("openssl dgst -sha256 -hmac");
    expect(backup).toContain("inventory.sha256");
    expect(backup).toContain('COMPRESSION_LEVEL="-9"');
    expect(backup).toContain('BACKUP_S3_SSE" != "none"');
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
});
