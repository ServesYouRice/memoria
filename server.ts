/**
 * Custom Next.js Server with WebSocket Support
 * Following ADR-0010: Real-Time Collaboration Strategy
 */

import "./src/lib/env";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { createCollaborationServer } from "./src/lib/collaboration/websocket-server";
import { logger } from "./src/lib/logger";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || (dev ? "localhost" : "0.0.0.0");
const port = parseInt(process.env["PORT"] || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer(async (req, res) => {
      try {
        // Never trust a caller-supplied forwarding header for security
        // decisions. The custom server is the only component allowed to set
        // this value, so middleware can key abuse controls to the actual peer.
        req.headers["x-memoria-client-ip"] =
          req.socket.remoteAddress || "unknown";
        const parsedUrl = parse(req.url!, true);
        await handle(req, res, parsedUrl);
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

    // Initialize WebSocket server for collaboration
    const collaborationServer = createCollaborationServer(server);

    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, "Graceful shutdown started");

      const deadline = setTimeout(() => {
        logger.error("Graceful shutdown deadline exceeded");
        process.exit(1);
      }, 20_000);
      deadline.unref();

      collaborationServer.clients.forEach((client) =>
        client.close(1001, "Server shutting down"),
      );
      collaborationServer.close();
      await new Promise<void>((resolvePromise) =>
        server.close(() => resolvePromise()),
      );
      clearTimeout(deadline);
      logger.info("Graceful shutdown complete");
      process.exit(0);
    };

    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));

    server.listen(port, () => {
      logger.info({ hostname, port }, "Server ready");
      logger.info("WebSocket server ready for collaboration");
    });
  })
  .catch((error) => {
    logger.error({ error }, "Failed to prepare Next.js application");
    process.exit(1);
  });
