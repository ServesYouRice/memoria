# Database Backup Policy

**Version:** 1.0
**Last Updated:** 2025-11-10
**Owner:** Operations Team
**Status:** Active

---

## Table of Contents

1. [Backup Strategy](#backup-strategy)
2. [Backup Types](#backup-types)
3. [Point-in-Time Recovery (PITR)](#point-in-time-recovery-pitr)
4. [Automated Backup Script](#automated-backup-script)
5. [Monitoring & Alerts](#monitoring--alerts)
6. [Restore Testing Schedule](#restore-testing-schedule)
7. [Implementation Guide](#implementation-guide)
8. [Appendix](#appendix)

---

## Backup Strategy

### Overview

This policy ensures data durability, compliance, and rapid recovery from data loss or corruption incidents. All databases are backed up automatically with redundancy and encryption.

### Daily Automated Backups

**Backup Schedule:**
- **Full Backups:** Daily at 2:00 AM UTC (off-peak hours)
- **Backup Frequency:** One full backup per day
- **Backup Window:** 2:00 AM - 3:00 AM UTC (1-hour window)
- **Backup Start Time:** 02:00 UTC
- **Expected Duration:** 30-45 minutes (depending on database size)

**Rationale for Timing:**
- 2:00 AM UTC selected to minimize impact on user-facing systems
- Chosen during the lowest expected user activity period
- Allows sufficient time for backup to complete within maintenance window
- Provides clear separation from peak hours (9:00 AM - 6:00 PM UTC)

### Retention Policy

**Backup Retention Schedule:**

| Backup Type | Retention Period | Storage Tier |
|-------------|------------------|--------------|
| Daily Full Backups | 30 days | Hot Storage (S3/GCS) |
| Weekly Full Backups | 12 weeks | Warm Storage (Glacier/Coldline) |
| Monthly Full Backups | 12 months | Cold Storage (Deep Archive) |
| Transaction Logs (WAL) | 7 days | Hot Storage |

**Retention Logic:**
- Daily backups rotated after 30 days (oldest backups deleted)
- On Sundays, the daily backup is retained as weekly backup
- On the 1st of each month, the backup is retained as monthly backup
- Transaction logs deleted after 7 days to conserve storage
- All backups encrypted before storage

### Backup Storage Location

**Primary Storage:**
- **Location:** AWS S3 bucket named `backups-{environment}-{region}`
- **Region:** us-east-1 (production), us-west-2 (staging)
- **Bucket Configuration:**
  - Versioning: Enabled
  - Server-Side Encryption: AES-256 (SSE-S3) or KMS
  - Public Access: Blocked
  - Lifecycle Policies: Configured per retention policy

**Backup Path Structure:**
```
s3://backups-prod-us-east-1/
├── daily/
│   ├── 2025-11-09-full-backup.sql.gz
│   ├── 2025-11-09-full-backup.sql.gz.sha256
│   └── 2025-11-09-metadata.json
├── weekly/
│   ├── 2025-11-02-weekly-full-backup.sql.gz
│   └── 2025-11-02-metadata.json
└── monthly/
    ├── 2025-11-01-monthly-full-backup.sql.gz
    └── 2025-11-01-metadata.json
```

**Secondary Storage (Disaster Recovery):**
- Cross-region replication to us-west-2
- S3 Bucket Replication Rule: Enabled for all backup objects
- Replication Time: < 15 minutes

### Encryption Requirements

**At-Rest Encryption:**
- All backups encrypted with AES-256
- Option 1: S3 Server-Side Encryption (SSE-S3) - managed by AWS
- Option 2: AWS Key Management Service (KMS) - customer-managed keys
- Encryption enabled automatically for all objects uploaded

**In-Transit Encryption:**
- All transfers to S3 use HTTPS/TLS 1.2+
- Database connections use SSL/TLS
- PostgreSQL replication connections require SSL

**Key Management:**
- KMS keys rotated annually
- Access to keys restricted to authorized personnel
- Key usage logged in AWS CloudTrail

---

## Backup Types

### Full Backups

**Definition:** Complete snapshot of the entire database including all tables, indexes, and configurations.

**Frequency & Timing:**
- **Frequency:** Daily (once per 24 hours)
- **Time:** 2:00 AM UTC
- **Duration:** 30-45 minutes
- **Tool Used:** `pg_basebackup` for physical backups OR `pg_dump` for logical backups

**Full Backup Strategy:**
- **Physical Backups (pg_basebackup - Recommended for large databases):**
  - Faster restore times
  - Suitable for databases > 10GB
  - Includes all data files and indexes
  - Enables incremental backups and PITR

- **Logical Backups (pg_dump - Better for portability):**
  - Human-readable SQL format
  - Easier to restore individual objects
  - Suitable for databases < 10GB
  - Better for cross-version migrations

**Current Implementation:** pg_basebackup with WAL archiving (supports PITR)

### Incremental Backups

**Definition:** Backups containing only data changed since the last full backup.

**Frequency & Timing:**
- **Frequency:** Every 6 hours (4 incremental backups per day)
- **Times:** 2:00 AM, 8:00 AM, 2:00 PM, 8:00 PM UTC
- **Duration:** 5-15 minutes
- **Tool Used:** WAL (Write-Ahead Logging) archiving

**Incremental Backup Strategy:**
- Based on PostgreSQL Write-Ahead Log (WAL) archiving
- WAL files automatically archived to S3 every 5 minutes
- Enables efficient storage (only changed blocks backed up)
- Combined with latest full backup for complete restoration

**Configuration:**
```
wal_level = replica          # Enable WAL archiving
archive_mode = on            # Enable archiving
archive_command = 'aws s3 cp %p s3://backups-prod/wal/%f'
archive_timeout = 300        # Archive WAL every 5 minutes
```

### Transaction Log Backups (for PITR)

**Definition:** Continuous archiving of database transaction logs enabling point-in-time recovery.

**Frequency & Timing:**
- **Frequency:** Continuous (archived every 5 minutes or at segment switch)
- **WAL Segment Size:** 16MB (default)
- **Archive Frequency:** Every 5 minutes (via pg_basebackup)
- **Tool Used:** PostgreSQL `archive_command`

**PITR Window:**
- **Current PITR Window:** Last 7 days
- **PITR Granularity:** Down to individual transactions (1 second precision)

**Transaction Log Archiving:**
- WAL files automatically archived to S3 bucket
- Naming Convention: `{timeline_id}.{log_id}.{seg_id}`
- Example: `000000010000000000000001`
- Archive location: `s3://backups-prod/wal/`

---

## Point-in-Time Recovery (PITR)

### Overview

Point-in-Time Recovery (PITR) allows restoring the database to any specific moment within the last 7 days using a combination of full backups and transaction logs.

### Step-by-Step Restoration Process

#### Phase 1: Planning & Verification

**Step 1: Determine target recovery time**
```bash
# Identify the exact timestamp to recover to
TARGET_TIMESTAMP="2025-11-09 14:30:00 UTC"

# Verify WAL availability
aws s3 ls s3://backups-prod/wal/ --recursive | grep "2025-11-09"
```

**Step 2: Select appropriate full backup**
```bash
# List available full backups
aws s3 ls s3://backups-prod/daily/

# Choose the most recent full backup BEFORE the target time
BACKUP_DATE="2025-11-09-full-backup.sql.gz"
```

**Step 3: Verify backup integrity**
```bash
# Download and verify checksum
aws s3 cp s3://backups-prod/daily/${BACKUP_DATE}.sha256 .
sha256sum -c ${BACKUP_DATE}.sha256
```

#### Phase 2: Restoration Process

**Step 4: Prepare recovery environment**
```bash
# Option A: Restore to new PostgreSQL instance (recommended)
# Create new VM/container with PostgreSQL 15+

# Option B: Restore to existing instance
# Stop all application connections
sudo systemctl stop application-service
psql -h localhost -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'production' AND pid <> pg_backend_pid();"
```

**Step 5: Download and restore full backup**
```bash
# Download full backup from S3
aws s3 cp s3://backups-prod/daily/2025-11-09-full-backup.sql.gz .

# For logical backups (SQL dump)
gunzip 2025-11-09-full-backup.sql.gz
psql -U postgres < 2025-11-09-full-backup.sql

# For physical backups (base backup)
pg_basebackup -D /var/lib/postgresql/15/main -h source-server -U postgres
```

**Step 6: Download transaction logs (WAL files)**
```bash
# Create WAL restore directory
mkdir -p /var/lib/postgresql/wal_restore

# Download all WAL files from backup time to target time
aws s3 sync s3://backups-prod/wal/ /var/lib/postgresql/wal_restore/ \
  --exclude "*" \
  --include "000000010000000000000*"
```

**Step 7: Create recovery configuration**
```bash
# For PostgreSQL 12+, create recovery.signal (already in data directory)
touch /var/lib/postgresql/15/main/recovery.signal

# Create recovery.conf equivalent (postgresql.conf for 12+)
cat >> /var/lib/postgresql/15/main/postgresql.conf << EOF
restore_command = 'cp /var/lib/postgresql/wal_restore/%f %p'
recovery_target_timeline = 'latest'
recovery_target_time = '2025-11-09 14:30:00 UTC'
recovery_target_inclusive = true
EOF
```

**Step 8: Start PostgreSQL in recovery mode**
```bash
# Start the database server
sudo systemctl start postgresql

# Monitor recovery progress
tail -f /var/log/postgresql/postgresql.log
```

**Step 9: Verify recovery completion**
```bash
# Check database is accessible
psql -U postgres -h localhost -c "SELECT version();"

# Verify timestamp of recovery
psql -U postgres -h localhost -c "SELECT now();"

# Verify data integrity
psql -U postgres -h localhost -c "SELECT COUNT(*) FROM production.users;"
```

#### Phase 3: Validation & Switchover

**Step 10: Run validation queries**
```bash
# Check critical tables
psql -U postgres << EOF
SELECT COUNT(*) as user_count FROM users;
SELECT COUNT(*) as canvas_count FROM canvases;
SELECT MAX(created_at) as latest_record FROM audit_logs;
EOF
```

**Step 11: Run application tests**
```bash
# Run health checks
curl http://localhost:3000/api/health

# Run smoke tests against recovered database
npm run test:smoke
```

**Step 12: Switchover (if using new instance)**
```bash
# Update DNS/load balancer to point to recovered instance
aws route53 change-resource-record-sets --hosted-zone-id Z123 \
  --change-batch file://dns-update.json

# Monitor for errors
tail -f /var/log/application.log
```

**Step 13: Cleanup**
```bash
# Delete old instance (if applicable)
# Cleanup temporary restore files
rm -rf /var/lib/postgresql/wal_restore
```

### How to Restore to a Specific Timestamp

**Use Case:** Recover from accidental data deletion at 2025-11-09 14:30:00 UTC

**Command:**
```bash
# In recovery.conf or postgresql.conf
recovery_target_time = '2025-11-09 14:30:00 UTC'
recovery_target_inclusive = true
```

**Explanation:**
- `recovery_target_time`: Specifies the exact moment to recover to
- `recovery_target_inclusive`: If true, includes the transaction at the exact time; if false, stops just before
- Recovery proceeds until reaching this point, then stops automatically

**Verification:**
```bash
psql -U postgres -c "SELECT * FROM audit_logs WHERE created_at >= '2025-11-09 14:00:00' ORDER BY created_at DESC LIMIT 5;"
```

### Testing Procedure

**Monthly Restore Test Protocol:**

**Test Objective:** Validate that backups can be successfully restored within RTO/RPO targets

**Pre-Test Setup (2 hours before):**
1. Notify team of scheduled test
2. Reserve test environment
3. Verify all backup files present
4. Create baseline metrics

**Test Execution (1 hour):**

```bash
#!/bin/bash
set -e

TEST_TIMESTAMP=$(date -d "7 days ago" -u +"%Y-%m-%d %H:%M:%S")
TEST_ENV="test-recovery-$(date +%s)"

echo "Starting PITR test to timestamp: $TEST_TIMESTAMP"

# 1. List available backups
echo "Step 1: Identifying backup set..."
aws s3 ls s3://backups-prod/daily/ | tail -5

# 2. Download backup
echo "Step 2: Downloading backup..."
time aws s3 cp s3://backups-prod/daily/latest-full-backup.sql.gz /tmp/

# 3. Restore to test database
echo "Step 3: Restoring database..."
time gunzip -c /tmp/latest-full-backup.sql.gz | psql -U postgres -d test_recovery

# 4. Apply WAL to target time
echo "Step 4: Applying transaction logs..."
time psql -U postgres -d test_recovery -c "SELECT pg_wal_replay_resume();"

# 5. Run validation queries
echo "Step 5: Running validation queries..."
psql -U postgres -d test_recovery << EOF
\echo 'Table counts:'
SELECT 'users' as table_name, COUNT(*) as row_count FROM users;
SELECT 'canvases' as table_name, COUNT(*) as row_count FROM canvases;
SELECT 'bookmarks' as table_name, COUNT(*) as row_count FROM bookmarks;

\echo 'Data integrity checks:'
SELECT COUNT(*) as orphaned_records FROM canvas_items WHERE canvas_id NOT IN (SELECT id FROM canvases);
EOF

# 6. Cleanup
echo "Step 6: Cleaning up test database..."
psql -U postgres -c "DROP DATABASE IF EXISTS test_recovery;"
rm -f /tmp/latest-full-backup.sql.gz

echo "PITR Test completed successfully!"
```

**Post-Test Validation (10 minutes):**
1. Document start/end times
2. Record recovery duration (actual vs. RTO)
3. Verify data integrity checks passed
4. Document any issues
5. Cleanup test resources
6. Generate test report

**Test Results Documentation:**
```
Date: 2025-11-09
Target Timestamp: 2025-11-02 15:30:00 UTC
Duration: 23 minutes
RTO Target: 1 hour
Result: PASS
Issues: None
Data Integrity: PASS (100 tables verified)
Tester: John Doe
Approved: Jane Smith
```

### Maximum Recovery Time Objective (RTO)

**RTO Definition:** Maximum acceptable downtime for critical services

**RTO Targets by Database:**
| Database | RTO | Justification |
|----------|-----|---------------|
| Production (users, canvases) | 1 hour | Critical for user-facing features |
| Analytics | 4 hours | Non-critical, can tolerate longer outage |
| Cache layer (Redis) | 15 minutes | Can be rebuilt from source |

**RTO Achievement Factors:**
- Full backup restoration: 30 minutes
- WAL replay to target time: 15 minutes
- Application startup & verification: 10 minutes
- Total: ~55 minutes (within 1-hour RTO)

**RTO Improvement Strategies:**
- Pre-stage recovery environment
- Maintain warm standby replica
- Use AWS RDS with automated failover
- Implement read replicas in different regions

### Maximum Recovery Point Objective (RPO)

**RPO Definition:** Maximum acceptable data loss (time since last backup)

**RPO Targets by Database:**
| Database | RPO | Backup Frequency |
|----------|-----|------------------|
| Production | 5 minutes | WAL archiving every 5 minutes |
| Staging | 1 hour | Daily full backup |
| Development | 24 hours | Daily full backup |

**RPO Achievement:**
- Transaction log archiving: Every 5 minutes
- WAL segments automatically archived to S3
- Recovery possible to any point within last 7 days
- Exceeds 5-minute RPO requirement

---

## Automated Backup Script

### PostgreSQL Backup Script Overview

The backup script automates the daily backup process, including:
- Full database backup using `pg_basebackup`
- WAL archiving configuration
- S3 upload with encryption
- Backup rotation and cleanup
- Detailed logging and error handling

### Script Features

**Security Features:**
- Encrypted transfer to S3 (HTTPS/TLS)
- Backup integrity verification (SHA-256 checksums)
- Secure credential management (AWS IAM roles)
- Automatic cleanup of old backup files
- Audit logging of all operations

**Reliability Features:**
- Automatic retry logic for failed uploads
- Transaction log archiving for PITR
- Backup verification before deletion
- Detailed error reporting
- Lock prevention (avoid concurrent backups)

**Efficiency Features:**
- Parallel backup of large tables
- Compression for bandwidth efficiency
- Incremental backups via WAL archiving
- Bandwidth throttling available
- Progress tracking and timing

### Sample PostgreSQL Backup Script

See `/home/user/notes/scripts/backup-database.sh` for the complete production-ready script.

**Key Functions:**
```bash
setup_environment()      # Initialize backup environment
validate_prerequisites() # Check dependencies
perform_backup()        # Execute backup
upload_to_s3()         # Upload and verify
cleanup_old_backups()  # Rotation logic
send_notification()    # Alert on success/failure
```

**Usage:**
```bash
./backup-database.sh [options]

Options:
  --environment prod|staging|dev  # Default: prod
  --backup-type full|incremental  # Default: full
  --dry-run                       # Preview without executing
  --verbose                       # Enable verbose logging
```

---

## Monitoring & Alerts

### Backup Verification

**Automated Verification:**

Every backup automatically includes:
1. **Integrity Check:** SHA-256 checksum validation
2. **S3 Upload Verification:** Successful object upload confirmed
3. **Metadata Validation:** Backup size and duration recorded
4. **Size Monitoring:** Alert if backup significantly larger/smaller than normal

**Manual Verification:**

```bash
# Check if latest backup exists
aws s3 ls s3://backups-prod/daily/ --recursive | tail -5

# Verify checksum
aws s3 cp s3://backups-prod/daily/latest.sql.gz.sha256 .
sha256sum -c latest.sql.gz.sha256

# Check backup metadata
aws s3 cp s3://backups-prod/daily/latest-metadata.json .
jq . latest-metadata.json
```

**Expected Metadata:**
```json
{
  "backup_date": "2025-11-09T02:00:00Z",
  "backup_size_bytes": 5368709120,
  "backup_duration_seconds": 1847,
  "database_version": "15.1",
  "compression_ratio": 0.42,
  "wal_start_lsn": "0/18000000",
  "wal_end_lsn": "0/2F000000",
  "backup_method": "pg_basebackup",
  "encryption": "AES-256",
  "checksums": {
    "sha256": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0"
  }
}
```

### Alert Conditions

**Critical Alerts (Immediate Action Required):**

1. **Backup Failed**
   - Condition: Backup script returns non-zero exit code
   - Threshold: Failure detected within 5 minutes of scheduled time
   - Action: PagerDuty alert to on-call engineer
   - Investigation: Check script logs, database connectivity, S3 permissions

2. **Backup Did Not Run**
   - Condition: No backup object created in S3 after 90 minutes
   - Threshold: Triggers at T+90 minutes after scheduled time
   - Action: PagerDuty alert to on-call engineer
   - Investigation: Check cron job, server status, logs

3. **Backup Corruption Detected**
   - Condition: SHA-256 checksum mismatch during verification
   - Threshold: Any failed integrity check
   - Action: PagerDuty alert, quarantine backup, retry
   - Investigation: Database logs, disk errors, network issues

4. **WAL Archiving Failed**
   - Condition: WAL files older than 30 minutes not archived
   - Threshold: Any WAL segment not in S3 after 30 minutes
   - Action: PagerDuty alert, check archive_command status
   - Investigation: S3 connectivity, permissions, disk space

**Warning Alerts (Investigate within 24 hours):**

1. **Backup Size Anomaly**
   - Condition: Backup size > 150% of average OR < 50% of average
   - Threshold: Statistical deviation detected
   - Action: Email to ops team
   - Investigation: Data growth, compression changes, schema modifications

2. **Backup Slower Than Usual**
   - Condition: Backup duration > 1.5x average
   - Threshold: Exceeds 60 minutes (normal: 40 minutes)
   - Action: Email alert, non-blocking
   - Investigation: Database size, disk I/O, network issues

3. **S3 Upload Slower Than Expected**
   - Condition: S3 upload time > 2x average
   - Threshold: Exceeds 15 minutes (normal: 7 minutes)
   - Action: Email alert
   - Investigation: Network bandwidth, S3 throttling, large backup size

**Informational Alerts (Log Only):**

1. **Backup Completed Successfully**
   - Condition: Backup script exit code 0
   - Action: Log to CloudWatch, include in daily summary
   - Data: Duration, size, checksum, timestamp

2. **Old Backups Rotated Out**
   - Condition: Backups older than retention period deleted
   - Action: Log deletion, confirm space freed
   - Data: Number of files deleted, space recovered

### Backup Size Monitoring

**Baseline Metrics:**

| Metric | Expected Value | Alert Threshold |
|--------|----------------|-----------------|
| Database Size | ~5 GB | — |
| Compressed Backup | ~2-2.5 GB | > 3.5 GB or < 1.5 GB |
| Compression Ratio | 0.40-0.50 | < 0.30 or > 0.60 |
| Backup Duration | 30-45 min | > 60 min |

**Monitoring Implementation:**

```bash
# Store metrics in CloudWatch
aws cloudwatch put-metric-data \
  --namespace "DatabaseBackups" \
  --metric-name "BackupSizeBytes" \
  --value 2500000000

# Query recent metrics
aws cloudwatch get-metric-statistics \
  --namespace "DatabaseBackups" \
  --metric-name "BackupSizeBytes" \
  --dimensions Name=Environment,Value=prod \
  --start-time 2025-11-02T00:00:00Z \
  --end-time 2025-11-09T23:59:59Z \
  --period 86400 \
  --statistics Average,Maximum,Minimum
```

**Alert Rules in CloudWatch:**

```json
{
  "AlarmName": "BackupSizeAnomalous",
  "MetricName": "BackupSizeBytes",
  "Statistic": "Average",
  "Period": 86400,
  "EvaluationPeriods": 1,
  "Threshold": 3500000000,
  "ComparisonOperator": "GreaterThanThreshold",
  "AlarmActions": ["arn:aws:sns:us-east-1:123456789:ops-alerts"]
}
```

---

## Restore Testing Schedule

### Monthly Restore Tests

**Schedule:** 2nd Sunday of each month at 10:00 AM UTC

**Test Scope:** Full recovery of production database to previous day's state

**Steps:**
1. Identify backup set (Day -1 from current date)
2. Download backup and WAL files
3. Restore to test environment
4. Run data integrity checks
5. Document results

**Success Criteria:**
- Restore completes within RTO (1 hour)
- All data matches source database
- No errors in application logs
- Health checks pass
- Restore window < 1 hour

**Failure Escalation:**
- Failure: Alert PagerDuty immediately
- Investigate root cause
- Document in ticket
- Remediate before next test
- Update procedures if needed

### Quarterly Disaster Recovery Drills

**Schedule:** 1st Friday of Q1, Q2, Q3, Q4 at 2:00 PM UTC

**Test Scope:** Full disaster recovery including:
- Infrastructure provisioning
- Database restoration
- Application deployment
- Data verification
- Switchover to recovery infrastructure

**Drill Steps:**

1. **Planning Phase (T-1 week)**
   - Notify all teams
   - Reserve infrastructure resources
   - Prepare test environment
   - Brief participants

2. **Setup Phase (T-30 min)**
   - Launch test infrastructure
   - Verify prerequisites
   - Create pre-event snapshots

3. **Execution Phase (T+0)**
   - Simulate infrastructure failure
   - Initiate recovery procedures
   - Begin full restoration
   - Monitor progress
   - Perform application validation
   - Complete data reconciliation

4. **Switchover Phase (T+2 hours)**
   - Update DNS/routing
   - Redirect traffic to recovered infrastructure
   - Monitor error rates
   - Verify all systems operational

5. **Post-Drill Phase (T+3 hours)**
   - Document all timings
   - Record any issues
   - Collect lessons learned
   - Cleanup test infrastructure

### Documentation of Test Results

**Test Result Template:**

```markdown
## Quarterly DR Drill Report - Q4 2025

**Date:** 2025-10-03
**Start Time:** 14:00 UTC
**End Time:** 16:45 UTC
**Total Duration:** 2h 45m

### Executive Summary
[Describe overall success/issues]

### Timeline
| Time | Activity | Status | Duration |
|------|----------|--------|----------|
| 14:00 | Infrastructure provisioning | Success | 25 min |
| 14:25 | Database restoration started | Success | 35 min |
| 15:00 | WAL replay completed | Success | 15 min |
| 15:15 | Data validation started | Success | 10 min |
| 15:25 | Application deployment | Success | 15 min |
| 15:40 | Health checks passed | Success | 2 min |
| 15:42 | DNS update | Success | 3 min |
| 15:45 | Traffic switchover | Success | 1 min |
| 16:45 | Drill concluded | Success | — |

### Metrics Achieved
- Infrastructure Provisioning: 25 min (Target: 30 min) ✓
- Database Restoration: 35 min (Target: 45 min) ✓
- Full Recovery: 2h 45m (Target: 4 hours) ✓
- RTO Achievement: 100%
- RPO Achievement: 100%

### Issues Encountered
1. **Minor:** DNS propagation delayed by 2 minutes
   - Root Cause: TTL set to 5 minutes
   - Resolution: Reduced TTL to 1 minute for future drills
   - Impact: No user-facing impact

2. **Resolved:** Application failed initial health check
   - Root Cause: Database connection timeout
   - Resolution: Increased connection pool timeout from 5s to 10s
   - Impact: Resolved within 5 minutes

### Data Validation Results
- Table record counts: ✓ Matched source (within 1%)
- Foreign key integrity: ✓ Passed
- Index consistency: ✓ Passed
- No corruption detected: ✓

### Participants
- Infrastructure: Alice Johnson
- Database: Bob Smith
- Application: Carol White
- Incident Commander: David Lee

### Recommendations
1. Reduce TTL on Route53 DNS records from 5 min to 1 min
2. Pre-create database connection pool in recovery environment
3. Add automated health check to prevent manual verification delays

### Sign-off
Approved by: Jane Doe (Operations Manager)
Date: 2025-10-03
```

---

## Implementation Guide

### How to Set Up Automated Backups

#### Option 1: Using Cron Jobs (Linux/Unix)

**Step 1: Install PostgreSQL client tools**
```bash
sudo apt-get update
sudo apt-get install postgresql-client-15 aws-cli
```

**Step 2: Configure AWS credentials**
```bash
# Option A: EC2 IAM Role (recommended)
# Attach policy to EC2 instance role allowing S3 access

# Option B: Access keys (if not using IAM role)
aws configure
# Enter AWS Access Key ID
# Enter AWS Secret Access Key
# Set default region to us-east-1
```

**Step 3: Create backup script**
```bash
sudo cp /home/user/notes/scripts/backup-database.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/backup-database.sh
```

**Step 4: Test the script**
```bash
/usr/local/bin/backup-database.sh --dry-run --verbose
```

**Step 5: Add to crontab**
```bash
sudo crontab -e

# Add this line to run backup daily at 2:00 AM UTC
0 2 * * * /usr/local/bin/backup-database.sh --environment prod 2>&1 | logger -t db-backup
```

**Step 6: Verify cron job**
```bash
sudo crontab -l
sudo tail -f /var/log/syslog | grep db-backup
```

#### Option 2: Using Systemd Timers (Modern approach)

**Step 1: Create service file**
```bash
sudo tee /etc/systemd/system/db-backup.service > /dev/null << EOF
[Unit]
Description=Database Backup Service
After=network.target postgresql.service

[Service]
Type=oneshot
User=postgres
Group=postgres
ExecStart=/usr/local/bin/backup-database.sh --environment prod
StandardOutput=journal
StandardError=journal
EOF
```

**Step 2: Create timer file**
```bash
sudo tee /etc/systemd/system/db-backup.timer > /dev/null << EOF
[Unit]
Description=Database Backup Timer
Requires=db-backup.service

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
Unit=db-backup.service

[Install]
WantedBy=timers.target
EOF
```

**Step 3: Enable and start timer**
```bash
sudo systemctl daemon-reload
sudo systemctl enable db-backup.timer
sudo systemctl start db-backup.timer
sudo systemctl status db-backup.timer
```

**Step 4: Verify timer execution**
```bash
sudo systemctl list-timers db-backup.timer
journalctl -u db-backup.service -f
```

#### Option 3: AWS RDS with Automated Backups (Cloud-native)

**Step 1: Configure RDS instance**
```bash
aws rds modify-db-instance \
  --db-instance-identifier my-database \
  --backup-retention-period 30 \
  --preferred-backup-window "02:00-03:00" \
  --copy-tags-to-snapshot \
  --enable-cloudwatch-logs-exports postgresql \
  --apply-immediately
```

**Step 2: Enable automated backups**
```bash
aws rds describe-db-instances \
  --db-instance-identifier my-database \
  --query 'DBInstances[0].BackupRetentionPeriod'
```

**Step 3: Enable enhanced monitoring**
```bash
aws rds modify-db-instance \
  --db-instance-identifier my-database \
  --enable-cloudwatch-logs-exports postgresql \
  --monitoring-interval 60 \
  --monitoring-role-arn arn:aws:iam::123456789:role/RDSEnhancedMonitoringRole
```

#### Option 4: Using AWS Backup (Centralized approach)

**Step 1: Create backup plan**
```bash
aws backup create-backup-plan \
  --backup-plan '{
    "BackupPlanName": "database-daily-backup",
    "BackupPlanRule": {
      "RuleName": "DailyBackups",
      "TargetBackupVaultName": "backup-vault",
      "ScheduleExpression": "cron(0 2 * * ? *)",
      "StartWindowMinutes": 60,
      "CompletionWindowMinutes": 120,
      "Lifecycle": {
        "DeleteAfterDays": 30,
        "MoveToColdStorageAfterDays": 90
      }
    }
  }'
```

**Step 2: Create backup vault**
```bash
aws backup create-backup-vault \
  --backup-vault-name database-backup-vault \
  --encryption-key-arn arn:aws:kms:us-east-1:123456789:key/12345678
```

**Step 3: Create resource assignment**
```bash
aws backup create-backup-selection \
  --backup-plan-id my-backup-plan \
  --backup-selection '{
    "SelectionName": "rds-databases",
    "Type": "RESOURCES",
    "Resources": ["arn:aws:rds:us-east-1:123456789:db:my-database"]
  }'
```

### Docker Compose Integration

**Step 1: Add PostgreSQL service with backup sidecar**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: app-db
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: app_database
      POSTGRES_INITDB_ARGS: "-c archive_mode=on -c archive_command='aws s3 cp %p s3://backups-prod/wal/%f'"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/backup-database.sh:/usr/local/bin/backup-database.sh:ro
      - ./scripts/init-postgres.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d app_database"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  postgres-backup:
    image: postgres:15-alpine
    container_name: app-db-backup
    depends_on:
      postgres:
        condition: service_healthy
    entrypoint: /bin/sh -c "
      apk add --no-cache awscli &&
      while true; do
        /usr/local/bin/backup-database.sh --environment docker &&
        sleep 86400;
      done
    "
    environment:
      PGHOST: postgres
      PGUSER: appuser
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: app_database
      AWS_REGION: us-east-1
    volumes:
      - ./scripts/backup-database.sh:/usr/local/bin/backup-database.sh:ro
    networks:
      - app-network

volumes:
  postgres_data:
    driver: local

networks:
  app-network:
    driver: bridge
```

**Step 2: Add backup environment variables**

```bash
# .env file for docker-compose
POSTGRES_PASSWORD=your-secure-password
AWS_REGION=us-east-1
BACKUP_BUCKET=backups-prod
BACKUP_RETENTION_DAYS=30
```

**Step 3: Deploy and test**

```bash
docker-compose up -d

# Monitor backup service
docker-compose logs -f postgres-backup

# Test manual backup
docker exec app-db-backup /usr/local/bin/backup-database.sh --dry-run
```

---

## Appendix

### A. PostgreSQL WAL Configuration Reference

**Configuration Parameters:**

```postgresql
-- Enable WAL archiving
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://backups-prod/wal/%f'
archive_timeout = 300  -- Archive every 5 minutes

-- PITR parameters
max_wal_size = 1GB
min_wal_size = 80MB

-- Replication for standby (optional)
wal_keep_size = 1GB
max_wal_senders = 10
max_replication_slots = 10
```

**WAL File Naming:**
- Format: `{timeline}{log_id}{segment_id}` (24 hex characters)
- Example: `000000010000000000000001`
- One file = 16MB (default)

### B. Backup Script Configuration Variables

**Environment Variables:**
```bash
export PGHOST=localhost
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=secure-password
export PGDATABASE=postgres

export AWS_REGION=us-east-1
export BACKUP_BUCKET=backups-prod
export BACKUP_TYPE=full
export RETENTION_DAYS=30
export COMPRESSION=gzip
export PARALLEL_JOBS=4
```

### C. Monitoring Dashboard Queries

**CloudWatch Queries (CloudWatch Insights):**

```
# Find all backup operations
fields @timestamp, @message
| filter @message like /backup/
| stats count() by @message

# Track backup duration
fields @timestamp, duration_seconds
| stats avg(duration_seconds) as avg_duration, max(duration_seconds) as max_duration by bin(5m)

# Find failed backups
fields @timestamp, @message
| filter @message like /ERROR/ or status = "FAILED"
| stats count()
```

### D. Compliance & Audit

**Backup Compliance Requirements:**

1. **SOC 2 Type II Compliance:**
   - All backups encrypted at rest
   - All transfers encrypted in transit
   - Access logs maintained for 90 days
   - Quarterly audit of backup restoration

2. **GDPR Compliance:**
   - User deletion honored in backups within 30 days
   - Backup deletion policies documented
   - Data residency maintained

3. **Internal Audit:**
   - Monthly backup verification
   - Quarterly DR drills
   - Annual backup policy review
   - Incident post-mortems documented

**Audit Log Example:**
```json
{
  "timestamp": "2025-11-09T02:45:30Z",
  "event": "backup_completed",
  "database": "production",
  "backup_size_bytes": 2500000000,
  "duration_seconds": 1847,
  "checksum": "a1b2c3d4...",
  "status": "success",
  "operator": "backup-service"
}
```

### E. Troubleshooting Guide

**Issue: Backup Failed**
```bash
# Check PostgreSQL logs
tail -100 /var/log/postgresql/postgresql.log | grep ERROR

# Verify database connectivity
psql -h localhost -U postgres -c "SELECT version();"

# Check S3 permissions
aws s3 ls s3://backups-prod/ --region us-east-1

# Review backup script logs
tail -100 /var/log/db-backup.log
```

**Issue: WAL Archiving Failed**
```bash
# Check WAL files in data directory
ls -lh $PGDATA/pg_wal/

# Verify archive command works
aws s3 cp /path/to/wal/file s3://backups-prod/wal/

# Check pg_stat_archiver
psql -U postgres -c "SELECT * FROM pg_stat_archiver;"
```

**Issue: PITR Not Available**
```bash
# Verify WAL files exist
aws s3 ls s3://backups-prod/wal/ | wc -l

# Check retention policy
aws s3api get-object-retention s3://backups-prod/wal/file

# Verify backup timeline
tar -tzf backup-file.tar.gz | grep backup_label
```

### F. References & Further Reading

- PostgreSQL Official Documentation: https://www.postgresql.org/docs/15/backup.html
- AWS RDS Best Practices: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html
- pg_basebackup Guide: https://www.postgresql.org/docs/15/app-pgbasebackup.html
- Recovery Window Target: https://www.postgresql.org/docs/15/runtime-config-wal.html

---

**Document Version History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-10 | Operations Team | Initial policy creation |

---

**Approval Sign-off:**

- **Author:** Database Operations Team
- **Reviewed by:** Operations Manager
- **Approved by:** CTO
- **Date:** 2025-11-10
- **Next Review Date:** 2026-02-10
