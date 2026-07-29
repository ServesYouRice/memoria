#!/bin/bash
set -euo pipefail

: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
AWS_REGION="${AWS_REGION:-us-east-1}"
MAX_BACKUP_AGE_SECONDS="${MAX_BACKUP_AGE_SECONDS:-5400}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
endpoint_args=()
[[ -n "$BACKUP_S3_ENDPOINT" ]] && endpoint_args+=(--endpoint-url "$BACKUP_S3_ENDPOINT")

latest=$(aws "${endpoint_args[@]}" s3api list-objects-v2 \
  --bucket "$BACKUP_BUCKET" \
  --prefix daily/ \
  --query 'reverse(sort_by(Contents[?contains(Key, `manifest-`) && ends_with(Key, `.json`)], &LastModified))[0].LastModified' \
  --output text \
  --region "$AWS_REGION")

if [[ -z "$latest" || "$latest" == "None" ]]; then
  echo "No completed backup manifest found" >&2
  exit 1
fi

latest_epoch=$(date -u -d "$latest" +%s)
age=$(( $(date -u +%s) - latest_epoch ))
if (( age > MAX_BACKUP_AGE_SECONDS )); then
  echo "Latest completed backup is stale: ${age}s old" >&2
  exit 1
fi

echo "Latest completed backup age: ${age}s"
