# Backup and recovery

The deployment operator owns recovery. Production targets an RPO of one hour
and an RTO of four hours. The reference stack writes database dumps, upload
archives, inventories, and authenticated manifests to a separate backup
account and bucket; the application MinIO service is never the backup target.

## Automatic backup

Before `setup:selfhost`, provision the off-host bucket with object versioning
enabled and a lifecycle of at least 35 days. Configure `BACKUP_BUCKET`,
`BACKUP_S3_REGION`, dedicated `BACKUP_S3_ACCESS_KEY_ID` and
`BACKUP_S3_SECRET_ACCESS_KEY` credentials, optional `BACKUP_S3_ENDPOINT`, and a
distinct `BACKUP_MANIFEST_HMAC_KEY`. `BACKUP_S3_SSE` defaults to `AES256` and
must remain enabled in production.

The default Compose stack runs two independent services:

- `backup` snapshots PostgreSQL and the private object bucket immediately and
  then every 3,600 seconds. It refuses a same-endpoint production destination,
  requires versioning, encrypts uploads, and publishes the authenticated
  manifest last as the completion marker.
- `backup-monitor` queries the off-host bucket every 15 minutes. It fails and
  increments the shared freshness counter if no completed manifest exists or
  the newest one is older than 5,400 seconds.

Alerting consumes both the last-success timestamp and the independent failure
counter. A prefix without a manifest, checksum, and valid HMAC is incomplete
and must never be restored.

## Isolated restore drill

Select the exact newest completion marker, not merely a date. For example:

```bash
aws s3api list-objects-v2 \
  --bucket "$BACKUP_BUCKET" \
  --prefix daily/ \
  --query 'reverse(sort_by(Contents[?contains(Key, `manifest-`) && ends_with(Key, `.json`)], &LastModified))[0].Key' \
  --output text
```

Set that value as `RESTORE_MANIFEST_KEY`, then run the disposable stack:

```bash
docker compose --env-file .env.selfhost -f docker-compose.restore.yml up \
  --build --abort-on-container-exit --exit-code-from restore-runner
docker compose -f docker-compose.restore.yml cp \
  restore-runner:/evidence/restore-report.md ./restore-report.md
```

The runner restores the exact authenticated manifest into isolated PostgreSQL
and MinIO services, stops on the first SQL error, verifies every archive and
object inventory hash, and records measured RPO/RTO. The drill exits nonzero if
RPO exceeds one hour or RTO exceeds four hours. Preserve the sanitized report
and log, then remove the isolated stack and its volumes.

Start a temporary app instance against the restored targets and verify login,
an authorized canvas read, representative private image reads, one canvas
write, and one upload/delete cycle. Confirm unauthorized asset reads still
fail. Never point `docker-compose.restore.yml` at production targets.

## Incident recovery

Keep production read-only while validating the candidate restore. If validation
passes, rotate database, S3, session, encryption, backup-manifest, email, and
operator tokens before switching traffic. If validation fails, keep the old
environment isolated, restore the preceding exact completed manifest, or apply
a forward fix. Do not merge partial database and object snapshots.
