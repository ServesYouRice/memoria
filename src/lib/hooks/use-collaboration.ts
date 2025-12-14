/**
 * React Hook for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Manages WebSocket connection and Y.js synchronization
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('collaboration');

export interface CollaborationUser {
  userId: string;
  email: string;
  name?: string;
  color: string;
}

export interface CursorPosition {
  userId: string;
  color: string;
  position: { x: number; y: number };
}

export interface UseCollaborationOptions {
  canvasId: string;
  userId: string;
  email: string;
  name?: string;
  enabled?: boolean;
  onMessage?: (message: any) => void;
}

export interface UseCollaborationResult {
  doc: Y.Doc | null;
  users: CollaborationUser[];
  cursors: CursorPosition[];
  connected: boolean;
  updateCursor: (x: number, y: number) => void;
  broadcastMessage: (payload: any) => void;
}

/**
 * Hook for real-time collaboration on a canvas
 */
export function useCollaboration(options: UseCollaborationOptions): UseCollaborationResult {
  const { canvasId, userId, email, name, enabled = true, onMessage } = options;

  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [users, setUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const onMessageRef = useRef(onMessage);

  // Update ref when onMessage changes
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((message: any, yDoc: Y.Doc) => {
    switch (message.type) {
      case 'sync':
        // Apply initial state
        const syncUpdate = new Uint8Array(message.update);
        Y.applyUpdate(yDoc, syncUpdate, 'remote');
        break;

      case 'update':
        // Apply update from other client
        const update = new Uint8Array(message.update);
        Y.applyUpdate(yDoc, update, 'remote');
        break;

      case 'presence':
        // Update user presence
        setUsers(message.users || []);
        break;

      case 'cursors':
        // Update cursor positions
        setCursors(message.cursors || []);
        break;

      case 'message':
        // Handle generic broadcast messages
        if (onMessageRef.current) {
          onMessageRef.current(message.payload);
        }
        break;
    }
  }, []);

  // Connect to WebSocket server
  useEffect(() => {
    if (!enabled || !canvasId) return;

    // Create Y.js document
    const yDoc = new Y.Doc();
    docRef.current = yDoc;
    setDoc(yDoc);

    // Connect to WebSocket server
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/collaboration/${canvasId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      logger.info('Connected to collaboration server');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message, yDoc);
      } catch (error) {
        logger.error({ error }, 'Error handling WebSocket message');
      }
    };

    ws.onerror = (error) => {
      logger.error({ error }, 'WebSocket error');
    };

    ws.onclose = () => {
      logger.info('Disconnected from collaboration server');
      setConnected(false);
    };

    // Listen for local Y.js changes and send to server
    const updateHandler = (update: Uint8Array, origin: any) => {
      // Don't send updates that came from the server
      if (origin !== 'remote' && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'update',
            update: Array.from(update),
          })
        );
      }
    };

    yDoc.on('update', updateHandler);

    // Cleanup
    return () => {
      yDoc.off('update', updateHandler);
      ws.close();
      yDoc.destroy();
    };
  }, [canvasId, userId, email, name, enabled, handleMessage]);

  // Update cursor position
  const updateCursor = useCallback(
    (x: number, y: number) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'cursor',
            position: { x, y },
          })
        );
      }
    },
    []
  );
  // Broadcast message (chat, reaction, etc.)
  const broadcastMessage = useCallback(
    (payload: any) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'message',
            payload,
          })
        );
      }
    },
    []
  );

  return {
    doc,
    users,
    cursors,
    connected,
    updateCursor,
    broadcastMessage,
  };
}
