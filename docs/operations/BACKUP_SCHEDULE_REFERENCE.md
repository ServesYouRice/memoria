# Backup Schedule Reference

**Version:** 1.0
**Last Updated:** 2025-11-10
**Owner:** Database Operations Team

---

## Table of Contents

1. [Daily Backup Schedule](#daily-backup-schedule)
2. [Weekly Summary](#weekly-summary)
3. [Monthly Maintenance Window](#monthly-maintenance-window)
4. [Quarterly Disaster Recovery Schedule](#quarterly-disaster-recovery-schedule)
5. [Quick Command Reference](#quick-command-reference)
6. [Escalation Procedures](#escalation-procedures)

---

## Daily Backup Schedule

### Standard Schedule (Monday - Sunday)

```
TIME (UTC)  ACTIVITY                        DURATION    STATUS    FREQUENCY
-----       --------                        --------    ------    ---------
02:00       Full Database Backup Start      30-45 min   Daily     Mon-Sun
02:00       WAL Archiving (Continuous)      Continuous  Active    24/7
05:00       Backup Verification Complete   —           Auto      Daily
06:00       S3 Upload Complete              —           Auto      Daily
14:00       Incremental WAL Check           5 min       Manual    3x/day
19:00       Backup Size Monitoring          —           Auto      Daily
23:59       EOD Backup Status Report        —           Auto      Daily
```

### Timeline View

```
Monday through Sunday (Repeating):
├─ 02:00 UTC: Full backup starts (pg_basebackup or pg_dump)
│  ├─ Database read consistency checked
│  ├─ Full backup created (30-45 min)
│  ├─ Compression applied
│  └─ Checksum calculated (SHA-256)
│
├─ 02:30 UTC: WAL archiving in progress
│  ├─ Transaction logs continuously streamed to S3
│  ├─ Incremental backups created every 6 hours
│  └─ Old WAL files rotated after 7 days
│
├─ 03:00 UTC: S3 upload process
│  ├─ Backup file uploaded to S3
│  ├─ Encryption applied (AES-256)
│  ├─ Metadata stored
│  └─ Cross-region replication initiated
│
├─ 05:00 UTC: Backup verification
│  ├─ SHA-256 checksum validation
│  ├─ S3 object existence verified
│  └─ Size anomaly detection
│
├─ 06:00 UTC: Cleanup phase
│  ├─ Temporary files removed
│  ├─ Old backups rotated (>30 days deleted)
│  └─ Log files archived
│
└─ 23:59 UTC: Daily status report
   ├─ Backup success/failure recorded
   ├─ Metrics sent to CloudWatch
   └─ Alerts triggered if issues detected
```

---

## Weekly Summary

### Backup Overview by Day

| Day | Time | Backup Type | Duration | Size | Retention | Notes |
|-----|------|-------------|----------|------|-----------|-------|
| Mon | 2:00 AM UTC | Full | 40 min | ~2.5 GB | 30 days | Standard |
| Tue | 2:00 AM UTC | Full | 40 min | ~2.5 GB | 30 days | Standard |
| Wed | 2:00 AM UTC | Full | 40 min | ~2.5 GB | 30 days | Standard |
| Thu | 2:00 AM UTC | Full | 40 min | ~2.5 GB | 30 days | Standard |
| Fri | 2:00 AM UTC | Full | 40 min | ~2.5 GB | 30 days | Standard |
| Sat | 2:00 AM UTC | Full | 40 min | ~2.5 GB | 30 days | **Weekly** |
| Sun | 2:00 AM UTC | Full | 40 min | ~2.5 GB | 90 days | **Weekly** |

**Weekly Backup Special Note:**
- Saturday and Sunday backups are retained as "weekly" backups
- These are kept in separate S3 prefix: `s3://backups-prod/weekly/`
- Retention period: 12 weeks (3 months)
- Automatic move to warm storage (Glacier) after 30 days

### Weekly Maintenance Activities

**Every Sunday at 08:00 AM UTC:**
- Monthly restore test (if scheduled for 2nd Sunday)
- Backup inventory audit
- Storage usage report
- Performance analysis

---

## Monthly Maintenance Window

### 1st of Month: Monthly Full Backup

```
Schedule: 2025-11-01 02:00 UTC

Backup File Path:
s3://backups-prod/monthly/2025-11-01-monthly-full-backup.sql.gz

Retention: 12 months (annual policy)
Storage Tier: Warm (moved to Glacier after 30 days)
Automation: Automatic via lifecycle policy
```

### 2nd Sunday of Month: Restore Test

```
Schedule: 2025-11-10 10:00 AM UTC

Test Procedure:
1. Notify ops team
2. Reserve test environment
3. Download backup from Day -1
4. Restore to test database
5. Run integrity checks
6. Document results
7. Cleanup test resources

Success Criteria:
- Restore completes within RTO (1 hour)
- All tables restored with correct record counts
- Foreign key integrity verified
- No corruption detected

Expected Duration: 2 hours
```

### Month-End: Backup Audit

```
Schedule: Last Friday of month 05:00 PM UTC

Checklist:
□ Review all backups for the month
□ Verify retention periods maintained
□ Check for any failed backups
□ Validate storage usage
□ Confirm encryption is active
□ Audit S3 access logs
□ Generate compliance report

Owner: Database Operations Manager
Approval: CTO/Infrastructure Lead
```

---

## Quarterly Disaster Recovery Schedule

### Q1 (January-March)

```
Schedule: 2025-01-03 (1st Friday) 2:00 PM UTC

Scope: Full disaster recovery drill
Duration: 3-4 hours
Expected RTO Achievement: < 1 hour
Expected RPO Achievement: < 5 minutes

Participants:
- Database Operations Team
- Infrastructure Team
- Application Engineering Team
- Incident Commander

Activities:
1. Simulate infrastructure failure
2. Initiate recovery procedures
3. Restore from backup
4. Deploy applications
5. Perform switchover
6. Validate data integrity
7. Document lessons learned

Success Criteria:
- Full recovery achieved within RTO
- No data loss beyond RPO
- Application functional on recovery infrastructure
- All validation checks pass
```

### Q2 (April-June)

```
Schedule: 2025-04-04 (1st Friday) 2:00 PM UTC
Same procedure as Q1
```

### Q3 (July-September)

```
Schedule: 2025-07-04 (1st Friday) 2:00 PM UTC
Same procedure as Q1
```

### Q4 (October-December)

```
Schedule: 2025-10-03 (1st Friday) 2:00 PM UTC
Same procedure as Q1
```

---

## Quick Command Reference

### Backup Operations

#### Run a manual backup
```bash
/home/user/notes/scripts/backup-database.sh --environment prod --verbose
```

#### Dry-run to preview
```bash
/home/user/notes/scripts/backup-database.sh --environment prod --dry-run --verbose
```

#### Check backup status
```bash
aws s3 ls s3://backups-prod-us-east-1/daily/ --recursive | tail -10
```

#### List available backups
```bash
aws s3 ls s3://backups-prod-us-east-1/daily/ | sort -r
```

#### Download specific backup
```bash
aws s3 cp s3://backups-prod-us-east-1/daily/2025-11-09/ ./backups/ --recursive
```

#### Verify backup integrity
```bash
aws s3 cp s3://backups-prod-us-east-1/daily/2025-11-09-full-backup.sql.gz.sha256 .
sha256sum -c 2025-11-09-full-backup.sql.gz.sha256
```

### Restore Operations

#### Restore from specific date
```bash
/home/user/notes/scripts/restore-database.sh \
  --backup-date 2025-11-09 \
  --environment prod
```

#### Restore with Point-in-Time Recovery (PITR)
```bash
/home/user/notes/scripts/restore-database.sh \
  --backup-date 2025-11-09 \
  --target-time "2025-11-09 14:30:00" \
  --environment prod
```

#### Restore to different database
```bash
/home/user/notes/scripts/restore-database.sh \
  --backup-date 2025-11-09 \
  --target-database test_recovery \
  --environment prod
```

#### Dry-run restore
```bash
/home/user/notes/scripts/restore-database.sh \
  --backup-date 2025-11-09 \
  --dry-run --verbose
```

### Monitoring

#### Check WAL archiving status
```bash
psql -U postgres -c "SELECT * FROM pg_stat_archiver;"
```

#### Monitor backup metrics
```bash
aws cloudwatch get-metric-statistics \
  --namespace "DatabaseBackups" \
  --metric-name "BackupSizeBytes" \
  --start-time 2025-11-02T00:00:00Z \
  --end-time 2025-11-09T23:59:59Z \
  --period 86400 \
  --statistics Average
```

#### Check backup logs
```bash
tail -100 /var/log/db-backup.log
tail -100 /var/log/db-restore.log
```

#### View recent CloudWatch logs
```bash
aws logs tail /aws/rds/instance/production --follow
```

---

## Escalation Procedures

### Backup Failure (CRITICAL)

**Alert Trigger:** Backup failed to complete within 90 minutes of scheduled time

**Immediate Actions (First 5 minutes):**
1. Check backup script logs: `tail -100 /var/log/db-backup.log`
2. Verify database connectivity: `psql -h localhost -U postgres -c "SELECT version();"`
3. Check S3 permissions: `aws s3 ls s3://backups-prod-us-east-1/`
4. Check disk space: `df -h` (look for PostgreSQL data directory)

**Investigation (5-30 minutes):**
```bash
# Check PostgreSQL logs
tail -100 /var/log/postgresql/postgresql.log | grep -i error

# Verify archive command works
aws s3 cp test-file s3://backups-prod-us-east-1/ && aws s3 rm s3://backups-prod-us-east-1/test-file

# Check database activity
psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Check system resources
top -b -n 1 | head -20
iostat -x 1 5
```

**Escalation Path:**
1. Alert on-call DBA → 5 min
2. Notify infrastructure lead → 10 min
3. Engage AWS support → 15 min (if AWS issue)
4. Post incident review → After resolution

**Resolution Steps:**
- Fix root cause (connectivity, permissions, disk space, etc.)
- Manual backup if needed: `./backup-database.sh --verbose`
- Verify backup uploaded to S3
- Confirm next scheduled backup
- Create incident ticket with root cause

---

### PITR Window Loss (WARNING)

**Alert Trigger:** WAL files older than 7 days present in database

**Symptoms:**
- Recovery time window shrinking
- Cannot restore to timestamps beyond recent days
- WAL archiving failures in PostgreSQL logs

**Mitigation Steps:**
```bash
# Check WAL archiving status
psql -U postgres -c "
  SELECT pg_catalog.pg_walfile_name(redo_lsn),
         pg_catalog.pg_walfile_name(pg_current_wal_lsn())
  FROM pg_control_recovery();"

# Verify WAL files in S3
aws s3 ls s3://backups-prod-us-east-1/wal/ --recursive | tail -20

# Force WAL archiving
psql -U postgres -c "SELECT pg_switch_wal();"

# Check archive status
psql -U postgres -c "SELECT * FROM pg_stat_archiver;"
```

**Recovery Actions:**
1. Investigate WAL archiving failures
2. Manually archive WAL files to S3
3. Verify archive command configuration
4. Restart PostgreSQL if needed
5. Monitor archiving for 24 hours

---

### Database Size Anomaly (WARNING)

**Alert Trigger:** Backup size > 150% of average OR < 50% of average

**Investigation:**
```bash
# Get database size
psql -U postgres -c "
  SELECT pg_database.datname,
         pg_size_pretty(pg_database_size(pg_database.datname))
  FROM pg_database;"

# Check table sizes
psql -U postgres -c "
  SELECT schemaname, tablename,
         pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
  FROM pg_tables
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
  LIMIT 10;"

# Check for recent schema changes
psql -U postgres -c "
  SELECT * FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC LIMIT 10;"
```

**Possible Causes:**
- Large data import/export
- New table or index creation
- VACUUM/AUTOVACUUM issue
- Data cleanup or archival

**Resolution:**
- If expected: Update monitoring thresholds
- If unexpected: Investigate data changes
- Contact application team if unusual
- Update documentation with changes

---

### Restore Operation Failure (CRITICAL)

**Alert Trigger:** Restore job fails with non-zero exit code

**Immediate Actions:**
```bash
# Check restore logs
tail -200 /var/log/db-restore.log

# Verify backup file integrity
aws s3 cp s3://backups-prod-us-east-1/daily/YYYY-MM-DD/*.sha256 .
sha256sum -c *.sha256

# List available backups
aws s3 ls s3://backups-prod-us-east-1/daily/ | sort -r | head -10

# Check target database status
psql -h localhost -U postgres -l | grep test_recovery
```

**Common Issues & Solutions:**

1. **Database Connection Failed**
   - Check PostgreSQL is running: `systemctl status postgresql`
   - Verify credentials: `psql -U postgres -c "SELECT 1;"`
   - Check firewall: `sudo ufw status` (Linux) or equivalent

2. **Insufficient Disk Space**
   - Check available space: `df -h /var/lib/postgresql`
   - Clear old WAL files: `rm -f /var/lib/postgresql/wal_archive/*`
   - Expand disk if needed

3. **Corrupted Backup**
   - Verify checksum fails consistently
   - Try previous day's backup
   - Check S3 for bucket issues

4. **PITR Window Not Available**
   - Verify WAL files exist: `aws s3 ls s3://backups-prod-us-east-1/wal/`
   - Check WAL file count and dates
   - Fallback to full backup if WAL unavailable

**Escalation:**
- Contact database operations team
- Escalate to infrastructure if backup corruption suspected
- Engage AWS support for S3 issues
- Create incident ticket

---

## Contact Information

**On-Call Database Administrator:**
- Phone: [Set in PagerDuty]
- Email: database-ops@company.com
- Slack: #database-alerts

**Database Operations Team:**
- Manager: [Contact Name]
- Email: database-team@company.com
- Slack: #database-operations

**Infrastructure Team (For AWS/Cloud Issues):**
- Lead: [Contact Name]
- Email: infrastructure@company.com
- Slack: #infrastructure

---

## References

- [DATABASE_BACKUP_POLICY.md](./DATABASE_BACKUP_POLICY.md)
- [backup-database.sh](../../scripts/backup-database.sh)
- [restore-database.sh](../../scripts/restore-database.sh)
- PostgreSQL Backup Documentation: https://www.postgresql.org/docs/15/backup.html

---

**Document History:**

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-10 | Initial creation |

---

**Last Verified:** 2025-11-10
**Next Review:** 2026-02-10
