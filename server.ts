/**
 * Custom Next.js server. Collaboration sockets are proxied to the realtime
 * process (`scripts/sync-server.ts`).
 */

import "./src/lib/env";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import {
  assertSupportedSyncUpstream,
  proxySyncUpgrade,
} from "./src/lib/collaboration/sync/upgrade-proxy";
import { stampUpgradeClientIp } from "./src/lib/collaboration/upgrade-policy";
import { logger } from "./src/lib/logger";
import { deriveClientIp } from "./src/lib/network/client-ip";
import { nanoid } from "nanoid";
import { runWithRequestContext } from "./src/lib/api/request-context";
import { recordHttpStatus } from "./src/lib/operations/runtime-metrics";
import { createGracefulShutdown } from "./src/lib/operations/graceful-shutdown";
import { disconnectDatabase } from "./src/lib/db";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || (dev ? "localhost" : "0.0.0.0");
const port = parseInt(process.env["PORT"] || "3000", 10);
const syncServerUrl = new URL(
  process.env.SYNC_SERVER_INTERNAL_URL || "http://127.0.0.1:3001",
);
assertSupportedSyncUpstream(syncServerUrl);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer(async (req, res) => {
      res.once("finish", () => recordHttpStatus(res.statusCode));
      try {
        // Never trust a caller-supplied forwarding header for security
        // decisions. The custom server is the only component allowed to set
        // this value, so middleware can key abuse controls to the actual peer.
        req.headers["x-memoria-client-ip"] = deriveClientIp(
          req.socket.remoteAddress,
          req.headers["x-forwarded-for"],
          process.env.TRUSTED_PROXY_CIDRS,
        );
        const suppliedRequestId = req.headers["x-request-id"];
        const requestId =
          typeof suppliedRequestId === "string" &&
          /^[A-Za-z0-9_-]{8,64}$/.test(suppliedRequestId)
            ? suppliedRequestId
            : nanoid(16);
        req.headers["x-request-id"] = requestId;
        const parsedUrl = parse(req.url!, true);
        await runWithRequestContext(requestId, () =>
          handle(req, res, parsedUrl),
        );
      } catch (err) {
        const pathname = parse(req.url || "").pathname;
        logger.error(
          { error: err, pathname },
          "Error occurred handling request",
        );
        res.statusCode = 500;
        res.end("internal server error");
      }
    });

    // Every collaboration socket (document sync and presence) belongs to the
    // realtime process (IMP-042, IMP-043). A gateway routes them there
    // directly; this proxy serves single-port and development setups.
    // The realtime process sees this server as the peer of every proxied
    // socket; the signed header tells it the real client (TASK-170).
    const proxySecret = process.env.COLLABORATION_PROXY_SECRET;
    if (!proxySecret)
      logger.warn(
        "COLLABORATION_PROXY_SECRET is not set: collaboration sockets proxied by this server share its address for per-client limits unless TRUSTED_PROXY_CIDRS covers it",
      );
    server.on("upgrade", (req, socket, head) => {
      const pathname = parse(req.url || "").pathname || "";
      // Other upgrades (Next.js development HMR) are Next's own.
      if (!pathname.startsWith("/api/collaboration/")) return;
      stampUpgradeClientIp(req, proxySecret);
      proxySyncUpgrade(syncServerUrl, req, socket, head);
    });

    const shutdown = createGracefulShutdown({
      closeServer: () =>
        new Promise<void>((resolvePromise) =>
          server.close(() => resolvePromise()),
        ),
      disconnect: disconnectDatabase,
      exit: (code) => process.exit(code),
      deadlineMs: 20_000,
      logger,
    });

    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));

    server.listen(port, hostname, () => {
      logger.info({ hostname, port }, "Server ready");
    });
  })
  .catch((error) => {
    logger.error({ error }, "Failed to prepare Next.js application");
    process.exit(1);
  });
