/**
 * IMP-042: the collaboration sync server process (Hocuspocus). Runs from the
 * application image like the outbox worker: `pnpm sync:server` after
 * `pnpm build`, or `pnpm sync:dev` from source. Run exactly one replica per
 * database until IMP-043 adds cross-replica document fan-out.
 */
import "../src/lib/env";
import { prisma } from "../src/lib/db";
import { createLogger } from "../src/lib/logger";
import { createSyncServer } from "../src/lib/collaboration/sync/server";

const logger = createLogger("sync-server");
const sync = createSyncServer({
  prisma,
  logger,
  port: Number(process.env.SYNC_SERVER_PORT || 3001),
  address: process.env.SYNC_SERVER_ADDRESS || "0.0.0.0",
  allowedOrigin: process.env.AUTH_URL || process.env.NEXTAUTH_URL,
});

const { port } = await sync.listen();
logger.info({ port }, "Collaboration sync server ready");

let stopping = false;
async function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Sync server shutdown started");
  const deadline = setTimeout(() => {
    logger.error("Sync server shutdown deadline exceeded");
    process.exit(1);
  }, 25_000);
  deadline.unref();
  // Every acknowledged update is already in PostgreSQL; shutting down only
  // waits for updates in flight and compacts the documents it unloads.
  await sync.destroy();
  await prisma.$disconnect();
  clearTimeout(deadline);
  logger.info("Sync server shutdown complete");
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
