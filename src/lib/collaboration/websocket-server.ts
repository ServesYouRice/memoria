/**
 * WebSocket Server for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Handles collaboration presence, cursors, chat, and reactions.
 */

import { type IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { prisma } from "@/lib/db";
import { getSessionFromHeaders, headersFromNode } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { nanoid } from "nanoid";
import { getRedisClient } from "@/lib/cache/redis-client";
import {
  incrementOperationalCounter,
  setOperationalGauge,
} from "@/lib/operations/runtime-metrics";
import { z } from "zod";
import {
  AUTHORIZATION_LEASE_MS,
  AUTHORIZATION_REFRESH_INTERVAL_MS,
  CURSOR_TICK_MS,
  ExpiringCanvasInstances,
  authorizationLeaseMustClose,
  collaborationColorForUser,
  consumeMessageBudget,
  resolveCollaborationAccess,
} from "./transport-policy";
import {
  deriveUpgradeClientId,
  isAllowedCollaborationOrigin,
} from "./upgrade-policy";
import { COLLABORATION_SYNC_PATH } from "./sync/protocol";
import { SharedConnectionAdmission } from "./shared-admission";
import { canvasChannel, canvasChannelPrefix } from "./channels";

export interface CollaborationUser {
  userId: string;
  email: string;
  name?: string;
  color: string;
  accessLevel?: "OWNER" | "EDIT" | "COMMENT" | "VIEW";
  /** Better Auth session row backing this connection (absent for guests). */
  sessionId?: string;
}

interface ClientConnection {
  /** Unique per socket; names the connection in the shared admission sets. */
  id: string;
  ws: WebSocket;
  canvasId: string;
  user: CollaborationUser;
  accessLevel: "OWNER" | "EDIT" | "COMMENT" | "VIEW";
  cursorPosition?: { x: number; y: number };
  isAlive: boolean;
  cursorCount: number;
  controlCount: number;
  resetAt: number;
  authorizationLeaseExpiresAt: number;
  authorizationFailureCount: number;
  clientId: string;
  guestShareToken?: string;
}

// Presence renewal, zombie detection, and the global authorization batch share
// one interval so a quiet connection still has a bounded remote lease.
const HEARTBEAT_INTERVAL = AUTHORIZATION_REFRESH_INTERVAL_MS;
const RATE_LIMIT_WINDOW = 60000;
const MAX_WEBSOCKET_PAYLOAD = 64 * 1024;
const MAX_COLLABORATORS_PER_CANVAS = 100;
const MAX_CONNECTIONS_GLOBAL = 5_000;
const MAX_CONNECTIONS_PER_PRINCIPAL = 10;
const MAX_CONNECTIONS_PER_CLIENT = 30;
const MAX_UPGRADES_PER_CLIENT_PER_MINUTE = 60;
const MAX_MESSAGE_PAYLOAD_BYTES = 8 * 1024;

function bytesFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Slow-consumer limits on a socket's queued outbound bytes
 * (`ws.bufferedAmount`). Above the soft limit, ephemeral fanout (cursors,
 * presence, cursor chat, reactions) is skipped for that socket: the next
 * update supersedes it. Above the hard limit the socket is terminated, since
 * a message that must arrive can no longer be delivered in time. Defaults:
 * 1 MiB soft (a few hundred cursor frames) and 8 MiB hard; override with
 * COLLABORATION_SEND_SOFT_LIMIT_BYTES / COLLABORATION_SEND_HARD_LIMIT_BYTES.
 */
export const SLOW_CONSUMER_LIMITS = Object.freeze({
  softBytes: bytesFromEnv("COLLABORATION_SEND_SOFT_LIMIT_BYTES", 1024 * 1024),
  hardBytes: bytesFromEnv(
    "COLLABORATION_SEND_HARD_LIMIT_BYTES",
    8 * 1024 * 1024,
  ),
});

type SlowConsumerLimits = { softBytes: number; hardBytes: number };
type SendTarget = {
  ws: Pick<WebSocket, "readyState" | "bufferedAmount" | "send" | "terminate">;
};

/**
 * Every broadcast send goes through here. Droppable messages are skipped for
 * a backed-up socket; a socket over the hard limit is terminated rather than
 * left to queue without bound, so a message that must arrive is never
 * silently dropped.
 */
export function sendToClient(
  client: SendTarget,
  message: string,
  options: { droppable: boolean },
  limits: SlowConsumerLimits = SLOW_CONSUMER_LIMITS,
): "sent" | "skipped" | "closed" | "not-open" {
  const { ws } = client;
  if (ws.readyState !== WebSocket.OPEN) return "not-open";
  if (ws.bufferedAmount > limits.hardBytes) {
    ws.terminate();
    return "closed";
  }
  if (options.droppable && ws.bufferedAmount > limits.softBytes)
    return "skipped";
  ws.send(message);
  return "sent";
}

/**
 * One client's heartbeat: a socket over the hard limit is terminated even if
 * it answers pings (pongs can be sent without reading anything); otherwise
 * the usual ping/pong liveness check.
 */
export function heartbeatClient(
  client: {
    ws: Pick<WebSocket, "bufferedAmount" | "ping" | "terminate">;
    isAlive: boolean;
  },
  limits: SlowConsumerLimits = SLOW_CONSUMER_LIMITS,
): "terminated-slow" | "terminated-zombie" | "pinged" {
  if (client.ws.bufferedAmount > limits.hardBytes) {
    client.ws.terminate();
    return "terminated-slow";
  }
  if (!client.isAlive) {
    client.ws.terminate();
    return "terminated-zombie";
  }
  client.isAlive = false;
  client.ws.ping();
  return "pinged";
}

const SOCIAL_MESSAGE_KINDS = new Set(["cursor_chat", "reaction"]);

/** Cursor chat and reactions are ephemeral; anything else must arrive. */
function isDroppablePayload(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    SOCIAL_MESSAGE_KINDS.has(String((payload as { kind?: unknown }).kind))
  );
}
const dirtyCursorCanvases = new Set<string>();

