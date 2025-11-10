# Database Restore Procedures

**Version:** 1.0
**Last Updated:** 2025-11-10
**Owner:** Database Operations Team
**Status:** Active

---

## Table of Contents

1. [Quick Start: Simple Restore](#quick-start-simple-restore)
2. [Point-in-Time Recovery (PITR)](#point-in-time-recovery-pitr)
3. [Disaster Recovery Scenarios](#disaster-recovery-scenarios)
4. [Testing & Validation](#testing--validation)
5. [Troubleshooting](#troubleshooting)
6. [Post-Restore Checklist](#post-restore-checklist)

---

## Quick Start: Simple Restore

### Scenario: Restore Production Database from Latest Backup

**Time Required:** 1 hour
**Difficulty:** Easy
**Use Case:** Database corruption, accidental data loss (not time-sensitive)

#### Step 1: Get Available Backups

```bash
# List available backups (most recent first)
aws s3 ls s3://backups-prod-us-east-1/daily/ --recursive | sort -r | head -20

# Example output:
# 2025-11-09-full-backup.sql.gz
# 2025-11-08-full-backup.sql.gz
# 2025-11-07-full-backup.sql.gz
```

#### Step 2: Download Backup

```bash
# Set variables
BACKUP_DATE="2025-11-09"
BACKUP_BUCKET="backups-prod-us-east-1"
BACKUP_FILE="2025-11-09-full-backup.sql.gz"

# Download backup (size: ~2.5 GB)
time aws s3 cp s3://${BACKUP_BUCKET}/daily/${BACKUP_DATE}/${BACKUP_FILE} ./

# Verify download (should complete in 2-5 minutes depending on network)
ls -lh ${BACKUP_FILE}
```

#### Step 3: Verify Backup Integrity

```bash
# Download checksum
aws s3 cp s3://${BACKUP_BUCKET}/daily/${BACKUP_DATE}/${BACKUP_FILE}.sha256 ./

# Verify (should take 1-2 minutes)
sha256sum -c ${BACKUP_FILE}.sha256

# Expected output:
# 2025-11-09-full-backup.sql.gz: OK
```

#### Step 4: Stop Application (Production Only)

```bash
# Notify users of maintenance
# Stop application
sudo systemctl stop application-service

# Verify it's stopped
systemctl status application-service

# Terminate existing database connections
psql -U postgres -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = 'production'
  AND pid <> pg_backend_pid();"
```

#### Step 5: Backup Current Database (Safety)

```bash
# Create safety backup of current state
pg_dump -U postgres -d production -Fc > production-$(date +%s).dump

# Verify backup created
ls -lh production-*.dump
```

#### Step 6: Drop and Recreate Database

```bash
# Drop existing database
psql -U postgres -c "DROP DATABASE IF EXISTS production;"

# Create new empty database
psql -U postgres -c "CREATE DATABASE production WITH OWNER postgres;"

# Verify
psql -U postgres -l | grep production
```

#### Step 7: Restore from Backup

```bash
# Decompress and restore (duration: 20-30 minutes)
# Note: -v for verbose output
gunzip -c ${BACKUP_FILE} | \
  time psql -U postgres -d production -v ON_ERROR_STOP=on

# Expected duration: 25 minutes for ~2.5 GB backup
```

#### Step 8: Verify Restoration

```bash
# Check database is accessible
psql -U postgres -d production -c "SELECT version();"

# Count tables (should match pre-restore count)
psql -U postgres -d production -c "
  SELECT COUNT(*) as table_count
  FROM information_schema.tables
  WHERE table_schema='public';"

# Example output should show: table_count = 25 (or your expected count)

# Check largest tables
psql -U postgres -d production -c "
  SELECT tablename, pg_size_pretty(pg_total_relation_size('public.'||tablename))
  FROM pg_tables
  WHERE schemaname='public'
  ORDER BY pg_total_relation_size('public.'||tablename) DESC
  LIMIT 5;"
```

#### Step 9: Run Data Integrity Checks

```bash
# Count key tables
psql -U postgres -d production << 'EOF'
\echo 'Data Integrity Checks'
\echo '==================='
SELECT 'users' as table_name, COUNT(*) as row_count FROM users;
SELECT 'canvases' as table_name, COUNT(*) as row_count FROM canvases;
SELECT 'bookmarks' as table_name, COUNT(*) as row_count FROM bookmarks;
SELECT 'canvas_items' as table_name, COUNT(*) as row_count FROM canvas_items;
\echo ''
\echo 'Check foreign key constraints:'
SELECT COUNT(*) as orphaned_items
FROM canvas_items ci
WHERE ci.canvas_id NOT IN (SELECT id FROM canvases);
EOF

# All checks should show expected values
```

#### Step 10: Start Application

```bash
# Start application service
sudo systemctl start application-service

# Verify it started
systemctl status application-service

# Check logs for errors
tail -50 /var/log/application.log

# Run health check
curl -s http://localhost:3000/api/health | jq .
```

#### Step 11: Smoke Tests

```bash
# Run basic application tests
npm run test:smoke

# Check database connection pool
psql -U postgres -d production -c "
  SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;"

# Monitor for errors (Ctrl+C to stop)
tail -f /var/log/application.log | grep -i error
```

#### Step 12: Cleanup

```bash
# Remove downloaded backup (optional, save if needed for analysis)
rm ${BACKUP_FILE} ${BACKUP_FILE}.sha256

# Archive safety backup
mkdir -p /backups/pre-restore
mv production-*.dump /backups/pre-restore/

# Clear temporary files
rm -rf /tmp/db-restore-*
```

---

## Point-in-Time Recovery (PITR)

### Scenario: Recover from Accidental Data Deletion at Specific Time

**Time Required:** 2 hours
**Difficulty:** Advanced
**Use Case:** Recover to specific point before data loss event
**Example:** User accidentally deleted important records at 2025-11-09 14:30:00

#### Step 1: Identify Recovery Target

```bash
# Determine exact time of data loss
# From application logs, monitoring, or user report
TARGET_TIME="2025-11-09 14:30:00 UTC"

# Identify last good backup
# Should be BEFORE the data loss event
BACKUP_DATE="2025-11-09"  # Backup from 2 AM UTC, before 14:30

# Verify WAL files exist for target time window
# WAL files needed from backup time to target time
echo "Checking WAL availability for PITR window..."
aws s3 ls s3://backups-prod-us-east-1/wal/ --recursive | \
  grep "2025-11-09" | \
  tail -20

# Should show files with timestamps near 14:30
```

#### Step 2: Prepare Recovery Environment

```bash
# Option A: Use Separate Server (Recommended)
# Create new PostgreSQL instance or use test environment
# This avoids disrupting the current production database

# Option B: Same Server (Lower Cost)
# Stop application and database
# Create recovery directory for new cluster

# Create recovery working directory
RECOVERY_DIR="/recovery/pitr-2025-11-09"
mkdir -p ${RECOVERY_DIR}
chmod 700 ${RECOVERY_DIR}
cd ${RECOVERY_DIR}
```

#### Step 3: Download Backup

```bash
# Download full backup from before data loss
BACKUP_BUCKET="backups-prod-us-east-1"
BACKUP_DATE="2025-11-09"
BACKUP_FILE="2025-11-09-full-backup.sql.gz"

echo "Downloading backup (started 02:00 UTC, before 14:30 data loss)..."
time aws s3 cp \
  s3://${BACKUP_BUCKET}/daily/${BACKUP_DATE}/${BACKUP_FILE} \
  ./

# Verify size
ls -lh ${BACKUP_FILE}
```

#### Step 4: Download WAL Files

```bash
# Create WAL directory
mkdir -p ${RECOVERY_DIR}/wal_archive
cd ${RECOVERY_DIR}/wal_archive

# Download all WAL files from backup date onwards
# WAL files needed from 02:00 (backup time) to 14:31 (just after data loss)
echo "Downloading transaction logs for PITR..."
time aws s3 sync \
  s3://${BACKUP_BUCKET}/wal/ . \
  --exclude "*" \
  --include "0000*"

# Count WAL files
ls | wc -l
# Should have files: ~100-150 files for 12+ hour window

# Verify latest WAL file
ls -lt | head -5
```

#### Step 5: Restore Base Backup

```bash
cd ${RECOVERY_DIR}

# For SQL dump format
gunzip -c ${BACKUP_FILE} | \
  psql -U postgres -d test_recovery -v ON_ERROR_STOP=on

# Expected time: 20-30 minutes
```

#### Step 6: Configure PITR

```bash
# Connect to recovered database
psql -U postgres -d test_recovery

# Verify current state (should be at backup time 02:00)
SELECT now();  -- Should show 02:00 or later (database startup time)

-- Verify no post-02:00 data
SELECT COUNT(*) FROM users;  -- Compare to production

-- Check maximum timestamp in logs
SELECT MAX(created_at) FROM audit_logs;
-- Should be around 02:00 UTC
```

#### Step 7: Apply WAL Replay to Target Time (For Physical Backups)

```bash
# For physical pg_basebackup (if used instead of pg_dump):

# Configure recovery.conf (PostgreSQL 11 and earlier)
# or postgresql.conf (PostgreSQL 12+)

cat >> /var/lib/postgresql/15/main/postgresql.conf << 'EOF'
# PITR Configuration
recovery_target_timeline = 'latest'
recovery_target_time = '2025-11-09 14:30:00 UTC'
recovery_target_inclusive = false

# WAL restore command
restore_command = 'cp /recovery/pitr-2025-11-09/wal_archive/%f %p'
EOF

# Create recovery signal file
touch /var/lib/postgresql/15/main/recovery.signal

# Start PostgreSQL in recovery mode
systemctl start postgresql

# Monitor recovery progress
tail -f /var/log/postgresql/postgresql.log | grep -E "recovery|replaying
```

#### Step 8: Verify Recovery Point

```bash
# Connect to recovered database
psql -U postgres -d test_recovery

-- Check recovery status
SELECT database, is_in_recovery FROM pg_control_recovery();
-- Should show: is_in_recovery = false (recovery complete)

-- Verify timestamps around target
SELECT created_at, COUNT(*) as count
FROM audit_logs
WHERE created_at >= '2025-11-09 14:20:00'
  AND created_at <= '2025-11-09 14:40:00'
GROUP BY DATE_TRUNC('minute', created_at)
ORDER BY created_at;

-- The last log entry should be just before 14:30:00
```

#### Step 9: Validate Recovered Data

```bash
# Compare row counts with target time
psql -U postgres -d test_recovery << 'EOF'
\echo 'Data Recovered at Target Time'
\echo '============================='
SELECT 'users' as table_name, COUNT(*) as rows FROM users;
SELECT 'canvases' as table_name, COUNT(*) as rows FROM canvases;
SELECT 'canvas_items' as table_name, COUNT(*) as rows FROM canvas_items;

-- Should NOT include changes made after 14:30:00
-- Verify the deleted records are NOT present
SELECT COUNT(*) as deleted_records_missing
FROM (SELECT * FROM production.users WHERE id = 12345) as expected
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 12345);
EOF

# If records are present = recovery time too late
# If records are missing = recovery successful, data loss averted
```

#### Step 10: Switchover Procedure

```bash
# Option 1: Copy recovered data back to production
# (After validation in test_recovery database)

# Create dump of recovered data
pg_dump -Fc test_recovery > production-recovered-pitr.dump

# Drop current (corrupted) production database
psql -U postgres -c "DROP DATABASE IF EXISTS production CASCADE;"

# Restore recovered version
pg_restore -d production production-recovered-pitr.dump

# OR Option 2: Promote test database to production (faster)

# Rename test database to production
psql -U postgres -c "ALTER DATABASE test_recovery RENAME TO production;"

# Update connection strings in application config
# Restart application
sudo systemctl restart application-service
```

#### Step 11: Verify Production Restoration

```bash
# Confirm data is restored
psql -U postgres -d production -c "
  SELECT COUNT(*) FROM users;
  SELECT MAX(created_at) FROM audit_logs;"

# Run full test suite
npm run test:integration

# Monitor application
curl http://localhost:3000/api/health
tail -f /var/log/application.log | head -20
```

---

## Disaster Recovery Scenarios

### Scenario A: Entire Server Lost

**Recovery Time Objective (RTO):** 2 hours
**Recovery Point Objective (RPO):** < 5 minutes data loss

#### Recovery Steps:

```bash
# 1. Provision new server in same region
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.large \
  --security-group-ids sg-xxxxxxxx \
  --key-name your-key-pair

# 2. Install PostgreSQL
sudo apt-get update
sudo apt-get install postgresql-15 postgresql-client-15 awscli

# 3. Download latest backup
BACKUP_DATE=$(date -d "yesterday" +%Y-%m-%d)
aws s3 cp \
  s3://backups-prod-us-east-1/daily/${BACKUP_DATE}/ \
  /tmp/backup/ \
  --recursive

# 4. Restore database (30 minutes)
gunzip -c /tmp/backup/full-backup.sql.gz | psql -U postgres

# 5. Update application connection strings
# 6. Restart application
```

### Scenario B: Data Corruption Detected

**Recovery Time Objective (RTO):** 4 hours (lower urgency)
**Recovery Point Objective (RPO):** < 24 hours

#### Recovery Steps:

```bash
# 1. Identify when corruption occurred
# Check application logs, monitoring alerts

# 2. Find backup from before corruption
aws s3 ls s3://backups-prod-us-east-1/daily/ --recursive | sort -r | head -10

# 3. Restore to isolated test environment
./restore-database.sh --backup-date 2025-11-08

# 4. Run integrity checks
PGPASSWORD=postgres psql -h test-server -U postgres << 'EOF'
-- Run consistency checks
SELECT * FROM pg_check_database_consistency();
EOF

# 5. If valid, promote to production
# 6. Analyze and prevent corruption root cause
```

### Scenario C: Ransomware/Data Deletion

**Recovery Time Objective (RTO):** 8 hours (critical priority)
**Recovery Point Objective (RPO):** 24 hours acceptable

#### Recovery Steps:

```bash
# 1. ISOLATE the affected systems immediately
# Disconnect from network, disable application access

# 2. Check if S3 backups compromised
aws s3api list-object-versions \
  --bucket backups-prod-us-east-1 \
  --prefix daily/

# 3. Restore from oldest available backup (likely to be safe)
./restore-database.sh --backup-date 2025-11-01

# 4. Verify backup integrity
# Check for signs of encryption/modification

# 5. Restore to new, isolated environment
# 6. Verify data integrity thoroughly
# 7. Gradually restore application access
# 8. Incident investigation in parallel
```

---

## Testing & Validation

### Monthly Restore Test Procedure

**Schedule:** 2nd Sunday of each month, 10:00 AM UTC
**Duration:** 2 hours
**Owner:** Database Operations Team

#### Test Checklist:

```bash
#!/bin/bash

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

test_result() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $1"
  else
    echo -e "${RED}✗${NC} $1"
    exit 1
  fi
}

echo "Starting Monthly Restore Test..."

# 1. List backups
echo ""
echo "Step 1: List available backups..."
aws s3 ls s3://backups-prod-us-east-1/daily/ --recursive | tail -5
test_result "Backups accessible"

# 2. Download backup from 7 days ago
BACKUP_DATE=$(date -d "7 days ago" +%Y-%m-%d)
echo ""
echo "Step 2: Downloading backup from $BACKUP_DATE..."
./scripts/restore-database.sh \
  --backup-date $BACKUP_DATE \
  --target-database test_monthly_restore \
  --dry-run --verbose
test_result "Backup download possible"

# 3. Perform actual restore
echo ""
echo "Step 3: Performing restore..."
./scripts/restore-database.sh \
  --backup-date $BACKUP_DATE \
  --target-database test_monthly_restore \
  --verbose
test_result "Restore completed"

# 4. Run validation queries
echo ""
echo "Step 4: Running validation checks..."
psql -U postgres -d test_monthly_restore << 'EOF'
\echo 'Validation Results'
SELECT COUNT(*) as tables FROM information_schema.tables WHERE table_schema='public';
SELECT COUNT(*) as indexes FROM pg_indexes WHERE schemaname='public';
SELECT COUNT(*) as total_rows FROM (
  SELECT COUNT(*) FROM users
  UNION ALL SELECT COUNT(*) FROM canvases
  UNION ALL SELECT COUNT(*) FROM bookmarks
) as counts;
EOF
test_result "Validation queries passed"

# 5. Test PITR
echo ""
echo "Step 5: Testing PITR capability..."
TIME_WINDOW=$(psql -U postgres -d test_monthly_restore -tc "
  SELECT MAX(created_at) FROM audit_logs;")
echo "Latest record in restored database: $TIME_WINDOW"
test_result "PITR data available"

# 6. Cleanup
echo ""
echo "Step 6: Cleaning up test database..."
psql -U postgres -c "DROP DATABASE IF EXISTS test_monthly_restore;"
test_result "Cleanup completed"

# 7. Generate report
echo ""
echo "Test Summary: ALL TESTS PASSED"
echo "Duration: $(( $(date +%s) - START_TIME )) seconds"
echo "RTO Target: 1 hour (ACHIEVED)"
echo "RPO Target: < 5 minutes (ACHIEVED)"
```

---

## Troubleshooting

### Issue: "Backup file is corrupted"

**Error Message:**
```
gzip: stdin: not in gzip format
```

**Solution:**
```bash
# 1. Verify checksum
aws s3 cp s3://backups-prod-us-east-1/daily/2025-11-09/*.sha256 .
sha256sum -c *.sha256

# If checksum fails:
# 2. Redownload backup
rm backup-file.sql.gz
aws s3 cp s3://backups-prod-us-east-1/daily/2025-11-09/backup-file.sql.gz .

# 3. Try older backup
./restore-database.sh --backup-date 2025-11-08

# 4. If corruption confirmed, contact AWS support
```

### Issue: "Cannot connect to database during restore"

**Error Message:**
```
psql: could not translate host name
```

**Solution:**
```bash
# 1. Verify database is running
systemctl status postgresql

# Start if needed
sudo systemctl start postgresql

# 2. Check connectivity
psql -U postgres -c "SELECT 1;"

# 3. If still failing, check logs
tail -50 /var/log/postgresql/postgresql.log

# 4. Verify PostgreSQL is listening
sudo netstat -tulpn | grep 5432
```

### Issue: "No space left on device"

**Error Message:**
```
ERROR: could not write block 12345: No space left on device
```

**Solution:**
```bash
# 1. Check available space
df -h /var/lib/postgresql

# 2. If full, identify large objects
psql -U postgres -c "
  SELECT schemaname, tablename,
         pg_size_pretty(pg_total_relation_size('public.'||tablename))
  FROM pg_tables
  ORDER BY pg_total_relation_size('public.'||tablename) DESC
  LIMIT 10;"

# 3. Clean up temporary files
rm -rf /tmp/db-restore-*
rm -rf /tmp/pg_*

# 4. Vacuum database
psql -U postgres -c "VACUUM ANALYZE;"

# 5. If still needed, expand disk/filesystem
sudo lvextend -L +100G /dev/vg0/postgresql
sudo resize2fs /dev/vg0/postgresql
```

### Issue: "PITR target time not available"

**Error Message:**
```
ERROR: could not restore to specified timeline
```

**Solution:**
```bash
# 1. Check WAL file availability
aws s3 ls s3://backups-prod-us-east-1/wal/ --recursive | \
  grep "$(date -d 'PITR_DATE' +%Y-%m-%d)" | head -5

# 2. Verify WAL retention policy
psql -U postgres -c "
  SELECT name, setting FROM pg_settings
  WHERE name IN ('max_wal_size', 'wal_keep_size');"

# 3. If PITR too old, restore from closest available backup
# Check backup dates and PITR window
aws s3 ls s3://backups-prod-us-east-1/daily/ | sort -r

# 4. Extend PITR window for future by adjusting WAL retention
psql -U postgres -c "
  ALTER SYSTEM SET wal_keep_size = '1GB';
  SELECT pg_reload_conf();"
```

---

## Post-Restore Checklist

### Immediate After Restore (0-5 minutes)

```
□ Database is running
□ No connection errors
□ All tables present (SELECT COUNT(*) FROM pg_tables)
□ No obvious corruption in logs
□ Application logs show successful connection
```

### Short-term Verification (5-30 minutes)

```
□ Data row counts match expected values
□ Foreign key constraints validated
□ Index integrity verified
□ Application health check passes
□ API endpoints responding
□ No cascading errors in logs
```

### Data Integrity (30 minutes - 2 hours)

```
□ Run application test suite
□ Query critical business tables
□ Verify recent transactions present
□ Check referential integrity
□ Compare row counts with before/after
□ Test user-facing functionality
```

### System Performance (2 hours+)

```
□ Monitor database response times
□ Check I/O and CPU metrics
□ Verify indexes are being used
□ Confirm replication to standby (if applicable)
□ Long-running queries completed
□ Background jobs running normally
```

### Post-Restore Documentation

```markdown
## Restore Incident Report

**Date:** 2025-11-09
**Reason:** [Data loss / Corruption / Disaster Recovery Test]
**Time Started:** 10:00 AM UTC
**Time Completed:** 12:00 PM UTC
**Total Duration:** 2 hours

### Backup Used
- Date: 2025-11-08
- Size: 2.5 GB
- PITR Target: 2025-11-08 14:30:00 (if applicable)

### Data Verification
- Tables Restored: 25
- Total Rows: 45,287,432
- Foreign Key Constraints: ✓ Passed
- Index Count: 87

### Downtime Impact
- Application Downtime: 2 hours
- Users Affected: All
- Data Loss: None (recovered to PITR target)

### Root Cause
[To be filled in after investigation]

### Prevention
[To be filled in after investigation]

### Sign-off
- Verified by: [Name]
- Approved by: [Name]
- Date: 2025-11-09
```

---

**Document Version History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-10 | Database Ops Team | Initial version |

**Next Review:** 2026-02-10
