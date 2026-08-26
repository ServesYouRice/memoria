/**
 * WebSocket Server for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Handles collaboration presence, cursors, chat, and reactions.
 */

import { type IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { decode } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { nanoid } from "nanoid";
import { getRedisClient } from "@/lib/cache/redis-client";
import { z } from "zod";
import {
  AUTHORIZATION_LEASE_MS,
  AUTHORIZATION_REFRESH_INTERVAL_MS,
  CURSOR_TICK_MS,
  ConnectionAdmissionCounters,
  ExpiringCanvasInstances,
  FixedWindowAdmissionBudget,
  authorizationLeaseMustClose,
  collaborationColorForUser,
  consumeMessageBudget,
  resolveCollaborationAccess,
} from "./transport-policy";

export interface CollaborationUser {
  userId: string;
  email: string;
  name?: string;
  color: string;
  accessLevel?: "OWNER" | "EDIT" | "COMMENT" | "VIEW";
  sessionVersion?: number;
}

interface ClientConnection {
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
const REDIS_CHANNEL_PREFIX = "collaboration:canvas:";
const SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
] as const;
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
const upgradeBudgets = new FixedWindowAdmissionBudget(
  MAX_UPGRADES_PER_CLIENT_PER_MINUTE,
  60_000,
);
const admissionCounters = new ConnectionAdmissionCounters();

export function isAllowedCollaborationOrigin(
  origin: string | undefined,
  configuredUrl: string | undefined,
): boolean {
  if (!origin || !configuredUrl) return false;
  try {
    return new URL(origin).origin === new URL(configuredUrl).origin;
  } catch {
    return false;
  }
}

function consumeUpgradeBudget(clientId: string): boolean {
  return upgradeBudgets.consume(clientId);
}

const instanceId = nanoid(8);
const redisPublisher = getRedisClient();
const redisSubscriber = redisPublisher ? redisPublisher.duplicate() : null;

if (redisSubscriber) {
  redisSubscriber.on("message", (channel, message) => {
    void handleRedisMessage(channel, message);
  });

  redisSubscriber.on("error", (error) => {
    logger.error({ error }, "Redis subscriber error");
  });
}

/**
 * Helper to parse cookies from header
 */
function parseCookies(request: IncomingMessage): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = request.headers.cookie;

  if (rc) {
    rc.split(";").forEach((cookie) => {
      const parts = cookie.split("=");
      const name = parts.shift()?.trim();
      const value = decodeURIComponent(parts.join("="));
      if (name) list[name] = value;
    });
  }

  return list;
}

function getChannel(canvasId: string): string {
  return `${REDIS_CHANNEL_PREFIX}${canvasId}`;
}

function getSessionCookie(cookies: Record<string, string>) {
  for (const cookieName of SESSION_COOKIE_NAMES) {
    const value = cookies[cookieName];
    if (value) {
      return { name: cookieName, value };
    }
  }

  return null;
}

async function subscribeToCanvas(canvasId: string): Promise<void> {
  if (!redisSubscriber) return;
  const count = subscriptions.get(canvasId) || 0;
  if (count === 0) {
    await redisSubscriber.subscribe(getChannel(canvasId));
  }
  subscriptions.set(canvasId, count + 1);
}

async function unsubscribeFromCanvas(canvasId: string): Promise<void> {
  if (!redisSubscriber) return;
  const count = subscriptions.get(canvasId) || 0;
  if (count <= 1) {
    await redisSubscriber.unsubscribe(getChannel(canvasId));
    subscriptions.delete(canvasId);
    remotePresence.deleteCanvas(canvasId);
    remoteCursors.deleteCanvas(canvasId);
  } else {
    subscriptions.set(canvasId, count - 1);
  }
}

function publishMessage(message: CollaborationBusMessage): void {
  if (!redisPublisher) return;
  redisPublisher
    .publish(getChannel(message.canvasId), JSON.stringify(message))
    .catch((error) => logger.error({ error }, "Redis publish error"));
}