interface CursorPosition {
  userId: string;
  color: string;
  position: { x: number; y: number };
}

interface CollaborationBusMessage {
  type: "presence" | "cursors" | "message" | "event";
  canvasId: string;
  instanceId: string;
  payload: unknown;
  timestamp: number;
}

const collaborationPositionSchema = z.object({
  x: z.number().finite().min(-10_000_000).max(10_000_000),
  y: z.number().finite().min(-10_000_000).max(10_000_000),
});

const collaborationMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cursor"),
    position: collaborationPositionSchema,
  }),
  z.object({ type: z.literal("awareness") }),
  z.object({
    type: z.literal("message"),
    payload: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("cursor_chat"),
        message: z.string().trim().min(1).max(280),
        position: collaborationPositionSchema,
      }),
      z.object({
        kind: z.literal("reaction"),
        emoji: z.string().min(1).max(8),
        position: collaborationPositionSchema,
      }),
    ]),
  }),
]);

export function parseCollaborationMessage(value: unknown) {
  return collaborationMessageSchema.safeParse(value);
}

export function canBroadcastSocial(
  accessLevel: ClientConnection["accessLevel"],
): boolean {
  return accessLevel !== "VIEW";
}

export function isValidGuestShare(
  canvas: { isPublic: boolean; shareToken: string | null },
  suppliedToken: string | null,
): boolean {
  return Boolean(
    canvas.isPublic && suppliedToken && suppliedToken === canvas.shareToken,
  );
}

// Active connections per canvas
const connections = new Map<string, Set<ClientConnection>>();
const subscriptions = new Map<string, number>();
const remotePresence = new ExpiringCanvasInstances<CollaborationUser[]>();
const remoteCursors = new ExpiringCanvasInstances<CursorPosition[]>();
// Shared with the sync server (IMP-042); re-exported for existing callers.
export { isAllowedCollaborationOrigin, deriveUpgradeClientId };

const instanceId = nanoid(8);
const redisPublisher = getRedisClient();
// Per-canvas, per-principal and per-client limits hold across replicas
// (IMP-043); the global cap protects this process.
const admission = new SharedConnectionAdmission({
  scope: "presence",
  limits: {
    global: MAX_CONNECTIONS_GLOBAL,
    perCanvas: MAX_COLLABORATORS_PER_CANVAS,
    perPrincipal: MAX_CONNECTIONS_PER_PRINCIPAL,
    perClient: MAX_CONNECTIONS_PER_CLIENT,
  },
  upgradesPerMinute: MAX_UPGRADES_PER_CLIENT_PER_MINUTE,
  leaseMs: AUTHORIZATION_LEASE_MS,
  redis: redisPublisher,
  logger,
});
const redisSubscriber = redisPublisher ? redisPublisher.duplicate() : null;

if (redisSubscriber) {
  redisSubscriber.on("message", (channel, message) => {
    void handleRedisMessage(channel, message);
  });

  redisSubscriber.on("error", (error) => {
    logger.error({ error }, "Redis subscriber error");
  });
}

// Channels this process is subscribed to, and one promise chain per canvas
// so SUBSCRIBE/UNSUBSCRIBE never interleave. The reference count in
// `subscriptions` changes synchronously; each chain step re-reads it after
// the previous Redis call and issues only the transition still needed.
const subscribedCanvases = new Set<string>();
const subscriptionChains = new Map<string, Promise<void>>();

