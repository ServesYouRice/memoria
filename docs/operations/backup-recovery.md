# Backup and recovery

The deployment operator owns recovery. Production targets an RPO of one hour
and an RTO of four hours. Database dumps, upload archives, inventories, and
authenticated manifests must be written to a separate, versioned backup bucket.

## Backup

1. Configure `BACKUP_BUCKET`, `BACKUP_MANIFEST_HMAC_KEY`, database credentials,
   and the application `S3_*` variables. The backup bucket must use encryption,
   object versioning, and a lifecycle policy of at least 35 days.
   `BACKUP_S3_SSE` defaults to `AES256`; use `none` only for non-production
   S3-compatible targets that provide encryption at the storage layer.
2. Run `scripts/backup-database.sh --environment prod` at least hourly. Alert on
   a nonzero exit and run `scripts/check-backup-freshness.sh` every 15 minutes.
3. Treat the manifest upload as the completion marker. A prefix without a valid
   manifest, checksum, and HMAC is incomplete and must never be restored.

## Isolated restore drill

1. Create empty PostgreSQL and S3-compatible targets with production-equivalent
   versions. Never point the drill at production resources.
2. Select the latest completed backup prefix and run
   `scripts/restore-database.sh --backup-date YYYY-MM-DD --target-database memoria_restore`.
   The script recreates the database, stops on the first SQL error, verifies the
   object inventory, and replaces the empty target bucket contents.
3. Record start/end UTC time, backup creation time, restored table/canvas/item/
   upload counts, manifest and representative object hashes, and measured
   RPO/RTO. The drill fails if RPO exceeds one hour or RTO exceeds four hours.
4. Start one app instance against the isolated targets. Verify login, an
   authorized canvas read, representative private image reads, one canvas write,
   and one upload/delete cycle. Confirm unauthorized asset reads still fail.
5. Destroy the isolated targets after preserving the sanitized drill evidence.

## Incident recovery

Keep production read-only while validating the candidate restore. If validation
passes, rotate database, S3, session, encryption, backup-manifest, email, and
operator tokens before switching traffic. If validation fails, keep the old
environment isolated, restore the preceding completed manifest, or apply a
forward fix. Do not merge partial database and object snapshots.
