/**
 * WebSocket Server for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Handles Y.js synchronization and presence awareness
 */

import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { getDocument } from './yjs-provider';
import { decode } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface CollaborationUser {
  userId: string;
  email: string;
  name?: string;
  color: string;
}

interface ClientConnection {
  ws: WebSocket;
  canvasId: string;
  user: CollaborationUser;
  cursorPosition?: { x: number; y: number };
  isAlive: boolean;
  messageCount: number;
  rateLimitReset: number;
}

// Heartbeat interval for detecting zombie connections (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
// Rate limit: 60 messages per minute
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW = 60000;

// Active connections per canvas
const connections = new Map<string, Set<ClientConnection>>();

// User colors for cursor rendering
const USER_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#FFA07A', // Orange
  '#98D8C8', // Mint
  '#F7B731', // Yellow
  '#5F27CD', // Purple
  '#00D2D3', // Cyan
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

  rc && rc.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    const value = decodeURIComponent(parts.join('='));
    if (name) list[name] = value;
  });

  return list;
}

/**
 * Initialize WebSocket server
 */
export function createCollaborationServer(server: any): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade
  server.on('upgrade', async (request: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Only handle collaboration WebSocket connections
    if (url.pathname.startsWith('/api/collaboration/')) {
      try {
        const pathParts = url.pathname.split('/');
        const canvasId = pathParts[pathParts.length - 1];

        if (!canvasId) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        // 1. Authentication
        const cookies = parseCookies(request);
        const token = cookies['next-auth.session-token'] || cookies['__Secure-next-auth.session-token'];

        if (!token) {
          logger.warn('WebSocket connection attempt without token');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const decoded = await decode({
          token,
          secret: process.env['AUTH_SECRET']!,
          salt: cookies['__Secure-next-auth.session-token'] ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
        });

        if (!decoded || !decoded.email) {
          logger.warn('Invalid token for WebSocket connection');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // 2. Authorization
        const user = await prisma.user.findUnique({
          where: { email: decoded.email as string },
        });

        if (!user) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }

        // Check if user has access to canvas
        const canvas = await prisma.canvas.findUnique({
          where: { id: canvasId },
          include: {
            shares: {
              where: { email: user.email },
            },
          },
        });

        // Authorization Rule: User must own the canvas OR have an existing share record
        if (!canvas || (canvas.userId !== user.id && canvas.shares.length === 0)) {
          logger.warn({ userId: user.id, canvasId }, `User denied access to canvas`);
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }

        // Attach user to request for handleConnection
        (request as any).user = {
          userId: user.id,
          email: user.email,
          name: user.name || undefined,
          color: getNextUserColor(),
        };

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } catch (error) {
        logger.error({ error }, 'WebSocket upgrade error');
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    }
  });

  // Handle new WebSocket connections
  wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    await handleConnection(ws, request);
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    connections.forEach((clients, canvasId) => {
      clients.forEach((client) => {
        if (!client.isAlive) {
          logger.info({ userId: client.user.userId, canvasId }, 'Terminating zombie connection');
          client.ws.terminate();
          clients.delete(client);
          return;
        }
        client.isAlive = false;
        client.ws.ping();
      });

      if (clients.size === 0) {
        connections.delete(canvasId);
      }
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

/**
 * Handle new WebSocket connection
 */
async function handleConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const pathParts = url.pathname.split('/');
  const canvasId = pathParts[pathParts.length - 1];

  // User is already authenticated and attached to request
  const user = (request as any).user as CollaborationUser;

  if (!user || !canvasId) {
    ws.close(1008, 'Internal Error');
    return;
  }

  const connection: ClientConnection = {
    ws,
    canvasId,
    user,
    isAlive: true,
    messageCount: 0,
    rateLimitReset: Date.now() + RATE_LIMIT_WINDOW,
  };

  if (!connections.has(canvasId)) {
    connections.set(canvasId, new Set());
  }
  connections.get(canvasId)!.add(connection);

  logger.info({ userId: user.userId, canvasId }, 'User connected to canvas');

  const doc = await getDocument(canvasId);

  try {
    const stateVector = Y.encodeStateVector(doc);
    const update = Y.encodeStateAsUpdate(doc, stateVector);

    ws.send(
      JSON.stringify({
        type: 'sync',
        update: Array.from(update),
      })
    );
  } catch (error) {
    logger.error({ error, canvasId }, 'Error sending initial sync');
  }

  broadcastPresence(canvasId);

  ws.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(connection, message, doc);
    } catch (error) {
      logger.error({ error, canvasId }, 'Error handling message');
    }
  });

  ws.on('pong', () => {
    connection.isAlive = true;
  });

  ws.on('close', () => {
    connections.get(canvasId)?.delete(connection);
    if (connections.get(canvasId)?.size === 0) {
      connections.delete(canvasId);
    }
    logger.info({ userId: user.userId, canvasId }, 'User disconnected from canvas');
    broadcastPresence(canvasId);
  });

  ws.on('error', (error) => {
    logger.error({ error, canvasId }, 'WebSocket error');
  });
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(
  connection: ClientConnection,
  message: any,
  doc: Y.Doc
): Promise<void> {
  // Rate Limit Check
  const now = Date.now();
  if (now > connection.rateLimitReset) {
    connection.messageCount = 0;
    connection.rateLimitReset = now + RATE_LIMIT_WINDOW;
  }

  connection.messageCount++;
  if (connection.messageCount > RATE_LIMIT_MAX) {
    logger.warn({ userId: connection.user.userId }, 'Rate limit exceeded. Terminating connection.');
    connection.ws.close(1008, 'Rate limit exceeded');
    return;
  }

  switch (message.type) {
    case 'update':
      const update = new Uint8Array(message.update);
      Y.applyUpdate(doc, update);
      broadcastUpdate(connection.canvasId, update, connection);
      break;

    case 'cursor':
      connection.cursorPosition = message.position;
      broadcastCursors(connection.canvasId);
      break;

    case 'awareness':
      broadcastPresence(connection.canvasId);
      break;

    case 'message':
      broadcastMessagePayload(connection.canvasId, message.payload, connection);
      break;
  }
}

/**
 * Broadcast helpers
 */
function broadcastMessagePayload(canvasId: string, payload: any, sender: ClientConnection): void {
  const clients = connections.get(canvasId);
  if (!clients) return;

  const message = JSON.stringify({
    type: 'message',
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
function broadcastUpdate(canvasId: string, update: Uint8Array, sender: ClientConnection): void {
  const clients = connections.get(canvasId);
  if (!clients) return;

  const message = JSON.stringify({
    type: 'update',
    update: Array.from(update),
  });

  clients.forEach((client) => {
    if (client !== sender && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

function broadcastPresence(canvasId: string): void {
  const clients = connections.get(canvasId);
  if (!clients) return;

  const users = Array.from(clients).map((client) => ({
    userId: client.user.userId,
    email: client.user.email,
    name: client.user.name,
    color: client.user.color,
  }));

  const message = JSON.stringify({
    type: 'presence',
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

  const cursors = Array.from(clients)
    .filter((client) => client.cursorPosition)
    .map((client) => ({
      userId: client.user.userId,
      color: client.user.color,
      position: client.cursorPosition,
    }));

  const message = JSON.stringify({
    type: 'cursors',
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
