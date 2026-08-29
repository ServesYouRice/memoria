#!/bin/bash
set -euo pipefail

: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is required}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is required}"
AWS_REGION="${AWS_REGION:-us-east-1}"
MAX_BACKUP_AGE_SECONDS="${MAX_BACKUP_AGE_SECONDS:-5400}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
REDIS_URL="${REDIS_URL:-}"

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
    memoria:operations:counters:backup_freshness_failures_total >/dev/null || true
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
    memoria:operations:gauges:backup_last_success_timestamp_seconds \
    "$latest_epoch" >/dev/null || true
fi

echo "Latest completed backup age: ${age}s"
