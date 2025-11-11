/**
 * WebSocket Server for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Handles Y.js synchronization and presence awareness
 */

import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { getDocument } from './yjs-provider';

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
}

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
  return color;
}

/**
 * Initialize WebSocket server
 */
export function createCollaborationServer(server: any): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade
  server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Only handle collaboration WebSocket connections
    if (url.pathname.startsWith('/api/collaboration/')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // Handle new WebSocket connections
  wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    await handleConnection(ws, request);
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

  if (!canvasId) {
    ws.close(1008, 'Canvas ID required');
    return;
  }

  // Extract user info from query params (in production, validate session)
  const userId = url.searchParams.get('userId') || 'anonymous';
  const email = url.searchParams.get('email') || 'anonymous@example.com';
  const name = url.searchParams.get('name') || undefined;

  const user: CollaborationUser = {
    userId,
    email,
    name,
    color: getNextUserColor(),
  };

  const connection: ClientConnection = {
    ws,
    canvasId,
    user,
  };

  // Add connection to canvas group
  if (!connections.has(canvasId)) {
    connections.set(canvasId, new Set());
  }
  connections.get(canvasId)!.add(connection);

  console.log(`User ${user.email} connected to canvas ${canvasId}`);

  // Get Y.js document for this canvas
  const doc = await getDocument(canvasId);

  // Send initial document state
  const stateVector = Y.encodeStateVector(doc);
  const update = Y.encodeStateAsUpdate(doc, stateVector);

  ws.send(
    JSON.stringify({
      type: 'sync',
      update: Array.from(update),
    })
  );

  // Send current presence (who's online)
  broadcastPresence(canvasId);

  // Handle incoming messages
  ws.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(connection, message, doc);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    connections.get(canvasId)?.delete(connection);
    if (connections.get(canvasId)?.size === 0) {
      connections.delete(canvasId);
    }
    console.log(`User ${user.email} disconnected from canvas ${canvasId}`);

    // Broadcast updated presence
    broadcastPresence(canvasId);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
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
  switch (message.type) {
    case 'update':
      // Apply Y.js update
      const update = new Uint8Array(message.update);
      Y.applyUpdate(doc, update);

      // Broadcast to other clients
      broadcastUpdate(connection.canvasId, update, connection);
      break;

    case 'cursor':
      // Update cursor position
      connection.cursorPosition = message.position;
      broadcastCursors(connection.canvasId);
      break;

    case 'awareness':
      // Update user awareness state
      broadcastPresence(connection.canvasId);
      break;
  }
}

/**
 * Broadcast Y.js update to all clients except sender
 */
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

/**
 * Broadcast presence information (who's online)
 */
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

/**
 * Broadcast cursor positions
 */
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

/**
 * Get connection count for monitoring
 */
export function getConnectionCount(): number {
  let count = 0;
  connections.forEach((clients) => {
    count += clients.size;
  });
  return count;
}

/**
 * Get active canvas count for monitoring
 */
export function getActiveCanvasCount(): number {
  return connections.size;
}
