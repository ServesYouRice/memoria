#!/bin/bash
set -uo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly INTERVAL_SECONDS="${BACKUP_FRESHNESS_INTERVAL_SECONDS:-900}"
stopping=false

stop() {
  stopping=true
}
trap stop INT TERM

while [[ "$stopping" != "true" ]]; do
  "$SCRIPT_DIR/check-backup-freshness.sh" || true
  sleep "$INTERVAL_SECONDS" &
  wait $! || true
done
