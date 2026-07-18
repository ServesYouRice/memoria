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
  messageCount: number;
  rateLimitReset: number;
  lastAuthorizationCheck: number;
}

// Heartbeat interval for detecting zombie connections (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
// Rate limit: 6000 messages per minute (supports frequent cursor + Yjs updates)
const RATE_LIMIT_MAX = 600;
const RATE_LIMIT_WINDOW = 60000;
const MAX_WEBSOCKET_PAYLOAD = 64 * 1024;
const MAX_COLLABORATORS_PER_CANVAS = 100;
const MAX_MESSAGE_PAYLOAD_BYTES = 8 * 1024;
const AUTHORIZATION_LEASE_MS = 30_000;
const REDIS_CHANNEL_PREFIX = "collaboration:canvas:";
const SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
] as const;

interface CursorPosition {
  userId: string;
  color: string;
  position: { x: number; y: number };
}

interface CollaborationBusMessage {
  type: "presence" | "cursors";
  canvasId: string;
  instanceId: string;
  payload: any;
  timestamp: number;
}

const collaborationMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cursor"),
    position: z.object({
      x: z.number().finite().min(-10_000_000).max(10_000_000),
      y: z.number().finite().min(-10_000_000).max(10_000_000),
    }),
  }),
  z.object({ type: z.literal("awareness") }),
  z.object({ type: z.literal("message"), payload: z.record(z.unknown()) }),
]);

// Active connections per canvas
const connections = new Map<string, Set<ClientConnection>>();
const subscriptions = new Map<string, number>();
const remotePresence = new Map<string, Map<string, CollaborationUser[]>>();
const remoteCursors = new Map<string, Map<string, CursorPosition[]>>();

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

// User colors for cursor rendering
const USER_COLORS = [
  "#FF6B6B", // Red
  "#4ECDC4", // Teal
  "#45B7D1", // Blue
  "#FFA07A", // Orange
  "#98D8C8", // Mint
  "#F7B731", // Yellow
  "#5F27CD", // Purple
  "#00D2D3", // Cyan
];

let colorIndex = 0;

/**
 * Get next user color in rotation
 */
