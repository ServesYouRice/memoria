#!/bin/bash
# Runs every check for this repo. On success it records the exact code that
# passed, which unlocks `git push` and pull requests (see require-checks.sh).
# Shared template from ServesYouRice/handbook (templates/claude-cloud).
# Only the run_checks function is repo-specific.
set -uo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

run_checks() {
  # REPO-SPECIFIC: the local gate (scripts/gate.mjs) with every stage that can
  # run in a Claude web session:
  # - fast, build, audit: as the gate runs them.
  # - redis: `pnpm test:redis` against a local redis-server with the shared
  #   cluster's ACL (the gate's redis stage starts a Docker container).
  # Left out (CLAUDE.md says why): integration (Prisma refuses `migrate reset`
  # from an agent without the user's consent), container and e2e (Docker).
  source .claude/hooks/services.sh
  export GATE_STRICT_RUNTIME=1
  pnpm gate fast build audit || return 1
  start_redis
  local status=0
  pnpm test:redis || status=1
  stop_redis
  return $status
}

# Hash of the working tree as it would be committed (tracked + new, not ignored).
tree_now() {
  local idx; idx=$(mktemp)
  cp "$(git rev-parse --git-dir)/index" "$idx" 2>/dev/null || rm -f "$idx"
  GIT_INDEX_FILE="$idx" git add -A >/dev/null 2>&1
  GIT_INDEX_FILE="$idx" git write-tree
  rm -f "$idx"
}

before=$(tree_now)
if ! run_checks; then
  echo "CHECKS FAILED" >&2
  exit 1
fi
after=$(tree_now)
if [ "$before" != "$after" ]; then
  echo "Checks passed but changed files (formatter or generated output)." >&2
  echo "Review the changes and run this script again." >&2
  exit 1
fi
echo "$after" > "$(git rev-parse --git-dir)/claude-checks-passed"
echo "ALL CHECKS PASSED (recorded for tree $after)"
