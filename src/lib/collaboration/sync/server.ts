/**
 * IMP-042 — the Hocuspocus sync server.
 *
 * Runs as its own process (`scripts/sync-server.ts`, the `sync` compose
 * service) from the application image, like the outbox worker. Browsers reach
 * it at `COLLABORATION_SYNC_PATH` through the gateway, or through the app
 * server's upgrade proxy where no gateway route exists. It
 *
 * - admits upgrades only on the sync path, from the configured origin, within
 *   the per-client upgrade budget and the global connection cap;
 * - authenticates each document with the Better Auth session (or a public
 *   share token) and re-checks every connection on the presence socket's
 *   authorization interval;
 * - validates, persists and projects every update before acknowledging it
 *   (`engine.ts`), and closes the document for a client whose update it
 *   refused so the client resyncs;
 * - pulls committed row changes from HTTP routes, agents and restores into
 *   open documents;
 * - answers `/health` (liveness) and `/ready` (database reachable).
 *
 * @module lib/collaboration/sync/server
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import { Server, type Connection, type Hocuspocus } from "@hocuspocus/server";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AUTHORIZATION_REFRESH_INTERVAL_MS,
  FixedWindowAdmissionBudget,
  authorizationLeaseMustClose,
} from "@/lib/collaboration/transport-policy";
import {
  deriveUpgradeClientId,
  isAllowedCollaborationOrigin,
} from "@/lib/collaboration/upgrade-policy";
import {
  type SyncConnectionContext,
  authorizeSyncConnection,
  canWriteDocument,
  refreshSyncAuthorizations,
} from "./authorization";
import { CanvasSyncEngine, type EngineLogger } from "./engine";
import {
  COLLABORATION_SYNC_PATH,
  SYNC_CLOSE_CODES,
  SYNC_CLOSE_REASONS,
} from "./protocol";
import { InvalidDocumentUpdateError } from "./validation";

const MAX_UPGRADES_PER_CLIENT_PER_MINUTE = 60;
const MAX_CONNECTIONS = 5_000;
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const SYNC_STEP_1 = 0;

export interface SyncServerOptions {
  prisma: PrismaClient;
  logger: EngineLogger;
  port: number;
  address?: string;
  /** Browser origin allowed to connect (the app's AUTH_URL). */
  allowedOrigin: string | undefined;
  authorizationRefreshMs?: number;
  /** How often open documents look for committed row changes. */
  reconcileIntervalMs?: number;
  compactAfterUpdates?: number;
}

export interface SyncServer {
  engine: CanvasSyncEngine;
  hocuspocus: Hocuspocus;
  listen(): Promise<{ port: number }>;
  /** Re-check every connection now (the interval calls this). */
  refreshAuthorizations(): Promise<void>;
  /** Pull committed row changes into every open document now. */
  reconcileOpenDocuments(): Promise<void>;
  destroy(): Promise<void>;
}

class SyncCloseError extends Error {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "SyncCloseError";
  }
}

/** Hocuspocus treats a rejection without a value as "handled, stop here". */
function handled(): Promise<never> {
  return Promise.reject(undefined);
}

function rejectUpgrade(socket: Duplex, status: string): Promise<never> {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
  return handled();
}

function respond(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): Promise<never> {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
  return handled();
}

function connectionContext(
  connection: Connection,
): SyncConnectionContext | undefined {
  return connection.context as SyncConnectionContext | undefined;
}

function closeConnection(
  connection: Connection,
  code: number,
  reason: string,
): void {
  connection.close({ code, reason });
  try {
    connection.webSocket.close(code, reason);
  } catch {
    // Already closed.
  }
}

