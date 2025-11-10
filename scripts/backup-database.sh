#!/bin/bash

################################################################################
# Database Backup Script
#
# Purpose: Automated daily backup of PostgreSQL database with S3 upload,
#          verification, and retention management
#
# Usage:   ./backup-database.sh [OPTIONS]
#
# Options:
#   --environment prod|staging|dev   Target environment (default: prod)
#   --backup-type full|incremental   Backup type (default: full)
#   --dry-run                        Preview without executing
#   --verbose                        Enable verbose output
#   --help                           Display this help message
#
# Requirements:
#   - PostgreSQL client tools (pg_dump, pg_basebackup)
#   - AWS CLI (aws s3 cp, aws s3 sync)
#   - Standard tools: gzip, sha256sum, date, cron
#   - AWS S3 bucket with appropriate permissions
#   - PostgreSQL credentials in environment or .pgpass
#
# Exit Codes:
#   0 - Backup successful
#   1 - Backup failed
#   2 - Configuration error
#   3 - Prerequisite not met
#
################################################################################

set -o pipefail

# Script constants
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
readonly LOG_FILE="${LOG_FILE:-/var/log/db-backup.log}"
readonly TEMP_DIR="${TEMP_DIR:-/tmp/db-backup-$$}"
readonly BACKUP_TIMESTAMP=$(date -u +"%Y-%m-%d-%H%M%S")
readonly BACKUP_DATE=$(date -u +"%Y-%m-%d")

# Configuration variables
ENVIRONMENT="${ENVIRONMENT:-prod}"
BACKUP_TYPE="${BACKUP_TYPE:-full}"
DRY_RUN=false
VERBOSE=false
HELP=false

# Database configuration
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"
PGPASSWORD="${PGPASSWORD:-}"

# AWS configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
BACKUP_BUCKET="${BACKUP_BUCKET:-backups-${ENVIRONMENT}-${AWS_REGION}}"
BACKUP_PATH="daily/${BACKUP_DATE}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Backup options
COMPRESSION="${COMPRESSION:-gzip}"
COMPRESSION_LEVEL="-z -9"  # Maximum compression
PARALLEL_JOBS="${PARALLEL_JOBS:-4}"
VERIFY_BACKUP=true
SEND_NOTIFICATIONS=true

# Color codes for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m' # No Color

################################################################################
# Utility Functions
################################################################################

# Log message with timestamp
log() {
    local level="$1"
    shift
    local message="$@"
    local timestamp=$(date -u '+%Y-%m-%d %H:%M:%S')

    case "$level" in
        ERROR)
            echo -e "${RED}[ERROR]${NC} $timestamp: $message" | tee -a "$LOG_FILE" >&2
            ;;
        WARN)
            echo -e "${YELLOW}[WARN]${NC} $timestamp: $message" | tee -a "$LOG_FILE"
            ;;
        INFO)
            echo -e "${GREEN}[INFO]${NC} $timestamp: $message" | tee -a "$LOG_FILE"
            ;;
        DEBUG)
            if [[ "$VERBOSE" == "true" ]]; then
                echo "[DEBUG] $timestamp: $message" | tee -a "$LOG_FILE"
            fi
            ;;
        *)
            echo "$timestamp: $message" | tee -a "$LOG_FILE"
            ;;
    esac
}

# Display usage
usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Options:
    --environment prod|staging|dev   Target environment (default: prod)
    --backup-type full|incremental   Backup type (default: full)
    --dry-run                        Preview without executing
    --verbose                        Enable verbose output
    --help                           Display this help message

Examples:
    # Backup production database
    $SCRIPT_NAME --environment prod

    # Dry-run with verbose output
    $SCRIPT_NAME --dry-run --verbose

    # Backup to staging environment
    $SCRIPT_NAME --environment staging --backup-type full

Environment Variables:
    PGHOST          PostgreSQL host (default: localhost)
    PGPORT          PostgreSQL port (default: 5432)
    PGUSER          PostgreSQL user (default: postgres)
    PGPASSWORD      PostgreSQL password
    PGDATABASE      PostgreSQL database (default: postgres)
    AWS_REGION      AWS region (default: us-east-1)
    BACKUP_BUCKET   S3 bucket name (default: backups-{env}-{region})
    LOG_FILE        Log file path (default: /var/log/db-backup.log)
    TEMP_DIR        Temporary directory (default: /tmp/db-backup-$$)

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            --backup-type)
                BACKUP_TYPE="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --help)
                HELP=true
                shift
                ;;
            *)
                log ERROR "Unknown option: $1"
                usage
                exit 2
                ;;
        esac
    done

    if [[ "$HELP" == "true" ]]; then
        usage
        exit 0
    fi
}

