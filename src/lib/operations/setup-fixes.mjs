// Plain .mjs so the first-run page (app) and `pnpm doctor` (Node script)
// name the same fix for the same failure (IMP-100).

/**
 * @typedef {"database" | "migrations" | "redis" | "storage" | "sync-server" | "live-connection"} SetupCheckName
 */

/** @type {Record<SetupCheckName, { label: string; fix: string }>} */
export const SETUP_CHECKS = {
  database: {
    label: "Database",
    fix: "Memoria cannot reach PostgreSQL. Check that the database is running and that DATABASE_URL has the right host, port, user and password.",
  },
  migrations: {
    label: "Database tables",
    fix: "The database tables are not up to date. Run `pnpm db:migrate` (or start the `migrate` service) and wait for it to finish.",
  },
  redis: {
    label: "Redis",
    fix: "Memoria cannot reach Redis (or Valkey). Check that it is running and that REDIS_URL, including its password, is right.",
  },
  storage: {
    label: "Upload storage",
    fix: "Uploads cannot be saved. For S3-compatible storage, check S3_ENDPOINT, S3_BUCKET and the access keys, and that the bucket exists. For uploads on disk, check that UPLOAD_LOCAL_DIR is a mounted folder Memoria can write to.",
  },
  "sync-server": {
    label: "Sync server",
    fix: "The sync server is not answering, so edits will not save. Start it (`sync` service, or `pnpm sync:server`) and check SYNC_SERVER_INTERNAL_URL.",
  },
  "live-connection": {
    label: "Live connection through your proxy",
    fix: "A live connection could not be opened through your web address, so edits will not save. Make sure your reverse proxy passes WebSocket connections (the Upgrade and Connection headers) for /api/collaboration/, and that AUTH_URL is exactly the address you open Memoria at.",
  },
};

/** @param {SetupCheckName} name */
export function setupFix(name) {
  return SETUP_CHECKS[name].fix;
}
