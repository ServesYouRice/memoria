#!/bin/bash
set -uo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LOCK_DIR="${BACKUP_LOCK_DIR:-/tmp/memoria-backup.lock}"
readonly INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-3600}"
stopping=false

stop() {
  stopping=true
}
trap stop INT TERM

while [[ "$stopping" != "true" ]]; do
  started_at=$(date +%s)
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    if ! "$SCRIPT_DIR/backup-database.sh" --environment prod; then
      echo "Scheduled backup failed; freshness monitoring will alert if the RPO is at risk" >&2
    fi
    rmdir "$LOCK_DIR" 2>/dev/null || true
  else
    echo "Skipping overlapping backup run because $LOCK_DIR is held" >&2
  fi

  elapsed=$(( $(date +%s) - started_at ))
  remaining=$(( INTERVAL_SECONDS - elapsed ))
  (( remaining < 1 )) && remaining=1
  sleep "$remaining" &
  wait $! || true
done

rmdir "$LOCK_DIR" 2>/dev/null || true