# Validate command prerequisites
validate_prerequisites() {
    log INFO "Validating prerequisites..."

    local missing_tools=()

    # Check required commands
    for cmd in pg_dump pg_basebackup psql aws gzip sha256sum; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_tools+=("$cmd")
        fi
    done

    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log ERROR "Missing required tools: ${missing_tools[*]}"
        log ERROR "Please install PostgreSQL client tools and AWS CLI"
        return 1
    fi

    # Check PostgreSQL connectivity
    if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
        -d "$PGDATABASE" -c "SELECT version();" &>/dev/null; then
        log ERROR "Cannot connect to PostgreSQL at $PGHOST:$PGPORT"
        return 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity --region "$AWS_REGION" &>/dev/null; then
        log ERROR "AWS credentials not configured or invalid"
        return 1
    fi

    # Check S3 bucket access
    if ! aws s3 ls "s3://${BACKUP_BUCKET}" --region "$AWS_REGION" &>/dev/null; then
        log WARN "S3 bucket does not exist or is not accessible: s3://${BACKUP_BUCKET}"
        log INFO "Attempting to create bucket..."
        if ! aws s3 mb "s3://${BACKUP_BUCKET}" --region "$AWS_REGION" 2>/dev/null; then
            log ERROR "Cannot create S3 bucket: s3://${BACKUP_BUCKET}"
            return 1
        fi
    fi

    log INFO "All prerequisites validated"
    return 0
}

# Setup backup environment
setup_environment() {
    log INFO "Setting up backup environment..."

    # Create temporary directory
    if [[ "$DRY_RUN" != "true" ]]; then
        mkdir -p "$TEMP_DIR" || {
            log ERROR "Failed to create temporary directory: $TEMP_DIR"
            return 1
        }
        chmod 700 "$TEMP_DIR"
    fi

    # Ensure log file is writable
    if [[ ! -w "$(dirname "$LOG_FILE")" ]]; then
        log ERROR "Log directory is not writable: $(dirname "$LOG_FILE")"
        return 1
    fi

    log DEBUG "Temp directory: $TEMP_DIR"
    log DEBUG "Log file: $LOG_FILE"

    return 0
}

# Perform full database backup
perform_full_backup() {
    log INFO "Performing full database backup..."

    local backup_file="${TEMP_DIR}/full-backup-${BACKUP_TIMESTAMP}.sql.gz"

    if [[ "$DRY_RUN" == "true" ]]; then
        log INFO "[DRY RUN] Would backup database to: $backup_file"
        return 0
    fi

    local start_time=$(date +%s)

    # Create backup using pg_dump with compression
    if ! PGPASSWORD="$PGPASSWORD" pg_dump \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d "$PGDATABASE" \
        --verbose \
        --no-password \
        2>>"$LOG_FILE" | gzip $COMPRESSION_LEVEL > "$backup_file"; then
        log ERROR "Database backup failed"
        return 1
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    local backup_size=$(stat -f%z "$backup_file" 2>/dev/null || stat -c%s "$backup_file" 2>/dev/null)

    log INFO "Full backup completed in ${duration}s"
    log INFO "Backup size: $(numfmt --to=iec-i --suffix=B $backup_size 2>/dev/null || echo $backup_size bytes)"

    echo "$backup_file"
    return 0
}

# Perform physical backup using pg_basebackup
perform_physical_backup() {
    log INFO "Performing physical database backup..."

    local backup_dir="${TEMP_DIR}/base-backup-${BACKUP_TIMESTAMP}"

    if [[ "$DRY_RUN" == "true" ]]; then
        log INFO "[DRY RUN] Would backup database to: $backup_dir"
        return 0
    fi

    local start_time=$(date +%s)

    # Create backup directory
    mkdir -p "$backup_dir" || {
        log ERROR "Failed to create backup directory: $backup_dir"
        return 1
    }

    # Create base backup
    if ! PGPASSWORD="$PGPASSWORD" pg_basebackup \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -D "$backup_dir" \
        -Ft \
        -z \
        -j "$PARALLEL_JOBS" \
        -l "backup-${BACKUP_TIMESTAMP}" 2>>"$LOG_FILE"; then
        log ERROR "Physical backup failed"
        return 1
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    log INFO "Physical backup completed in ${duration}s"

    # Compress backup
    local backup_file="${TEMP_DIR}/base-backup-${BACKUP_TIMESTAMP}.tar.gz"
    tar -czf "$backup_file" -C "$TEMP_DIR" "base-backup-${BACKUP_TIMESTAMP}" 2>>"$LOG_FILE" || {
        log ERROR "Failed to compress backup"
        return 1
    }

    local backup_size=$(stat -f%z "$backup_file" 2>/dev/null || stat -c%s "$backup_file" 2>/dev/null)
    log INFO "Compressed backup size: $(numfmt --to=iec-i --suffix=B $backup_size 2>/dev/null || echo $backup_size bytes)"

    echo "$backup_file"
    return 0
}

