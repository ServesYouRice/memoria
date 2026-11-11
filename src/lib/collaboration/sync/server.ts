/**
 * IMP-042 — the Hocuspocus sync server.
 *
 * Runs as its own process (`scripts/sync-server.ts`, the `sync` compose
 * service) from the application image, like the outbox worker. Browsers reach
 * it at `COLLABORATION_SYNC_PATH` through the gateway, or through the app
 * server's upgrade proxy where no gateway route exists. It
 *
 * - admits upgrades only on the sync path, from the configured origin, within
 *   the per-client upgrade budget, the per-client socket limit and the
 *   global connection cap;
 * - authenticates each document with the Better Auth session (or a public
 *   share token) and re-checks every connection on the presence socket's
 *   authorization interval;
 * - admits each authenticated document connection within the per-canvas,
 *   per-principal and per-client limits (shared across replicas through
 *   Redis), and releases it when the connection or its socket closes;
 * - validates, persists and projects every update before acknowledging it
 *   (`engine.ts`), and closes the document for a client whose update it
 *   refused so the client resyncs;
 * - pulls committed row changes from HTTP routes, agents and restores into
 *   open documents;
 * - pulls updates other sync replicas stored (IMP-043): a Redis message names
 *   the canvas at once, and the reconcile interval compares update cursors as
 *   a fallback, so replicas converge even if a message is lost;
 * - can host the presence socket on the same HTTP server (`passUpgrade`), so
 *   one realtime process serves every `/api/collaboration/*` connection;
 * - answers `/health` (liveness) and `/ready` (database reachable).
 *
 * @module lib/collaboration/sync/server
 */

import type {
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from "http";
import type Redis from "ioredis";
import { nanoid } from "nanoid";
import type { Duplex } from "stream";
import { Server, type Connection, type Hocuspocus } from "@hocuspocus/server";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AUTHORIZATION_LEASE_MS,
  AUTHORIZATION_REFRESH_INTERVAL_MS,
  authorizationLeaseMustClose,
} from "@/lib/collaboration/transport-policy";
import {
  type AdmittedConnection,
  SharedConnectionAdmission,
} from "@/lib/collaboration/shared-admission";
import { syncDocumentsChannel } from "@/lib/collaboration/channels";
import {
  deriveUpgradeClientId,
  isAllowedCollaborationOrigin,
} from "@/lib/collaboration/upgrade-policy";
import {
  SYNC_SIGNED_OUT,
  type SyncAuthorization,
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
// Concurrent document connections, with the presence socket's values
// (websocket-server.ts): a browser holds one of each per open canvas.
const MAX_CONNECTIONS_PER_CANVAS = 100;
const MAX_CONNECTIONS_PER_PRINCIPAL = 10;
const MAX_CONNECTIONS_PER_CLIENT = 30;
// Open WebSockets per client in this process, authenticated or not.
// Hocuspocus closes a socket that authenticates no document within `timeout`.
const MAX_SOCKETS_PER_CLIENT = MAX_CONNECTIONS_PER_CLIENT;
/** Set in onUpgrade (replacing any caller copy) to find the socket's entry. */
const SOCKET_HEADER = "x-memoria-sync-socket";
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
  /**
   * Redis for cross-replica notifications and shared limits; null runs a
   * single replica (other replicas would still converge through polling).
   */
  redis?: Redis | null;
  /**
   * Upgrades on these paths belong to another handler on the same HTTP
   * server (the presence socket); the sync server leaves them alone.
   */
  passUpgrade?: (path: string) => boolean;
  /** Extra fields for `/health`, e.g. the presence socket's counts. */
  health?: (url: URL) => Record<string, unknown>;
}