function reconcileSubscription(canvasId: string): Promise<void> {
  const subscriber = redisSubscriber;
  if (!subscriber) return Promise.resolve();
  const previous = subscriptionChains.get(canvasId) ?? Promise.resolve();
  const step = previous
    .catch(() => undefined)
    .then(async () => {
      const wanted = (subscriptions.get(canvasId) ?? 0) > 0;
      const subscribed = subscribedCanvases.has(canvasId);
      if (wanted && !subscribed) {
        await subscriber.subscribe(canvasChannel(canvasId));
        subscribedCanvases.add(canvasId);
      } else if (!wanted && subscribed) {
        await subscriber.unsubscribe(canvasChannel(canvasId));
        subscribedCanvases.delete(canvasId);
        // Remote state goes only when no local socket holds the canvas.
        if ((subscriptions.get(canvasId) ?? 0) === 0) {
          remotePresence.deleteCanvas(canvasId);
          remoteCursors.deleteCanvas(canvasId);
        }
      }
    });
  subscriptionChains.set(canvasId, step);
  void step
    .catch(() => undefined)
    .then(() => {
      if (subscriptionChains.get(canvasId) === step) {
        subscriptionChains.delete(canvasId);
      }
    });
  return step;
}

function changeSubscriptionCount(canvasId: string, delta: number): void {
  const count = Math.max(0, (subscriptions.get(canvasId) ?? 0) + delta);
  if (count === 0) subscriptions.delete(canvasId);
  else subscriptions.set(canvasId, count);
}

async function subscribeToCanvas(canvasId: string): Promise<void> {
  if (!redisSubscriber) return;
  changeSubscriptionCount(canvasId, 1);
  try {
    await reconcileSubscription(canvasId);
  } catch (error) {
    // This caller holds no subscription; a later step settles the channel
    // for whoever still does.
    changeSubscriptionCount(canvasId, -1);
    void reconcileSubscription(canvasId).catch((reconcileError) =>
      logger.error(
        { error: reconcileError, canvasId },
        "Redis subscription reconcile failed",
      ),
    );
    throw error;
  }
}

async function unsubscribeFromCanvas(canvasId: string): Promise<void> {
  if (!redisSubscriber) return;
  changeSubscriptionCount(canvasId, -1);
  await reconcileSubscription(canvasId).catch((error) =>
    logger.error({ error, canvasId }, "Redis unsubscribe failed"),
  );
}

function publishMessage(message: CollaborationBusMessage): void {
  if (!redisPublisher) return;
  redisPublisher
    .publish(canvasChannel(message.canvasId), JSON.stringify(message))
    .catch((error) => logger.error({ error }, "Redis publish error"));
}

/**
 * What presence and chat recipients see of a collaborator: id, a display name
 * (never the email) and color. Every recipient, guests included, gets the
 * same payload, so no email is serialized.
 */
function publicDisplayName(user: Pick<CollaborationUser, "name">): string {
  return user.name?.trim() || "Collaborator";
}

function toPublicUser(user: CollaborationUser): CollaborationUser {
  return {
    userId: user.userId,
    // Kept as an empty string so older replicas and clients still parse it.
    email: "",
    name: publicDisplayName(user),
    color: user.color,
    accessLevel: user.accessLevel,
  };
}

function getLocalUsers(clients: Set<ClientConnection>): CollaborationUser[] {
  const users = new Map<string, CollaborationUser>();
  for (const client of clients) {
    users.set(client.user.userId, toPublicUser(client.user));
  }
  return Array.from(users.values());
}

function getLocalCursors(clients: Set<ClientConnection>): CursorPosition[] {
  const cursors = new Map<string, CursorPosition>();
  for (const client of clients) {
    if (!client.cursorPosition) continue;
    cursors.set(client.user.userId, {
      userId: client.user.userId,
      color: client.user.color,
      position: client.cursorPosition,
    });
  }
  return Array.from(cursors.values());
}

function publishPresence(canvasId: string): void {
  const clients = connections.get(canvasId);
  if (!clients || !redisPublisher) return;

  const users = getLocalUsers(clients);

  publishMessage({
    type: "presence",
    canvasId,
    instanceId,
    payload: { users },
    timestamp: Date.now(),
  });
}

function publishCursors(canvasId: string): void {
  const clients = connections.get(canvasId);
  if (!clients || !redisPublisher) return;

  const cursors = getLocalCursors(clients);

  publishMessage({
    type: "cursors",
    canvasId,
    instanceId,
    payload: { cursors },
    timestamp: Date.now(),
  });
}

