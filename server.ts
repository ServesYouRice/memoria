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
import { deriveClientIp } from "./src/lib/network/client-ip";
import { nanoid } from "nanoid";
import { runWithRequestContext } from "./src/lib/api/request-context";

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
