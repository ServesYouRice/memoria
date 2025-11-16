/**
 * React Hook for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Manages WebSocket connection and Y.js synchronization
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';

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
}

export interface UseCollaborationResult {
  doc: Y.Doc | null;
  users: CollaborationUser[];
  cursors: CursorPosition[];
  connected: boolean;
  updateCursor: (x: number, y: number) => void;
}

/**
 * Hook for real-time collaboration on a canvas
 */
export function useCollaboration(options: UseCollaborationOptions): UseCollaborationResult {
  const { canvasId, userId, email, name, enabled = true } = options;

  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [users, setUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  // Connect to WebSocket server
  useEffect(() => {
    if (!enabled || !canvasId) return;

    // Create Y.js document
    const yDoc = new Y.Doc();
    docRef.current = yDoc;
    setDoc(yDoc);

    // Connect to WebSocket server
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/collaboration/${canvasId}?userId=${userId}&email=${encodeURIComponent(email)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to collaboration server');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message, yDoc);
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Disconnected from collaboration server');
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
  }, [canvasId, userId, email, name, enabled]);

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
    }
  }, []);

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

  return {
    doc,
    users,
    cursors,
    connected,
    updateCursor,
  };
}