function getRemoteUsers(
  canvasId: string,
  localUserIds: Set<string>,
): CollaborationUser[] {
  const users: CollaborationUser[] = [];
  const seen = new Set(localUserIds);

  remotePresence.values(canvasId).forEach((remoteUsers) => {
    remoteUsers.forEach((user) => {
      if (!seen.has(user.userId)) {
        seen.add(user.userId);
        // A replica on older code may still publish emails.
        users.push(toPublicUser(user));
      }
    });
  });

  return users;
}

function getRemoteCursors(
  canvasId: string,
  localUserIds: Set<string>,
): CursorPosition[] {
  const cursors: CursorPosition[] = [];
  const seen = new Set(localUserIds);

  remoteCursors.values(canvasId).forEach((instanceCursors) => {
    instanceCursors.forEach((cursor) => {
      if (!seen.has(cursor.userId)) {
        seen.add(cursor.userId);
        cursors.push(cursor);
      }
    });
  });

  return cursors;
}

async function handleRedisMessage(
  channel: string,
  payload: string,
): Promise<void> {
  if (!channel.startsWith(canvasChannelPrefix())) return;

  let message: CollaborationBusMessage;
  try {
    message = JSON.parse(payload) as CollaborationBusMessage;
  } catch (error) {
    logger.warn({ error }, "Invalid Redis collaboration message");
    return;
  }

  if (message.instanceId === instanceId) return;

  const { canvasId } = message;

  switch (message.type) {
    case "presence": {
      const payload = message.payload as { users?: CollaborationUser[] };
      const users = Array.isArray(payload.users) ? payload.users : [];
      // An instance new to this canvas has not seen ours yet; answer at once
      // instead of leaving it to wait for the next heartbeat.
      const newInstance = !remotePresence.has(canvasId, message.instanceId);
      remotePresence.upsert(canvasId, message.instanceId, users, Date.now());
      broadcastPresence(canvasId);
      if (newInstance) {
        publishPresence(canvasId);
        publishCursors(canvasId);
      }
      break;
    }
    case "cursors": {
      const payload = message.payload as { cursors?: CursorPosition[] };
      const cursors = Array.isArray(payload.cursors) ? payload.cursors : [];
      remoteCursors.upsert(canvasId, message.instanceId, cursors, Date.now());
      broadcastCursors(canvasId);
      break;
    }
    case "message":
      broadcastRemoteMessage(canvasId, message.payload);
      break;
    case "event":
      broadcastCommittedEvent(canvasId, message.payload);
      break;
  }
}

const REQUEST_URL_BASE = "http://collaboration.local";

/** Parse only the path and query; never the caller-controlled Host header. */
function parseRequestUrl(request: Pick<IncomingMessage, "url">): URL {
  return new URL(request.url || "", REQUEST_URL_BASE);
}

function isPresencePath(rawUrl: string | undefined): boolean {
  const path = (rawUrl || "").split("?")[0] ?? "";
  return (
    path.startsWith("/api/collaboration/") && path !== COLLABORATION_SYNC_PATH
  );
}

/**
 * Initialize WebSocket server
 */
