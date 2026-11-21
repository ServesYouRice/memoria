#!/bin/bash
# Installs what .claude/hooks/check.sh needs, so every Claude web session can
# run the full checks. Runs only in Claude web (cloud) sessions.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

# REPO-SPECIFIC: install dependencies and start services the checks need.
# Pinned Node and pnpm (scripts/gate.mjs), the pnpm packages, the Prisma
# client, a private PostgreSQL 18 cluster on port 5441 for the integration
# tests, and redis-server for the Redis ACL tests (see services.sh).
source .claude/hooks/services.sh

if [ "$(node --version 2>/dev/null)" != "v$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" | tar -xJ -C "$tmp"
  rm -rf "$NODE_HOME"
  mv "$tmp/node-v$NODE_VERSION-linux-x64" "$NODE_HOME"
  rm -rf "$tmp"
fi
if [ "$(pnpm --version 2>/dev/null)" != "$PNPM_VERSION" ]; then
  npm install -g --no-audit --no-fund "pnpm@$PNPM_VERSION" >/dev/null
fi
if ! command -v redis-server >/dev/null 2>&1; then
  apt-get -o DPkg::Lock::Timeout=600 update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y -qq redis-server >/dev/null
fi

pnpm install --frozen-lockfile
DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder pnpm db:generate >/dev/null

install_postgres
start_postgres

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export PATH=\"$NODE_HOME/bin:\$PATH\""
    echo "export TEST_DATABASE_URL=\"$TEST_DATABASE_URL\""
  } >> "$CLAUDE_ENV_FILE"
fi