export interface SyncServer {
  engine: CanvasSyncEngine;
  hocuspocus: Hocuspocus;
  /** The HTTP server, for attaching the presence socket. */
  httpServer: HttpServer;
  listen(): Promise<{ port: number }>;
  /** Re-check every connection now (the interval calls this). */
  refreshAuthorizations(): Promise<void>;
  /** Pull committed row changes into every open document now. */
  reconcileOpenDocuments(): Promise<void>;
  destroy(): Promise<void>;
}

/** A document connection holding a slot in the admission limits. */
interface AdmittedDocument extends AdmittedConnection {
  /** Hocuspocus created the connection, so onDisconnect will run for it. */
  established: boolean;
  released: boolean;
}

interface OpenSocket {
  clientId: string;
  admitted: Set<AdmittedDocument>;
}

type AdmittedContext = SyncConnectionContext & { admission: AdmittedDocument };

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
  const redis = options.redis ?? null;
  const instanceId = nanoid(10);
  /** Canvases whose stored document moved (IMP-043), under the prefix. */
  const documentsChannel = syncDocumentsChannel();
  const engine = new CanvasSyncEngine({
    prisma,
    logger,
    compactAfterUpdates: options.compactAfterUpdates,
    maxUpdateBytes: MAX_MESSAGE_BYTES,
    onCommitted: (canvasId) => {
      if (!redis) return;
      redis
        .publish(documentsChannel, JSON.stringify({ canvasId, instanceId }))
        .catch((error) =>
          logger.error({ error }, "Could not announce a document update"),
        );
    },
  });
  const admission = new SharedConnectionAdmission({
    scope: "sync",
    limits: {
      global: MAX_CONNECTIONS,
      perCanvas: MAX_CONNECTIONS_PER_CANVAS,
      perPrincipal: MAX_CONNECTIONS_PER_PRINCIPAL,
      perClient: MAX_CONNECTIONS_PER_CLIENT,
    },
    upgradesPerMinute: MAX_UPGRADES_PER_CLIENT_PER_MINUTE,
    leaseMs: AUTHORIZATION_LEASE_MS,
    redis,
    logger,
  });
  const connectionCount = () => server.hocuspocus.getConnectionsCount();
  /** Upgraded sockets by the key in SOCKET_HEADER, until they close. */
  const sockets = new Map<string, OpenSocket>();
  const socketsPerClient = new Map<string, number>();

  function releaseAdmitted(open: OpenSocket, admitted: AdmittedDocument): void {
    if (admitted.released) return;
    admitted.released = true;
    open.admitted.delete(admitted);
    void admission.release(admitted);
  }

  function* admittedConnections(): Iterable<AdmittedDocument> {
    for (const open of sockets.values()) yield* open.admitted;
  }

  let subscriber: Redis | null = null;
  async function subscribeToPeers(): Promise<void> {
    if (!redis) return;
    subscriber = redis.duplicate();
    subscriber.on("error", (error) =>
      logger.error({ error }, "Sync Redis subscriber error"),
    );
    subscriber.on("message", (_channel, message) => {
      let parsed: { canvasId?: unknown; instanceId?: unknown };
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      if (parsed.instanceId === instanceId) return;
      if (typeof parsed.canvasId !== "string") return;
      if (engine.updateCursor(parsed.canvasId) === null) return;
      const canvasId = parsed.canvasId;
      engine
        .pull(canvasId)
        .catch((error) =>
          logger.error(
            { error, canvasId },
            "Could not apply another replica's document update",
          ),
        );
    });
    await subscriber.subscribe(documentsChannel);
  }

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
      const url = new URL(request.url ?? "/", "http://sync.local");
      const path = url.pathname;
      if (path === "/health") {
        return respond(response, 200, {
          status: "ok",
          documents: engine.loadedCanvasIds().length,
          connections: connectionCount(),
          ...options.health?.(url),
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
      if (path !== COLLABORATION_SYNC_PATH) {
        if (options.passUpgrade?.(path)) return handled();
        return rejectUpgrade(socket, "404 Not Found");
      }
      if (
        !isAllowedCollaborationOrigin(
          incoming.headers.origin,
          options.allowedOrigin,
        )
      )
        return rejectUpgrade(socket, "403 Forbidden");
      const clientId = deriveUpgradeClientId(incoming);
      if (
        connectionCount() >= MAX_CONNECTIONS ||
        sockets.size >= MAX_CONNECTIONS ||
        !(await admission.consumeUpgrade(clientId)) ||
        (socketsPerClient.get(clientId) ?? 0) >= MAX_SOCKETS_PER_CLIENT
      )
        return rejectUpgrade(socket, "429 Too Many Requests");
      // Closed while the budget was checked: "close" will not fire again.
      if (socket.destroyed) return handled();
      const socketKey = nanoid();
      const open: OpenSocket = { clientId, admitted: new Set() };
      sockets.set(socketKey, open);
      socketsPerClient.set(clientId, (socketsPerClient.get(clientId) ?? 0) + 1);
      incoming.headers[SOCKET_HEADER] = socketKey;
      socket.once("close", () => {
        sockets.delete(socketKey);
        const remaining = (socketsPerClient.get(clientId) ?? 0) - 1;
        if (remaining > 0) socketsPerClient.set(clientId, remaining);
        else socketsPerClient.delete(clientId);
        // Covers admissions that never became a connection (the socket
        // closed during authentication or the document failed to load).
        for (const admitted of [...open.admitted])
          releaseAdmitted(open, admitted);
      });
    },

    async onAuthenticate({
      documentName,
      requestHeaders,
      token,
      connectionConfig,
    }) {
      let authorization: SyncAuthorization;
      try {
        authorization = await authorizeSyncConnection(prisma, {
          documentName,
          headers: requestHeaders,
          token,
        });
      } catch (error) {
        // A failed session or canvas lookup (pool timeout, failover) is not a
        // lost grant: tell the client to retry and keep its device copy,
        // as onLoadDocument does for a failed load.
        logger.error(
          { error, canvasId: documentName },
          "Could not authorize a sync connection",
        );
        throw new SyncCloseError(
          SYNC_CLOSE_CODES.unavailable,
          SYNC_CLOSE_REASONS.unavailable,
        );
      }
      if (authorization.status === "signed-out") {
        // Not a lost grant: the client keeps its device copy and stops
        // until the user signs in again.
        throw new SyncCloseError(
          SYNC_CLOSE_CODES.signedOut,
          SYNC_CLOSE_REASONS.signedOut,
        );
      }
      if (authorization.status !== "granted") {
        throw new SyncCloseError(
          SYNC_CLOSE_CODES.forbidden,
          SYNC_CLOSE_REASONS.forbidden,
        );
      }
      const { context } = authorization;
      // View and comment roles never apply updates (Hocuspocus refuses them
      // for read-only connections); the hook below re-checks the role.
      connectionConfig.readOnly = !canWriteDocument(context.access);

      const socketKey = requestHeaders.get(SOCKET_HEADER) ?? "";
      const open = sockets.get(socketKey);
      // An earlier attempt for this document on the same socket that never
      // became a connection (its load failed) must not keep its slot.
      for (const earlier of open ? [...open.admitted] : [])
        if (earlier.canvasId === documentName && !earlier.established)
          releaseAdmitted(open!, earlier);
      const admitted: AdmittedDocument = {
        id: nanoid(),
        canvasId: documentName,
        principalId: context.principalId,
        clientId: open?.clientId ?? "unknown",
        established: false,
        released: false,
      };
      const decision = open ? await admission.admit(admitted) : null;
      // Over a limit, or the socket closed meanwhile. Retryable, never
      // forbidden: that would make the client drop its device copy.
      if (!open || !decision?.admitted || sockets.get(socketKey) !== open) {
        if (decision?.admitted) void admission.release(admitted);
        else if (decision)
          logger.warn(
            {
              canvasId: documentName,
              userId: context.principalId,
              limit: decision.reason,
            },
            "Refused a sync connection over a concurrent limit",
          );
        throw new SyncCloseError(
          SYNC_CLOSE_CODES.unavailable,
          SYNC_CLOSE_REASONS.unavailable,
        );
      }
      open.admitted.add(admitted);
      const admittedContext: AdmittedContext = {
        ...context,
        admission: admitted,
      };
      return admittedContext;
    },

    async connected({ context }) {
      const admitted = (context as Partial<AdmittedContext>).admission;
      if (admitted) admitted.established = true;
    },

    // Runs once for every connection Hocuspocus created, however it closed.
    async onDisconnect({ context, requestHeaders }) {
      const admitted = (context as Partial<AdmittedContext>).admission;
      if (!admitted) return;
      const open = sockets.get(requestHeaders.get(SOCKET_HEADER) ?? "");
      if (open) releaseAdmitted(open, admitted);
      else if (!admitted.released) {
        admitted.released = true;
        void admission.release(admitted);
      }
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
      if (access === SYNC_SIGNED_OUT) {
        logger.info(
          { canvasId, userId: context.principalId },
          "Closing a sync connection whose session ended",
        );
        closeConnection(
          connection,
          SYNC_CLOSE_CODES.signedOut,
          SYNC_CLOSE_REASONS.signedOut,
        );
        continue;
      }
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
      const writable = canWriteDocument(access);
      if (writable === connection.readOnly) {
        // The role moved between editing and read-only. Apply it at once,
        // then make the client authenticate again to learn its new scope.
        connection.readOnly = !writable;
        closeConnection(
          connection,
          SYNC_CLOSE_CODES.reauthenticate,
          SYNC_CLOSE_REASONS.reauthenticate,
        );
      }
    }
  }

  let reconcileInFlight: Promise<void> | null = null;
  async function reconcileOpenDocuments(): Promise<void> {
    const canvasIds = engine.loadedCanvasIds();
    if (canvasIds.length === 0) return;
    const latest = await prisma.$queryRaw<
      Array<{
        canvasId: string;
        sequence: bigint | null;
        updateId: bigint | null;
      }>
    >`
      SELECT ids."canvasId", (
        SELECT event."sequence" FROM "CanvasEvent" event
        WHERE event."canvasId" = ids."canvasId"
        ORDER BY event."sequence" DESC LIMIT 1
      ) AS "sequence", GREATEST(
        (SELECT document."compactedThrough" FROM "CanvasDocument" document
         WHERE document."canvasId" = ids."canvasId"),
        (SELECT stored."id" FROM "CanvasDocumentUpdate" stored
         WHERE stored."canvasId" = ids."canvasId"
         ORDER BY stored."id" DESC LIMIT 1)
      ) AS "updateId"
      FROM unnest(${canvasIds}::text[]) AS ids("canvasId")
    `;
    await Promise.all(
      latest.map(async ({ canvasId, sequence, updateId }) => {
        try {
          // Another replica stored updates this one has not applied.
          const cursor = engine.updateCursor(canvasId);
          if (updateId !== null && cursor !== null && updateId > cursor)
            await engine.pull(canvasId);
          const current = engine.eventSequence(canvasId);
          if (sequence !== null && current !== null && sequence > current)
            await engine.catchUp(canvasId);
        } catch (error) {
          logger.error(
            { error, canvasId },
            "Could not reconcile a canvas document",
          );
        }
      }),
    );
  }

  const timers: NodeJS.Timeout[] = [];

  return {
    engine,
    get hocuspocus() {
      return server.hocuspocus;
    },
    get httpServer() {
      return server.httpServer;
    },
    async listen() {
      await subscribeToPeers();
      await server.listen();
      timers.push(
        setInterval(() => {
          admission.sweep();
          void admission.renew(admittedConnections());
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
      await subscriber?.quit().catch(() => undefined);
      await reconcileInFlight;
      await server.destroy();
      await engine.drain();
    },
  };
}