export function createCollaborationServer(server: any): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_PAYLOAD,
  });

  const rejectUpgrade = (socket: any, response: string) => {
    incrementOperationalCounter("websocket_rejected_total");
    socket.write(response);
    socket.destroy();
  };

  // Handle WebSocket upgrade
  server.on(
    "upgrade",
    async (request: IncomingMessage, socket: any, head: Buffer) => {
      // Only the path and query route; the Host header is caller-controlled
      // and must neither throw here nor influence anything.
      let url: URL;
      try {
        url = parseRequestUrl(request);
      } catch (error) {
        logger.warn({ error }, "WebSocket upgrade with an unparsable URL");
        if (isPresencePath(request.url)) {
          rejectUpgrade(socket, "HTTP/1.1 400 Bad Request\r\n\r\n");
        }
        return;
      }

      // Only handle presence connections; document sync connections belong
      // to the sync server (IMP-042).
      if (
        url.pathname.startsWith("/api/collaboration/") &&
        url.pathname !== COLLABORATION_SYNC_PATH
      ) {
        try {
          const configuredUrl =
            process.env.AUTH_URL || process.env.NEXTAUTH_URL;
          if (
            !isAllowedCollaborationOrigin(request.headers.origin, configuredUrl)
          ) {
            rejectUpgrade(socket, "HTTP/1.1 403 Forbidden\r\n\r\n");
            return;
          }
          const clientId = deriveUpgradeClientId(request);
          if (
            getConnectionCount() >= MAX_CONNECTIONS_GLOBAL ||
            !(await admission.consumeUpgrade(clientId))
          ) {
            rejectUpgrade(socket, "HTTP/1.1 429 Too Many Requests\r\n\r\n");
            return;
          }
          const pathParts = url.pathname.split("/");
          const canvasId = pathParts[pathParts.length - 1];

          if (!canvasId) {
            rejectUpgrade(socket, "HTTP/1.1 400 Bad Request\r\n\r\n");
            return;
          }

          // 1. Authentication: the same session helper as every HTTP route.
          const authSession = await getSessionFromHeaders(
            headersFromNode(request.headers),
            { refresh: false },
          );

          const publicCanvas = await prisma.canvas.findUnique({
            where: { id: canvasId },
            select: {
              id: true,
              isPublic: true,
              shareToken: true,
            },
          });

          if (!publicCanvas) {
            rejectUpgrade(socket, "HTTP/1.1 404 Not Found\r\n\r\n");
            return;
          }

          if (!authSession) {
            const shareToken = url.searchParams.get("shareToken");
            if (!isValidGuestShare(publicCanvas, shareToken)) {
              logger.warn("WebSocket connection attempt without a session");
              rejectUpgrade(socket, "HTTP/1.1 401 Unauthorized\r\n\r\n");
              return;
            }

            const guestId = `guest:${nanoid(10)}`;
            (request as any).user = {
              userId: guestId,
              email: "",
              name: "Guest",
              color: collaborationColorForUser(guestId),
              accessLevel: "VIEW",
            };
            (request as any).clientId = clientId;
            (request as any).guestShareToken = shareToken;

            wss.handleUpgrade(request, socket, head, (ws) => {
              wss.emit("connection", ws, request);
            });
            return;
          }

          // 2. Authorization
          const user = await prisma.user.findUnique({
            where: { id: authSession.user.id },
            select: { id: true, email: true, name: true },
          });

          if (!user) {
            rejectUpgrade(socket, "HTTP/1.1 403 Forbidden\r\n\r\n");
            return;
          }

          // Check if user has access to canvas
          const canvas = await prisma.canvas.findUnique({
            where: { id: canvasId },
            include: {
              shares: {
                where: { recipientId: user.id },
                select: { role: true },
              },
            },
          });

          if (
            !canvas ||
            (canvas.userId !== user.id &&
              canvas.shares.length === 0 &&
              !canvas.isPublic)
          ) {
            logger.warn(
              { userId: user.id, canvasId },
              `User denied access to canvas`,
            );
            rejectUpgrade(socket, "HTTP/1.1 403 Forbidden\r\n\r\n");
            return;
          }

          const accessLevel =
            canvas.userId === user.id
              ? "OWNER"
              : canvas.shares[0]?.role || "VIEW";

          // Attach user to request for handleConnection
          (request as any).user = {
            userId: user.id,
            email: user.email,
            name: user.name || undefined,
            color: collaborationColorForUser(user.id),
            accessLevel,
            sessionId: authSession.session.id,
          };
          (request as any).clientId = clientId;

          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
          });
        } catch (error) {
          logger.error({ error }, "WebSocket upgrade error");
          try {
            rejectUpgrade(socket, "HTTP/1.1 500 Internal Server Error\r\n\r\n");
          } catch {
            socket.destroy?.();
          }
        }
      } else {
        return;
      }
    },
  );

  // Handle new WebSocket connections
  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    void handleConnection(ws, request).catch((error) => {
      logger.error({ error }, "WebSocket connection setup failed");
      ws.terminate();
    });
  });

  let authorizationRefreshInFlight: Promise<void> | null = null;

  // Heartbeat, remote lease renewal, and one authorization batch for the
  // entire process. A slow database cannot create one refresh query per client.
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    connections.forEach((clients, canvasId) => {
      clients.forEach((client) => {
        const outcome = heartbeatClient(client);
        if (outcome === "terminated-zombie")
          logger.info(
            { userId: client.user.userId, canvasId },
            "Terminating zombie connection",
          );
        else if (outcome === "terminated-slow")
          logger.info(
            { userId: client.user.userId, canvasId },
            "Terminating slow connection",
          );
      });

      publishPresence(canvasId);
      publishCursors(canvasId);
    });

    admission.sweep(now);
    void admission.renew(allClientConnections());
    sweepRemoteCollaborationState(now);
    closeExpiredAuthorizationLeases(now);

    if (!authorizationRefreshInFlight && admission.totalConnections) {
      authorizationRefreshInFlight = revalidateAllConnections()
        .catch(handleAuthorizationRefreshFailure)
        .finally(() => {
          authorizationRefreshInFlight = null;
        });
    }
  }, HEARTBEAT_INTERVAL);

  const cursorInterval = setInterval(() => {
    for (const canvasId of dirtyCursorCanvases) {
      dirtyCursorCanvases.delete(canvasId);
      broadcastCursors(canvasId);
      publishCursors(canvasId);
    }
  }, CURSOR_TICK_MS);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
    clearInterval(cursorInterval);
  });

  return wss;
}

