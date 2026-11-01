/**
 * The realtime process (IMP-042, IMP-043): Hocuspocus document sync at
 * `/api/collaboration/sync` and the presence socket (cursors, chat,
 * reactions) at `/api/collaboration/:canvasId`, on one port. Runs from the
 * application image like the outbox worker: `pnpm sync:server` after
 * `pnpm build`, or `pnpm sync:dev` from source. Any number of replicas may
 * share one database and Redis; production runs one until a second is needed.
 */
import "../src/lib/env";
import { prisma } from "../src/lib/db";
import { createLogger } from "../src/lib/logger";
import { getRedisClient } from "../src/lib/cache/redis-client";
import { createSyncServer } from "../src/lib/collaboration/sync/server";
import { COLLABORATION_SYNC_PATH } from "../src/lib/collaboration/sync/protocol";
import {
  createCollaborationServer,
  getCanvasConnectionCount,
  getConnectionCount,
} from "../src/lib/collaboration/websocket-server";

const logger = createLogger("sync-server");
const sync = createSyncServer({
  prisma,
  logger,
  port: Number(process.env.SYNC_SERVER_PORT || 3001),
  address: process.env.SYNC_SERVER_ADDRESS || "0.0.0.0",
  allowedOrigin: process.env.AUTH_URL || process.env.NEXTAUTH_URL,
  redis: getRedisClient(),
  passUpgrade: (path) =>
    path.startsWith("/api/collaboration/") && path !== COLLABORATION_SYNC_PATH,
  health: (url) => {
    const counts: Record<string, unknown> = {
      presenceConnections: getConnectionCount(),
    };
    // The E2E stack asks which replica serves a canvas (IMP-043); the health
    // port is internal, but canvas ids stay out of it everywhere else.
    const canvasId = url.searchParams.get("canvas");
    if (process.env.MEMORIA_E2E_MODE === "true" && canvasId) {
      counts.canvas = {
        sync:
          sync.hocuspocus.documents.get(canvasId)?.getConnectionsCount() ?? 0,
        presence: getCanvasConnectionCount(canvasId),
      };
    }
    return counts;
  },
});
const presence = createCollaborationServer(sync.httpServer);

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
  presence.clients.forEach((client) =>
    client.close(1001, "Server shutting down"),
  );
  presence.close();
  await sync.destroy();
  await prisma.$disconnect();
  clearTimeout(deadline);
  logger.info("Sync server shutdown complete");
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