function getNextUserColor(): string {
  const color = USER_COLORS[colorIndex];
  colorIndex = (colorIndex + 1) % USER_COLORS.length;
  return color || USER_COLORS[0];
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
    remotePresence.delete(canvasId);
    remoteCursors.delete(canvasId);
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

function publishPresence(canvasId: string): void {
  const clients = connections.get(canvasId);
  if (!clients || !redisPublisher) return;

  const users = Array.from(clients).map((client) => ({
    userId: client.user.userId,
    name: client.user.name,
    color: client.user.color,
    accessLevel: client.user.accessLevel,
  }));

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

  const cursors = Array.from(clients)
    .filter((client) => client.cursorPosition)
    .map((client) => ({
      userId: client.user.userId,
      color: client.user.color,
      position: client.cursorPosition!,
    }));

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
  const presence = remotePresence.get(canvasId);
  if (!presence) return [];

  const users: CollaborationUser[] = [];
  const seen = new Set(localUserIds);

  presence.forEach((remoteUsers) => {
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
  const cursorsByInstance = remoteCursors.get(canvasId);
  if (!cursorsByInstance) return [];

  const cursors: CursorPosition[] = [];
  const seen = new Set(localUserIds);

  cursorsByInstance.forEach((instanceCursors) => {
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
      const users = Array.isArray(message.payload?.users)
        ? message.payload.users
        : [];
      if (!remotePresence.has(canvasId)) {
        remotePresence.set(canvasId, new Map());
      }
      remotePresence.get(canvasId)!.set(message.instanceId, users);
      broadcastPresence(canvasId);
      break;
    }
    case "cursors": {
      const cursors = Array.isArray(message.payload?.cursors)
        ? message.payload.cursors
        : [];
      if (!remoteCursors.has(canvasId)) {
        remoteCursors.set(canvasId, new Map());
      }
      remoteCursors.get(canvasId)!.set(message.instanceId, cursors);
      broadcastCursors(canvasId);
      break;
    }
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
            },
          });

          if (!publicCanvas) {
            socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
            socket.destroy();
            return;
          }

          if (!sessionCookie) {
            if (!publicCanvas.isPublic) {
              logger.warn("WebSocket connection attempt without token");
              socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
              socket.destroy();
              return;
            }

            (request as any).user = {
              userId: `guest:${nanoid(10)}`,
              email: "",
              name: "Guest",
              color: getNextUserColor(),
              accessLevel: "VIEW",
            };

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
                where: { email: user.email.toLowerCase() },
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
            color: getNextUserColor(),
            accessLevel,
            sessionVersion: user.sessionVersion,
          };

          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
          });
        } catch (error) {
          logger.error({ error }, "WebSocket upgrade error");
          socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
          socket.destroy();
        }
      } else {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
      }
    },
  );

  // Handle new WebSocket connections
  wss.on("connection", async (ws: WebSocket, request: IncomingMessage) => {
    await handleConnection(ws, request);
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    connections.forEach((clients, canvasId) => {
      clients.forEach((client) => {
        if (!client.isAlive) {
          logger.info(
            { userId: client.user.userId, canvasId },
            "Terminating zombie connection",
          );
          client.ws.terminate();
          clients.delete(client);
          return;
        }
        // Re-check authorization even when a client is idle. Share revocation,
        // role changes, public-link removal, and session invalidation must not
        // depend on the client sending another application message.
        void revalidateConnectionAccess(client, true).catch((error) => {
          logger.error(
            { error, userId: client.user.userId, canvasId },
            "WebSocket authorization refresh failed",
          );
          client.ws.close(1011, "Authorization refresh failed");
        });
        client.isAlive = false;
        client.ws.ping();
      });

      if (clients.size === 0) {
        connections.delete(canvasId);
      }
    });
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
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

  if (!user || !canvasId) {
    ws.close(1008, "Internal Error");
    return;
  }

  const connection: ClientConnection = {
    ws,
    canvasId,
    user,
    accessLevel: user.accessLevel || "VIEW",
    isAlive: true,
    messageCount: 0,
    rateLimitReset: Date.now() + RATE_LIMIT_WINDOW,
    lastAuthorizationCheck: Date.now(),
  };

  if (!connections.has(canvasId)) {
    connections.set(canvasId, new Set());
  }
  if (connections.get(canvasId)!.size >= MAX_COLLABORATORS_PER_CANVAS) {
    ws.close(1013, "Canvas connection limit reached");
    return;
  }
  connections.get(canvasId)!.add(connection);
  await subscribeToCanvas(canvasId);

  logger.info({ userId: user.userId, canvasId }, "User connected to canvas");

  broadcastPresence(canvasId);
  publishPresence(canvasId);

  ws.on("message", async (data: Buffer, isBinary: boolean) => {
    try {
      if (isBinary) {
        handleBinaryUpdate(connection);
        return;
      }

      const rawMessage =
        typeof data === "string"
          ? JSON.parse(data)
          : JSON.parse(data.toString());
      const message = collaborationMessageSchema.parse(rawMessage);
      if (!(await revalidateConnectionAccess(connection))) return;
      await handleMessage(connection, message);
    } catch (error) {
      logger.error({ error, canvasId }, "Error handling message");
    }
  });

  ws.on("pong", () => {
    connection.isAlive = true;
  });

  ws.on("close", () => {
    connections.get(canvasId)?.delete(connection);
    if (connections.get(canvasId)?.size === 0) {
      connections.delete(canvasId);
    }
    logger.info(
      { userId: user.userId, canvasId },
      "User disconnected from canvas",
    );
    broadcastPresence(canvasId);
    publishPresence(canvasId);
    void unsubscribeFromCanvas(canvasId);
  });

  ws.on("error", (error) => {
    logger.error({ error, canvasId }, "WebSocket error");
  });
}

async function revalidateConnectionAccess(
  connection: ClientConnection,
  force = false,
): Promise<boolean> {
  if (
    !force &&
    Date.now() - connection.lastAuthorizationCheck < AUTHORIZATION_LEASE_MS
  ) {
    return true;
  }

  connection.lastAuthorizationCheck = Date.now();
  const isGuest = connection.user.userId.startsWith("guest:");
  const [canvas, user] = await Promise.all([
    prisma.canvas.findUnique({
      where: { id: connection.canvasId },
      select: {
        userId: true,
        isPublic: true,
        shares: isGuest
          ? false
          : {
              where: { email: connection.user.email.toLowerCase() },
              select: { role: true },
            },
      },
    }),
    isGuest
      ? Promise.resolve(null)
      : prisma.user.findUnique({
          where: { id: connection.user.userId },
          select: { sessionVersion: true },
        }),
  ]);

  if (!canvas || (isGuest && !canvas.isPublic)) {
    connection.ws.close(1008, "Canvas access was revoked");
    return false;
  }

  if (!isGuest) {
    const share = Array.isArray(canvas.shares) ? canvas.shares[0] : undefined;
    const accessLevel =
      canvas.userId === connection.user.userId
        ? "OWNER"
        : share?.role || (canvas.isPublic ? "VIEW" : null);
    if (
      !user ||
      user.sessionVersion !== connection.user.sessionVersion ||
      !accessLevel
    ) {
      connection.ws.close(1008, "Session or canvas access was revoked");
      return false;
    }
    connection.accessLevel = accessLevel;
    connection.user.accessLevel = accessLevel;
  }

  return true;
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(
  connection: ClientConnection,
  message: z.infer<typeof collaborationMessageSchema>,
): Promise<void> {
  if (!applyRateLimit(connection)) {
    return;
  }

  switch (message.type) {
    case "cursor":
      connection.cursorPosition = message.position;
      broadcastCursors(connection.canvasId);
      publishCursors(connection.canvasId);
      break;

    case "awareness":
      broadcastPresence(connection.canvasId);
      publishPresence(connection.canvasId);
      break;

    case "message":
      if (
        Buffer.byteLength(JSON.stringify(message.payload), "utf8") >
        MAX_MESSAGE_PAYLOAD_BYTES
      ) {
        connection.ws.close(1009, "Message payload too large");
        return;
      }
      broadcastMessagePayload(connection.canvasId, message.payload, connection);
      break;
  }
}

function handleBinaryUpdate(connection: ClientConnection): void {
  if (!applyRateLimit(connection)) {
    return;
  }

  // Item mutation through untrusted Yjs documents is intentionally disabled.
  // REST remains the single versioned write authority until actor-attributed,
  // schema-validated collaboration patches are implemented end to end.
  connection.ws.close(1003, "Binary collaboration updates are disabled");
}

function applyRateLimit(connection: ClientConnection): boolean {
  const now = Date.now();
  if (now > connection.rateLimitReset) {
    connection.messageCount = 0;
    connection.rateLimitReset = now + RATE_LIMIT_WINDOW;
  }

  connection.messageCount++;
  if (connection.messageCount > RATE_LIMIT_MAX) {
    logger.warn(
      { userId: connection.user.userId },
      "Rate limit exceeded. Terminating connection.",
    );
    connection.ws.close(1008, "Rate limit exceeded");
    return false;
  }

  return true;
}

/**
 * Broadcast helpers
 */
function broadcastMessagePayload(
  canvasId: string,
  payload: any,
  sender: ClientConnection,
): void {
  const clients = connections.get(canvasId);
  if (!clients) return;

  const message = JSON.stringify({
    type: "message",
    payload: {
      ...payload,
      userId: sender.user.userId,
      timestamp: Date.now(),
    },
  });

  clients.forEach((client) => {
    // Send to everyone including sender? Usually chat is optimistic, but reactions might be good to bounce back or filter at client.
    // Let's send to everyone so they see their own reaction if not optimistic.
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}
function broadcastPresence(canvasId: string): void {
  const clients = connections.get(canvasId);
  if (!clients) return;

  const localUsers = Array.from(clients).map((client) => ({
    userId: client.user.userId,
    name: client.user.name,
    color: client.user.color,
    accessLevel: client.user.accessLevel,
  }));
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
  const localCursors = Array.from(clients)
    .filter((client) => client.cursorPosition)
    .map((client) => ({
      userId: client.user.userId,
      color: client.user.color,
      position: client.cursorPosition,
    }));

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
  let count = 0;
  connections.forEach((clients) => {
    count += clients.size;
  });
  return count;
}

export function getActiveCanvasCount(): number {
  return connections.size;
}