/**
 * Handle new WebSocket connection
 */
async function handleConnection(
  ws: WebSocket,
  request: IncomingMessage,
): Promise<void> {
  // First, before any await: a malformed frame during admission or the Redis
  // subscription must not surface as an unhandled EventEmitter error. The
  // socket closes; whichever setup step is waiting sees it and releases.
  const logContext: { canvasId?: string } = {};
  ws.on("error", (error) => {
    logger.error({ error, ...logContext }, "WebSocket error");
    if (
      ws.readyState === WebSocket.CONNECTING ||
      ws.readyState === WebSocket.OPEN
    ) {
      ws.terminate();
    }
  });

  const url = parseRequestUrl(request);
  const pathParts = url.pathname.split("/");
  const canvasId = pathParts[pathParts.length - 1];
  logContext.canvasId = canvasId;

  // User is already authenticated and attached to request
  const user = (request as any).user as CollaborationUser & {
    accessLevel?: ClientConnection["accessLevel"];
  };
  const clientId = String((request as any).clientId || "unknown");
  const guestShareToken = (request as any).guestShareToken as
    string | undefined;

  if (!user || !canvasId) {
    incrementOperationalCounter("websocket_rejected_total");
    ws.close(1008, "Internal Error");
    return;
  }

  const admitted = {
    id: nanoid(16),
    canvasId,
    principalId: user.userId,
    clientId,
  };
  const decision = await admission.admit(admitted);
  if (!decision.admitted) {
    incrementOperationalCounter("websocket_rejected_total");
    ws.close(
      1013,
      decision.reason === "canvas"
        ? "Canvas connection limit reached"
        : "Connection admission limit reached",
    );
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    // The client left while the shared limits were checked.
    void admission.release(admitted);
    return;
  }

  const now = Date.now();
  const canvasConnections = connections.get(canvasId);
  const connection: ClientConnection = {
    id: admitted.id,
    ws,
    canvasId,
    user,
    accessLevel: user.accessLevel || "VIEW",
    isAlive: true,
    cursorCount: 0,
    controlCount: 0,
    resetAt: now + RATE_LIMIT_WINDOW,
    authorizationLeaseExpiresAt: now + AUTHORIZATION_LEASE_MS,
    authorizationFailureCount: 0,
    clientId,
    guestShareToken,
  };

  const clients = canvasConnections ?? new Set<ClientConnection>();
  if (!canvasConnections) connections.set(canvasId, clients);
  clients.add(connection);
  setOperationalGauge("websocket_connections", admission.totalConnections);
  setOperationalGauge("websocket_active_canvases", connections.size);

  let subscribed = false;
  let closed = false;
  ws.on("close", () => {
    closed = true;
    const activeClients = connections.get(canvasId);
    if (!activeClients?.delete(connection)) return;

    void admission.release(admitted);
    logger.info(
      { userId: user.userId, canvasId },
      "User disconnected from canvas",
    );
    broadcastPresence(canvasId);
    publishPresence(canvasId);
    publishCursors(canvasId);
    if (activeClients.size === 0) {
      connections.delete(canvasId);
      dirtyCursorCanvases.delete(canvasId);
    }
    setOperationalGauge("websocket_connections", admission.totalConnections);
    setOperationalGauge("websocket_active_canvases", connections.size);
    if (subscribed) void unsubscribeFromCanvas(canvasId);
  });

  try {
    await subscribeToCanvas(canvasId);
    subscribed = true;
  } catch (error) {
    logger.error({ error, canvasId }, "WebSocket Redis subscription failed");
    incrementOperationalCounter("websocket_rejected_total");
    ws.close(1013, "Collaboration service unavailable");
    return;
  }

  if (closed) {
    void unsubscribeFromCanvas(canvasId);
    return;
  }

  logger.info({ userId: user.userId, canvasId }, "User connected to canvas");

  broadcastPresence(canvasId);
  publishPresence(canvasId);

  ws.on("message", async (data: Buffer, isBinary: boolean) => {
    try {
      if (!hasCurrentAuthorizationLease(connection)) return;
      if (isBinary) {
        handleBinaryUpdate(connection);
        return;
      }

      let rawMessage: unknown;
      try {
        rawMessage =
          typeof data === "string"
            ? JSON.parse(data)
            : JSON.parse(data.toString());
      } catch (error) {
        applyRateLimit(connection, "message");
        throw error;
      }
      const rawType =
        rawMessage &&
        typeof rawMessage === "object" &&
        "type" in rawMessage &&
        (rawMessage.type === "cursor" || rawMessage.type === "awareness")
          ? rawMessage.type
          : "message";
      if (!applyRateLimit(connection, rawType)) return;
      const message = collaborationMessageSchema.parse(rawMessage);
      await handleMessage(connection, message);
    } catch (error) {
      logger.error({ error, canvasId }, "Error handling message");
    }
  });

  ws.on("pong", () => {
    connection.isAlive = true;
  });
}