# Generate backup metadata
generate_metadata() {
    local backup_file="$1"
    local metadata_file="${backup_file}.metadata.json"

    log DEBUG "Generating backup metadata..."

    local backup_size=$(stat -f%z "$backup_file" 2>/dev/null || stat -c%s "$backup_file" 2>/dev/null)
    local backup_sha256=$(sha256sum "$backup_file" | awk '{print $1}')

    cat > "$metadata_file" << EOF
{
  "backup_timestamp": "$(date -u -Is)",
  "backup_date": "$BACKUP_DATE",
  "environment": "$ENVIRONMENT",
  "backup_type": "$BACKUP_TYPE",
  "backup_file": "$(basename "$backup_file")",
  "backup_size_bytes": $backup_size,
  "compression": "$COMPRESSION",
  "database": "$PGDATABASE",
  "database_host": "$PGHOST",
  "database_port": $PGPORT,
  "checksum_sha256": "$backup_sha256",
  "retention_days": $BACKUP_RETENTION_DAYS,
  "verification_status": "pending",
  "script_version": "1.0"
}
EOF

    echo "$metadata_file"
}

# Verify backup integrity
verify_backup() {
    local backup_file="$1"

    log INFO "Verifying backup integrity..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log INFO "[DRY RUN] Would verify backup: $backup_file"
        return 0
    fi

    # Check file exists and has content
    if [[ ! -f "$backup_file" ]] || [[ ! -s "$backup_file" ]]; then
        log ERROR "Backup file does not exist or is empty: $backup_file"
        return 1
    fi

    # Verify file can be read
    if ! file "$backup_file" &>/dev/null; then
        log ERROR "Cannot read backup file: $backup_file"
        return 1
    fi

    # For gzipped files, test integrity
    if [[ "$backup_file" == *.gz ]]; then
        if ! gzip -t "$backup_file" 2>>"$LOG_FILE"; then
            log ERROR "Backup file is corrupted (gzip integrity check failed)"
            return 1
        fi
    fi

    log INFO "Backup verification successful"
    return 0
}

# Upload backup to S3
upload_to_s3() {
    local backup_file="$1"
    local metadata_file="$2"

    log INFO "Uploading backup to S3..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log INFO "[DRY RUN] Would upload to: s3://${BACKUP_BUCKET}/${BACKUP_PATH}/$(basename "$backup_file")"
        return 0
    fi

    local start_time=$(date +%s)
    local retry_count=0
    local max_retries=3

    # Upload backup with retry logic
    while [[ $retry_count -lt $max_retries ]]; do
        if aws s3 cp "$backup_file" "s3://${BACKUP_BUCKET}/${BACKUP_PATH}/" \
            --region "$AWS_REGION" \
            --sse AES256 \
            --metadata "timestamp=$(date -u -Is),environment=$ENVIRONMENT,type=$BACKUP_TYPE" \
            2>>"$LOG_FILE"; then

            log DEBUG "Backup file uploaded successfully"

            # Upload metadata
            if ! aws s3 cp "$metadata_file" "s3://${BACKUP_BUCKET}/${BACKUP_PATH}/" \
                --region "$AWS_REGION" \
                --sse AES256 \
                2>>"$LOG_FILE"; then
                log WARN "Failed to upload metadata file"
            fi

            local end_time=$(date +%s)
            local duration=$((end_time - start_time))
            log INFO "S3 upload completed in ${duration}s"

            return 0
        fi

        retry_count=$((retry_count + 1))
        if [[ $retry_count -lt $max_retries ]]; then
            log WARN "S3 upload failed, retrying (attempt $retry_count/$max_retries)..."
            sleep $((retry_count * 10))
        fi
    done

    log ERROR "Failed to upload backup to S3 after $max_retries attempts"
    return 1
}

# Calculate S3 object checksum
calculate_s3_checksum() {
    local s3_path="$1"

    log DEBUG "Verifying S3 checksum..."

    # Get object metadata from S3
    if aws s3api head-object \
        --bucket "${BACKUP_BUCKET}" \
        --key "$s3_path" \
        --region "$AWS_REGION" 2>>"$LOG_FILE" | grep -q "ContentLength"; then
        log DEBUG "S3 object verification successful"
        return 0
    else
        log ERROR "S3 object verification failed"
        return 1
    fi
}

