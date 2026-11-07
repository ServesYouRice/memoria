#!/bin/bash
set -euo pipefail

: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is required}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is required}"
AWS_REGION="${AWS_REGION:-us-east-1}"
# Cloudflare R2 requires region "auto" and rejects the AWS CLI's default
# CRC32 checksums, so only send/validate checksums when an operation requires
# them (matches src/lib/uploads/s3-client.mjs).
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
is_r2_endpoint() {
    local host="${1#*://}"
    host="${host%%[/:?#]*}"
    [[ "$host" == *.r2.cloudflarestorage.com ]]
}
if is_r2_endpoint "${BACKUP_S3_ENDPOINT:-}" || is_r2_endpoint "${S3_ENDPOINT:-}"; then
    AWS_REGION="auto"
fi
MAX_BACKUP_AGE_SECONDS="${MAX_BACKUP_AGE_SECONDS:-5400}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
REDIS_URL="${REDIS_URL:-}"
REDIS_KEY_PREFIX="${REDIS_KEY_PREFIX:-memoria:}"

backup_aws() {
  if [[ -n "$BACKUP_S3_ENDPOINT" ]]; then
    AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      aws --endpoint-url "$BACKUP_S3_ENDPOINT" "$@"
  else
    AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" aws "$@"
  fi
}

redis_command() {
  local redis_url="$REDIS_URL"
  if [[ "$redis_url" == redis://:* ]]; then
    redis_url="redis://default:${redis_url#redis://:}"
  elif [[ "$redis_url" == rediss://:* ]]; then
    redis_url="rediss://default:${redis_url#rediss://:}"
  fi
  redis-cli --no-auth-warning -u "$redis_url" "$@"
}

record_counter() {
  [[ -n "$REDIS_URL" ]] || return 0
  redis_command INCR \
    "${REDIS_KEY_PREFIX}operations:counters:backup_freshness_failures_total" >/dev/null || true
}

fail() {
  record_counter
  echo "$1" >&2
  exit 1
}

if ! latest=$(backup_aws s3api list-objects-v2 \
  --bucket "$BACKUP_BUCKET" \
  --prefix daily/ \
  --query 'reverse(sort_by(Contents[?contains(Key, `manifest-`) && ends_with(Key, `.json`)], &LastModified))[0].LastModified' \
  --output text \
  --region "$AWS_REGION"); then
  fail "Could not query the off-host backup bucket"
fi

if [[ -z "$latest" || "$latest" == "None" ]]; then
  fail "No completed backup manifest found"
fi

latest_epoch=$(date -u -d "$latest" +%s)
age=$(( $(date -u +%s) - latest_epoch ))
if (( age > MAX_BACKUP_AGE_SECONDS )); then
  fail "Latest completed backup is stale: ${age}s old"
fi

if [[ -n "$REDIS_URL" ]]; then
  redis_command SET \
    "${REDIS_KEY_PREFIX}operations:gauges:backup_last_success_timestamp_seconds" \
    "$latest_epoch" >/dev/null || true
fi

echo "Latest completed backup age: ${age}s"