function connectionSnapshot(): ClientConnection[] {
  const snapshot: ClientConnection[] = [];
  for (const clients of connections.values()) snapshot.push(...clients);
  return snapshot;
}

async function revalidateAllConnections(): Promise<void> {
  const clients = connectionSnapshot();
  if (clients.length === 0) return;

  const authenticatedIds = Array.from(
    new Set(
      clients
        .map((client) => client.user.userId)
        .filter((userId) => !userId.startsWith("guest:")),
    ),
  );
  const sessionIds = Array.from(
    new Set(
      clients
        .map((client) => client.user.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  );
  const canvasIds = Array.from(
    new Set(clients.map((client) => client.canvasId)),
  );
  const [canvases, sessions] = await Promise.all([
    prisma.canvas.findMany({
      where: { id: { in: canvasIds } },
      select: {
        id: true,
        userId: true,
        isPublic: true,
        shareToken: true,
        shares: {
          where: { recipientId: { in: authenticatedIds } },
          select: { recipientId: true, role: true },
        },
      },
    }),
    // Revocation deletes Session rows (sign-out, password change or reset,
    // "sign out other sessions"), so a missing or expired row closes the
    // socket at the next refresh.
    prisma.session.findMany({
      where: { id: { in: sessionIds }, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true },
    }),
  ]);

  const liveSessions = new Map(
    sessions.map((session) => [session.id, session.userId]),
  );
  const canvasById = new Map(canvases.map((canvas) => [canvas.id, canvas]));
  const checkedAt = Date.now();
  for (const client of clients) {
    if (!connections.get(client.canvasId)?.has(client)) continue;
    const canvas = canvasById.get(client.canvasId);
    const userId = client.user.userId;
    const role = canvas?.shares.find(
      (share) => share.recipientId === userId,
    )?.role;
    const accessLevel = resolveCollaborationAccess({
      principalId: userId,
      sessionActive:
        client.user.sessionId !== undefined &&
        liveSessions.get(client.user.sessionId) === userId,
      guestShareToken: client.guestShareToken,
      canvas: canvas
        ? {
            userId: canvas.userId,
            isPublic: canvas.isPublic,
            shareToken: canvas.shareToken,
          }
        : null,
      sharedRole: role,
    });
    if (!accessLevel) {
      client.ws.close(1008, "Session or canvas access was revoked");
      continue;
    }
    client.accessLevel = accessLevel;
    client.user.accessLevel = accessLevel;
    renewAuthorizationLease(client, checkedAt);
  }
}

function renewAuthorizationLease(
  connection: ClientConnection,
  checkedAt: number,
): void {
  connection.authorizationFailureCount = 0;
  connection.authorizationLeaseExpiresAt = checkedAt + AUTHORIZATION_LEASE_MS;
}

function handleAuthorizationRefreshFailure(error: unknown): void {
  const now = Date.now();
  logger.error({ error }, "Batched WebSocket authorization refresh failed");
  for (const client of connectionSnapshot()) {
    client.authorizationFailureCount += 1;
    if (
      authorizationLeaseMustClose({
        consecutiveFailures: client.authorizationFailureCount,
        leaseExpiresAt: client.authorizationLeaseExpiresAt,
        now,
      })
    ) {
      client.ws.close(1013, "Authorization lease expired");
    }
  }
}

function closeExpiredAuthorizationLeases(now: number): void {
  for (const client of connectionSnapshot()) {
    if (client.authorizationLeaseExpiresAt <= now) {
      client.ws.close(1013, "Authorization lease expired");
    }
  }
}

function hasCurrentAuthorizationLease(connection: ClientConnection): boolean {
  if (connection.authorizationLeaseExpiresAt > Date.now()) return true;
  connection.ws.close(1013, "Authorization lease expired");
  return false;
}

function sweepRemoteCollaborationState(now: number): void {
  const presenceChanges = remotePresence.sweep(now);
  const cursorChanges = remoteCursors.sweep(now);
  for (const canvasId of new Set([...presenceChanges, ...cursorChanges])) {
    broadcastPresence(canvasId);
    broadcastCursors(canvasId);
  }
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(
  connection: ClientConnection,
  message: z.infer<typeof collaborationMessageSchema>,
): Promise<void> {
  switch (message.type) {
    case "cursor":
      connection.cursorPosition = message.position;
      dirtyCursorCanvases.add(connection.canvasId);
      break;

    case "awareness":
      broadcastPresence(connection.canvasId);
      publishPresence(connection.canvasId);
      break;

    case "message":
      if (!canBroadcastSocial(connection.accessLevel)) {
        connection.ws.close(1008, "Comment access is required");
        return;
      }
      if (
        Buffer.byteLength(JSON.stringify(message.payload), "utf8") >
        MAX_MESSAGE_PAYLOAD_BYTES
      ) {
        connection.ws.close(1009, "Message payload too large");
        return;
      }
      const timestamp = Date.now();
      const payload = {
        ...message.payload,
        userId: connection.user.userId,
        userName: publicDisplayName(connection.user),
        userColor: connection.user.color,
        timestamp,
      };
      broadcastMessagePayload(connection.canvasId, payload);
      publishMessage({
        type: "message",
        canvasId: connection.canvasId,
        instanceId,
        payload,
        timestamp,
      });
      break;
  }
}

function handleBinaryUpdate(connection: ClientConnection): void {
  if (!applyRateLimit(connection, "message")) {
    return;
  }

  // Item mutation through untrusted Yjs documents is intentionally disabled.
  // REST remains the single versioned write authority until actor-attributed,
  // schema-validated collaboration patches are implemented end to end.
  connection.ws.close(1003, "Binary collaboration updates are disabled");
}

function applyRateLimit(
  connection: ClientConnection,
  messageType: z.infer<typeof collaborationMessageSchema>["type"],
): boolean {
  const decision = consumeMessageBudget(connection, messageType, Date.now());
  if (decision === "allow") return true;
  if (decision === "drop") return false;

  logger.warn(
    { userId: connection.user.userId },
    "Control message rate exceeded. Terminating connection.",
  );
  connection.ws.close(1008, "Message rate exceeded");
  return false;
}

/**
 * Broadcast helpers
 */
function broadcastMessagePayload(
  canvasId: string,
  payload: Record<string, unknown>,
): void {
  const clients = connections.get(canvasId);
  if (!clients) return;

  const message = JSON.stringify({
    type: "message",
    payload,
  });
  const droppable = isDroppablePayload(payload);

  clients.forEach((client) => {
    sendToClient(client, message, { droppable });
  });
}

function broadcastRemoteMessage(canvasId: string, payload: unknown): void {
  const clients = connections.get(canvasId);
  if (!clients) return;
  const message = JSON.stringify({ type: "message", payload });
  // Remote social payloads are ephemeral; a restore notice must arrive.
  const droppable = isDroppablePayload(payload);
  clients.forEach((client) => {
    sendToClient(client, message, { droppable });
  });
}
function broadcastCommittedEvent(canvasId: string, event: unknown): void {
  const clients = connections.get(canvasId);
  if (!clients) return;
  const message = JSON.stringify({ type: "committed-event", event });
  clients.forEach((client) => {
    sendToClient(client, message, { droppable: false });
  });
}
function broadcastPresence(canvasId: string): void {
  const clients = connections.get(canvasId);
  if (!clients) return;

  const localUsers = getLocalUsers(clients);
  const localUserIds = new Set(localUsers.map((user) => user.userId));
  const users = [...localUsers, ...getRemoteUsers(canvasId, localUserIds)];

  const message = JSON.stringify({
    type: "presence",
    users,
  });

  clients.forEach((client) => {
    sendToClient(client, message, { droppable: true });
  });
}

function broadcastCursors(canvasId: string): void {
  const clients = connections.get(canvasId);
  if (!clients) return;

  const localUserIds = new Set(
    Array.from(clients).map((client) => client.user.userId),
  );
  const localCursors = getLocalCursors(clients);

  const cursors = [
    ...localCursors,
    ...getRemoteCursors(canvasId, localUserIds),
  ];

  const message = JSON.stringify({
    type: "cursors",
    cursors,
  });

  clients.forEach((client) => {
    sendToClient(client, message, { droppable: true });
  });
}

function* allClientConnections() {
  for (const clients of connections.values())
    for (const client of clients)
      yield {
        id: client.id,
        canvasId: client.canvasId,
        principalId: client.user.userId,
        clientId: client.clientId,
      };
}

export function getConnectionCount(): number {
  return admission.totalConnections;
}

export function getCanvasConnectionCount(canvasId: string): number {
  return connections.get(canvasId)?.size ?? 0;
}

export function getActiveCanvasCount(): number {
  return connections.size;
}
