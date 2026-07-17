/**
 * React Hook for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Manages WebSocket presence, cursors, chat, and reactions.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { createLogger } from "@/lib/logger";

const logger = createLogger("collaboration");

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
  users: CollaborationUser[];
  cursors: CursorPosition[];
  connected: boolean;
  status:
    | "idle"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "error";
  updateCursor: (x: number, y: number) => void;
  broadcastMessage: (payload: any) => void;
}

/**
 * Hook for real-time collaboration on a canvas
 */
export function useCollaboration(
  options: UseCollaborationOptions,
): UseCollaborationResult {
  const { canvasId, userId, email, name, enabled = true, onMessage } = options;

  const [users, setUsers] = useState<CollaborationUser[]>([]);
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<
    | "idle"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "error"
  >("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const statusRef = useRef(status);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(true);

  const BASE_RECONNECT_DELAY_MS = 1000;
  const MAX_RECONNECT_DELAY_MS = 15000;

  // Update ref when onMessage changes
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case "presence":
        // Update user presence
        setUsers(message.users || []);
        break;

      case "cursors":
        // Update cursor positions
        setCursors(message.cursors || []);
        break;

      case "message":
        // Handle generic broadcast messages
        if (onMessageRef.current) {
          onMessageRef.current(message.payload);
        }
        break;
    }
  }, []);

  // Connect to WebSocket server with reconnect/backoff
  useEffect(() => {
    if (!enabled || !canvasId) {
      shouldReconnectRef.current = false;
      setStatus("idle");
      setConnected(false);
      return;
    }

    shouldReconnectRef.current = true;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/collaboration/${canvasId}`;

    const scheduleReconnect = () => {
      if (!shouldReconnectRef.current) return;

      setStatus("reconnecting");
      const attempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = attempt;

      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt - 1),
      );
      const jitter = Math.random() * delay * 0.3;

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay + jitter);
    };

    const connect = () => {
      if (!shouldReconnectRef.current) return;

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        return;
      }

      setStatus(
        reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting",
      );

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        logger.info("Connected to collaboration server");
        reconnectAttemptsRef.current = 0;
        setConnected(true);
        setStatus("connected");
      };

      ws.onmessage = async (event) => {
        try {
          if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
            logger.warn("Ignored unsupported binary collaboration message");
            return;
          }

          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          logger.error({ error }, "Error handling WebSocket message");
        }
      };

      ws.onerror = (error) => {
        logger.error({ error }, "WebSocket error");
        setStatus("error");
      };

      ws.onclose = () => {
        logger.info("Disconnected from collaboration server");
        setConnected(false);
        setUsers([]);
        setCursors([]);
        if (shouldReconnectRef.current) {
          scheduleReconnect();
        } else {
          setStatus("disconnected");
        }
      };
    };

    connect();

    const handleOnline = () => {
      if (
        statusRef.current === "disconnected" ||
        statusRef.current === "error"
      ) {
        reconnectAttemptsRef.current = 0;
        connect();
      }
    };

    window.addEventListener("online", handleOnline);

    // Cleanup
    return () => {
      window.removeEventListener("online", handleOnline);
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setStatus("disconnected");
      setUsers([]);
      setCursors([]);
    };
  }, [canvasId, userId, email, name, enabled, handleMessage]);

  // Update cursor position
  const updateCursor = useCallback((x: number, y: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "cursor",
          position: { x, y },
        }),
      );
    }
  }, []);
  // Broadcast message (chat, reaction, etc.)
  const broadcastMessage = useCallback((payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "message",
          payload,
        }),
      );
    }
  }, []);

  return {
    users,
    cursors,
    connected,
    status,
    updateCursor,
    broadcastMessage,
  };
}