function getLocalUsers(clients: Set<ClientConnection>): CollaborationUser[] {
  const users = new Map<string, CollaborationUser>();
  for (const client of clients) {
    users.set(client.user.userId, {
      userId: client.user.userId,
      email: client.user.email,
      name: client.user.name,
      color: client.user.color,
      accessLevel: client.user.accessLevel,
    });
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
        users.push(user);
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
  if (!channel.startsWith(REDIS_CHANNEL_PREFIX)) return;

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
      remotePresence.upsert(canvasId, message.instanceId, users, Date.now());
      broadcastPresence(canvasId);
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

/**
 * Initialize WebSocket server
 */
export function createCollaborationServer(server: any): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_PAYLOAD,
  });

  // Handle WebSocket upgrade
  server.on(
    "upgrade",
    async (request: IncomingMessage, socket: any, head: Buffer) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);

      // Only handle collaboration WebSocket connections
      if (url.pathname.startsWith("/api/collaboration/")) {
        try {
          const configuredUrl =
            process.env.AUTH_URL || process.env.NEXTAUTH_URL;
          if (
            !isAllowedCollaborationOrigin(request.headers.origin, configuredUrl)
          ) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
          const clientId = String(
            request.headers["x-memoria-client-ip"] || "unknown",
          );
          if (
            !consumeUpgradeBudget(clientId) ||
            getConnectionCount() >= MAX_CONNECTIONS_GLOBAL
          ) {
            socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
            socket.destroy();
            return;
          }
          const pathParts = url.pathname.split("/");
          const canvasId = pathParts[pathParts.length - 1];

          if (!canvasId) {
            socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
            socket.destroy();
            return;
          }

          // 1. Authentication
          const cookies = parseCookies(request);
          const sessionCookie = getSessionCookie(cookies);

          const publicCanvas = await prisma.canvas.findUnique({
            where: { id: canvasId },
            select: {
              id: true,
              isPublic: true,
              shareToken: true,
            },
          });

          if (!publicCanvas) {
            socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
            socket.destroy();
            return;
          }

          if (!sessionCookie) {
            const shareToken = url.searchParams.get("shareToken");
            if (!isValidGuestShare(publicCanvas, shareToken)) {
              logger.warn("WebSocket connection attempt without token");
              socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
              socket.destroy();
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

          const secret =
            process.env["NEXTAUTH_SECRET"] || process.env["AUTH_SECRET"];
          if (!secret) {
            logger.error(
              "Missing NEXTAUTH_SECRET/AUTH_SECRET for WebSocket auth",
            );
            socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
            socket.destroy();
            return;
          }

          const decoded = await decode({
            token: sessionCookie.value,
            secret,
            salt: sessionCookie.name,
          });

          if (!decoded || !decoded.email) {
            logger.warn("Invalid token for WebSocket connection");
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          // 2. Authorization
          const user = await prisma.user.findUnique({
            where: { email: decoded.email as string },
          });

          if (!user) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
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
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
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
            sessionVersion: user.sessionVersion,
          };
          (request as any).clientId = clientId;

          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
          });
        } catch (error) {
          logger.error({ error }, "WebSocket upgrade error");
          socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
          socket.destroy();
        }
      } else {
        return;
      }
    },
  );

  // Handle new WebSocket connections
  wss.on("connection", async (ws: WebSocket, request: IncomingMessage) => {
    await handleConnection(ws, request);
  });

  let authorizationRefreshInFlight: Promise<void> | null = null;

  // Heartbeat, remote lease renewal, and one authorization batch for the
  // entire process. A slow database cannot create one refresh query per client.
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    connections.forEach((clients, canvasId) => {
      clients.forEach((client) => {
        if (!client.isAlive) {
          logger.info(
            { userId: client.user.userId, canvasId },
            "Terminating zombie connection",
          );
          client.ws.terminate();
          return;
        }
        client.isAlive = false;
        client.ws.ping();
      });

      publishPresence(canvasId);
      publishCursors(canvasId);
    });

    upgradeBudgets.sweep(now);
    sweepRemoteCollaborationState(now);
    closeExpiredAuthorizationLeases(now);

    if (!authorizationRefreshInFlight && admissionCounters.totalConnections) {
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
  const url = new URL(request.url || "", `http://${request.headers.host}`);
  const pathParts = url.pathname.split("/");
  const canvasId = pathParts[pathParts.length - 1];

  // User is already authenticated and attached to request
  const user = (request as any).user as CollaborationUser & {
    accessLevel?: ClientConnection["accessLevel"];
  };
  const clientId = String((request as any).clientId || "unknown");
  const guestShareToken = (request as any).guestShareToken as
    string | undefined;

  if (!user || !canvasId) {
    ws.close(1008, "Internal Error");
    return;
  }

  const canvasConnections = connections.get(canvasId);
  if (
    canvasConnections &&
    canvasConnections.size >= MAX_COLLABORATORS_PER_CANVAS
  ) {
    ws.close(1013, "Canvas connection limit reached");
    return;
  }

  const admission = admissionCounters.tryAdmit(user.userId, clientId, {
    global: MAX_CONNECTIONS_GLOBAL,
    perPrincipal: MAX_CONNECTIONS_PER_PRINCIPAL,
    perClient: MAX_CONNECTIONS_PER_CLIENT,
  });
  if (!admission.admitted) {
    ws.close(1013, "Connection admission limit reached");
    return;
  }

  const now = Date.now();
  const connection: ClientConnection = {
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

  let subscribed = false;
  let closed = false;
  ws.on("close", () => {
    closed = true;
    const activeClients = connections.get(canvasId);
    if (!activeClients?.delete(connection)) return;

    admissionCounters.release(user.userId, clientId);
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
    if (subscribed) void unsubscribeFromCanvas(canvasId);
  });

  try {
    await subscribeToCanvas(canvasId);
    subscribed = true;
  } catch (error) {
    logger.error({ error, canvasId }, "WebSocket Redis subscription failed");
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

  ws.on("error", (error) => {
    logger.error({ error, canvasId }, "WebSocket error");
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
  const canvasIds = Array.from(
    new Set(clients.map((client) => client.canvasId)),
  );
  const [canvases, users] = await Promise.all([
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
    prisma.user.findMany({
      where: { id: { in: authenticatedIds } },
      select: { id: true, sessionVersion: true },
    }),
  ]);

  const versions = new Map(users.map((user) => [user.id, user.sessionVersion]));
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
      expectedSessionVersion: client.user.sessionVersion,
      persistedSessionVersion: versions.get(userId),
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
        userName: connection.user.name || connection.user.email || "Guest",
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

  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

function broadcastRemoteMessage(canvasId: string, payload: unknown): void {
  const clients = connections.get(canvasId);
  if (!clients) return;
  const message = JSON.stringify({ type: "message", payload });
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(message);
  });
}
function broadcastCommittedEvent(canvasId: string, event: unknown): void {
  const clients = connections.get(canvasId);
  if (!clients) return;
  const message = JSON.stringify({ type: "committed-event", event });
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(message);
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
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
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
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

export function getConnectionCount(): number {
  return admissionCounters.totalConnections;
}

export function getActiveCanvasCount(): number {
  return connections.size;
}