export function createSyncServer(options: SyncServerOptions): SyncServer {
  const { prisma, logger } = options;
  const engine = new CanvasSyncEngine({
    prisma,
    logger,
    compactAfterUpdates: options.compactAfterUpdates,
    maxUpdateBytes: MAX_MESSAGE_BYTES,
  });
  const upgradeBudgets = new FixedWindowAdmissionBudget(
    MAX_UPGRADES_PER_CLIENT_PER_MINUTE,
    60_000,
  );
  const connectionCount = () => server.hocuspocus.getConnectionsCount();

  const server: Server = new Server({
    name: "memoria-sync",
    port: options.port,
    address: options.address,
    quiet: true,
    stopOnSignals: false,
    timeout: 60_000,
    unloadImmediately: true,
    websocketOptions: { maxPayload: MAX_MESSAGE_BYTES },

    async onRequest({ request, response }) {
      const path = new URL(request.url ?? "/", "http://sync.local").pathname;
      if (path === "/health") {
        return respond(response, 200, {
          status: "ok",
          documents: engine.loadedCanvasIds().length,
          connections: connectionCount(),
        });
      }
      if (path === "/ready") {
        try {
          await prisma.$queryRaw`SELECT 1`;
          return respond(response, 200, { status: "ready" });
        } catch (error) {
          logger.error({ error }, "Sync server readiness check failed");
          return respond(response, 503, { status: "unavailable" });
        }
      }
      return respond(response, 404, { error: "Not found" });
    },

    async onUpgrade({ request, socket }) {
      const incoming = request as IncomingMessage;
      const path = new URL(incoming.url ?? "/", "http://sync.local").pathname;
      if (path !== COLLABORATION_SYNC_PATH)
        return rejectUpgrade(socket, "404 Not Found");
      if (
        !isAllowedCollaborationOrigin(
          incoming.headers.origin,
          options.allowedOrigin,
        )
      )
        return rejectUpgrade(socket, "403 Forbidden");
      if (
        !upgradeBudgets.consume(deriveUpgradeClientId(incoming)) ||
        connectionCount() >= MAX_CONNECTIONS
      )
        return rejectUpgrade(socket, "429 Too Many Requests");
    },

    async onAuthenticate({
      documentName,
      requestHeaders,
      token,
      connectionConfig,
    }) {
      const context = await authorizeSyncConnection(prisma, {
        documentName,
        headers: requestHeaders,
        token,
      });
      if (!context) {
        throw new SyncCloseError(
          SYNC_CLOSE_CODES.forbidden,
          SYNC_CLOSE_REASONS.forbidden,
        );
      }
      // View and comment roles never apply updates (Hocuspocus refuses them
      // for read-only connections); the hook below re-checks the role.
      connectionConfig.readOnly = !canWriteDocument(context.access);
      return context;
    },

    async onLoadDocument({ documentName }) {
      try {
        return await engine.load(documentName);
      } catch (error) {
        // Hocuspocus reports a failed load as an authentication failure;
        // the reason tells the client to retry rather than give up.
        logger.error(
          { error, canvasId: documentName },
          "Could not load a canvas document",
        );
        throw new SyncCloseError(
          SYNC_CLOSE_CODES.unavailable,
          SYNC_CLOSE_REASONS.unavailable,
        );
      }
    },

    async afterLoadDocument({ documentName, document }) {
      engine.attach(documentName, document);
    },

    async afterUnloadDocument({ documentName }) {
      await engine.unload(documentName);
    },

    async beforeSync({ connection, documentName, type, payload }) {
      if (type === SYNC_STEP_1) return;
      const context = connectionContext(connection);
      if (connection.readOnly || !context || !canWriteDocument(context.access))
        return;
      if (context.leaseExpiresAt <= Date.now()) {
        throw new SyncCloseError(
          SYNC_CLOSE_CODES.unavailable,
          SYNC_CLOSE_REASONS.unavailable,
        );
      }
      try {
        await engine.applyClientUpdate({
          canvasId: documentName,
          actorId: context.principalId,
          update: payload,
          origin: { source: "connection", connection },
        });
      } catch (error) {
        if (error instanceof InvalidDocumentUpdateError) {
          logger.warn(
            {
              canvasId: documentName,
              userId: context.principalId,
              reason: error.message,
            },
            "Refused a collaborative document update",
          );
          throw new SyncCloseError(
            SYNC_CLOSE_CODES.invalidUpdate,
            SYNC_CLOSE_REASONS.invalidUpdate,
          );
        }
        logger.error(
          { error, canvasId: documentName },
          "Could not store a collaborative document update",
        );
        throw new SyncCloseError(
          SYNC_CLOSE_CODES.unavailable,
          SYNC_CLOSE_REASONS.unavailable,
        );
      }
    },
  });

  function openConnections(): Array<{
    canvasId: string;
    connection: Connection;
    context: SyncConnectionContext;
  }> {
    const open = [];
    for (const [canvasId, document] of server.hocuspocus.documents) {
      for (const connection of document.getConnections()) {
        const context = connectionContext(connection);
        if (context) open.push({ canvasId, connection, context });
      }
    }
    return open;
  }

  async function refreshAuthorizations(): Promise<void> {
    const open = openConnections();
    if (open.length === 0) return;
    const now = Date.now();
    let results;
    try {
      results = await refreshSyncAuthorizations(prisma, open);
    } catch (error) {
      logger.error({ error }, "Sync authorization refresh failed");
      for (const { connection, context } of open) {
        context.authorizationFailures += 1;
        if (
          authorizationLeaseMustClose({
            consecutiveFailures: context.authorizationFailures,
            leaseExpiresAt: context.leaseExpiresAt,
            now,
          })
        ) {
          closeConnection(
            connection,
            SYNC_CLOSE_CODES.unavailable,
            SYNC_CLOSE_REASONS.unavailable,
          );
        }
      }
      return;
    }
    for (const { canvasId, connection, context } of open) {
      const access = results.get(context);
      if (!access) {
        logger.info(
          { canvasId, userId: context.principalId },
          "Closing a sync connection whose access was revoked",
        );
        closeConnection(
          connection,
          SYNC_CLOSE_CODES.forbidden,
          SYNC_CLOSE_REASONS.forbidden,
        );
        continue;
      }
      context.access = access;
      context.authorizationFailures = 0;
      context.leaseExpiresAt =
        now +
        (options.authorizationRefreshMs ?? AUTHORIZATION_REFRESH_INTERVAL_MS) *
          3;
      connection.readOnly = !canWriteDocument(access);
    }
  }

  let reconcileInFlight: Promise<void> | null = null;
  async function reconcileOpenDocuments(): Promise<void> {
    const canvasIds = engine.loadedCanvasIds();
    if (canvasIds.length === 0) return;
    const latest = await prisma.$queryRaw<
      Array<{ canvasId: string; sequence: bigint | null }>
    >`
      SELECT ids."canvasId", (
        SELECT event."sequence" FROM "CanvasEvent" event
        WHERE event."canvasId" = ids."canvasId"
        ORDER BY event."sequence" DESC LIMIT 1
      ) AS "sequence"
      FROM unnest(${canvasIds}::text[]) AS ids("canvasId")
    `;
    await Promise.all(
      latest
        .filter(({ canvasId, sequence }) => {
          const current = engine.eventSequence(canvasId);
          return sequence !== null && current !== null && sequence > current;
        })
        .map(({ canvasId }) =>
          engine
            .catchUp(canvasId)
            .catch((error) =>
              logger.error(
                { error, canvasId },
                "Could not reconcile a canvas document with its rows",
              ),
            ),
        ),
    );
  }

  const timers: NodeJS.Timeout[] = [];

  return {
    engine,
    get hocuspocus() {
      return server.hocuspocus;
    },
    async listen() {
      await server.listen();
      timers.push(
        setInterval(() => {
          upgradeBudgets.sweep();
          void refreshAuthorizations();
        }, options.authorizationRefreshMs ?? AUTHORIZATION_REFRESH_INTERVAL_MS),
        setInterval(() => {
          if (reconcileInFlight) return;
          reconcileInFlight = reconcileOpenDocuments()
            .catch((error) =>
              logger.error({ error }, "Canvas document reconciliation failed"),
            )
            .finally(() => {
              reconcileInFlight = null;
            });
        }, options.reconcileIntervalMs ?? 1_000),
      );
      return { port: server.address.port };
    },
    refreshAuthorizations,
    reconcileOpenDocuments,
    async destroy() {
      for (const timer of timers) clearInterval(timer);
      await reconcileInFlight;
      await server.destroy();
      await engine.drain();
    },
  };
}