# Cleanup old backups
cleanup_old_backups() {
    log INFO "Cleaning up old backups (retention: $BACKUP_RETENTION_DAYS days)..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log INFO "[DRY RUN] Would delete backups older than $BACKUP_RETENTION_DAYS days"
        return 0
    fi

    local cutoff_date=$(date -u -d "$BACKUP_RETENTION_DAYS days ago" +"%Y-%m-%d" 2>/dev/null || date -u -v-${BACKUP_RETENTION_DAYS}d +"%Y-%m-%d")

    # List and delete old backups
    aws s3 ls "s3://${BACKUP_BUCKET}/daily/" --region "$AWS_REGION" | while read -r date time size file; do
        if [[ -n "$file" ]]; then
            if [[ "$date" < "$cutoff_date" ]]; then
                log DEBUG "Deleting old backup: s3://${BACKUP_BUCKET}/daily/$file"
                aws s3 rm "s3://${BACKUP_BUCKET}/daily/$file" \
                    --region "$AWS_REGION" 2>>"$LOG_FILE" || {
                    log WARN "Failed to delete old backup: $file"
                }
            fi
        fi
    done

    log INFO "Backup cleanup completed"
    return 0
}

# Send notifications
send_notification() {
    local status="$1"
    local message="$2"

    if [[ "$SEND_NOTIFICATIONS" != "true" ]]; then
        return 0
    fi

    log DEBUG "Sending notification: $status - $message"

    # Example: Send to CloudWatch
    if [[ -n "$AWS_REGION" ]]; then
        aws cloudwatch put-metric-data \
            --namespace "DatabaseBackups" \
            --metric-name "BackupStatus" \
            --value $([ "$status" = "SUCCESS" ] && echo 1 || echo 0) \
            --dimensions Environment="$ENVIRONMENT" \
            --region "$AWS_REGION" 2>/dev/null || true
    fi

    # Example: Send email via SNS (if topic configured)
    if [[ -n "$SNS_TOPIC_ARN" ]]; then
        aws sns publish \
            --topic-arn "$SNS_TOPIC_ARN" \
            --subject "Database Backup $status" \
            --message "$message" \
            --region "$AWS_REGION" 2>/dev/null || true
    fi
}

# Cleanup temporary files
cleanup_temp_files() {
    log DEBUG "Cleaning up temporary files..."

    if [[ "$DRY_RUN" != "true" ]] && [[ -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR" || log WARN "Failed to remove temporary directory: $TEMP_DIR"
    fi
}

################################################################################
# Main Execution
################################################################################

main() {
    local exit_code=0

    # Parse command line arguments
    parse_args "$@"

    log INFO "Starting database backup process..."
    log INFO "Environment: $ENVIRONMENT"
    log INFO "Backup Type: $BACKUP_TYPE"
    log INFO "Backup Timestamp: $BACKUP_TIMESTAMP"

    # Validate prerequisites
    if ! validate_prerequisites; then
        log ERROR "Prerequisite validation failed"
        send_notification "FAILED" "Backup failed: prerequisite validation"
        return 3
    fi

    # Setup environment
    if ! setup_environment; then
        log ERROR "Environment setup failed"
        send_notification "FAILED" "Backup failed: environment setup"
        return 2
    fi

    # Perform backup based on type
    local backup_file
    case "$BACKUP_TYPE" in
        full)
            backup_file=$(perform_full_backup)
            exit_code=$?
            ;;
        physical)
            backup_file=$(perform_physical_backup)
            exit_code=$?
            ;;
        *)
            log ERROR "Unknown backup type: $BACKUP_TYPE"
            exit_code=2
            ;;
    esac

    if [[ $exit_code -ne 0 ]]; then
        log ERROR "Backup operation failed"
        send_notification "FAILED" "Backup failed: backup operation error"
        cleanup_temp_files
        return 1
    fi

    # Generate metadata
    local metadata_file=$(generate_metadata "$backup_file")

    # Verify backup integrity
    if [[ "$VERIFY_BACKUP" == "true" ]]; then
        if ! verify_backup "$backup_file"; then
            log ERROR "Backup verification failed"
            send_notification "FAILED" "Backup failed: verification error"
            cleanup_temp_files
            return 1
        fi
    fi

    # Upload to S3
    if ! upload_to_s3 "$backup_file" "$metadata_file"; then
        log ERROR "S3 upload failed"
        send_notification "FAILED" "Backup failed: S3 upload error"
        cleanup_temp_files
        return 1
    fi

    # Cleanup old backups
    if ! cleanup_old_backups; then
        log WARN "Backup cleanup encountered errors (backup still successful)"
    fi

    # Send success notification
    send_notification "SUCCESS" "Database backup completed successfully for $ENVIRONMENT environment"

    # Cleanup temporary files
    cleanup_temp_files

    log INFO "Backup process completed successfully"
    return 0
}

# Execute main function
main "$@"
exit $?
