#!/bin/bash
# Local services for the checks in Claude web sessions, which have no Docker
# daemon. Sourced by session-start.sh and check.sh; run from the repository root.
# - PostgreSQL 18 (production's major version) from the @embedded-postgres npm
#   package, as a private cluster on port 5441.
# - redis-server from apt, with the shared cluster's Valkey ACL for memoria,
#   on a free loopback port for each run.

NODE_VERSION=26.13.0
PNPM_VERSION=11.13.1
NODE_HOME=/opt/node-v$NODE_VERSION
PG18_VERSION=18.6.0-beta.19
PG18_DIR=/opt/embedded-postgres/$PG18_VERSION
PG_BIN=$PG18_DIR/node_modules/@embedded-postgres/linux-x64/native/bin
PG_PORT=5441
PG_DATA="$PWD/.data/claude-postgres-18"
TEST_DATABASE_URL="postgresql://memoria:memoria@127.0.0.1:$PG_PORT/memoria_test"
export PATH="$NODE_HOME/bin:$PATH"

pg_as() { runuser -u postgres -- "$@"; }

install_postgres() {
  [ -x "$PG_BIN/postgres" ] && return 0
  mkdir -p "$PG18_DIR"
  npm install --prefix "$PG18_DIR" --no-audit --no-fund --no-save \
    "@embedded-postgres/linux-x64@$PG18_VERSION" >/dev/null
}

# Private cluster on $PG_PORT with a memoria superuser (the integration suite
# drops and recreates its database).
start_postgres() {
  if [ ! -s "$PG_DATA/PG_VERSION" ]; then
    mkdir -p "$PG_DATA"
    chown postgres:postgres "$PG_DATA"
    chmod 700 "$PG_DATA"
    pg_as "$PG_BIN/initdb" -D "$PG_DATA" -U postgres --auth=trust >/dev/null || return 1
  fi
  if ! pg_as "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
    pg_as "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_DATA/server.log" -w \
      -o "-p $PG_PORT -k $PG_DATA -c listen_addresses=127.0.0.1" start >/dev/null || return 1
  fi
  local psql=(psql -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -tAq)
  "${psql[@]}" -c "SELECT 1 FROM pg_roles WHERE rolname='memoria'" | grep -q 1 ||
    "${psql[@]}" -c "CREATE ROLE memoria LOGIN SUPERUSER PASSWORD 'memoria'" || return 1
  "${psql[@]}" -c "SELECT 1 FROM pg_database WHERE datname='memoria_test'" | grep -q 1 ||
    "${psql[@]}" -c "CREATE DATABASE memoria_test OWNER memoria"
}

# Throwaway redis-server with the shared cluster's ACL for the memoria user,
# mirroring scripts/test-redis.mjs. Sets REDIS_ACL_TEST_URL/REDIS_ACL_ADMIN_URL
# and REDIS_PID; stop it with stop_redis.
start_redis() {
  local port admin app
  port=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  admin=$(openssl rand -hex 16)
  app=$(openssl rand -hex 16)
  redis-server --port "$port" --bind 127.0.0.1 --save '' --appendonly no \
    --user default off \
    --user admin on ">$admin" '~*' '&*' '+@all' \
    --user memoria on ">$app" resetkeys '~memoria:*' resetchannels '&memoria:*' \
      '+@all' '-@admin' '-@dangerous' '+info' >/dev/null &
  REDIS_PID=$!
  for _ in $(seq 1 100); do
    redis-cli -p "$port" --no-auth-warning --user admin --pass "$admin" ping 2>/dev/null | grep -q PONG && break
    sleep 0.1
  done
  export REDIS_ACL_TEST_URL="redis://memoria:$app@127.0.0.1:$port"
  export REDIS_ACL_ADMIN_URL="redis://admin:$admin@127.0.0.1:$port"
}

stop_redis() {
  [ -n "${REDIS_PID:-}" ] || return 0
  kill "$REDIS_PID" 2>/dev/null
  wait "$REDIS_PID" 2>/dev/null
  REDIS_PID=""
}
