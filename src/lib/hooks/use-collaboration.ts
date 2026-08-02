/**
 * React Hook for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Manages WebSocket presence, cursors, chat, and reactions.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { createLogger } from "@/lib/logger";
import type { CommittedCanvasItemEvent } from "@/lib/hooks/use-canvas-items";

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
  onCommittedEvent?: (event: CommittedCanvasItemEvent) => void | Promise<void>;
  onSnapshotRequired?: () => void;
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
  const {
    canvasId,
    userId,
    email,
    name,
    enabled = true,
    onMessage,
    onCommittedEvent,
    onSnapshotRequired,
  } = options;

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
  const lastCursorRef = useRef<bigint>(0n);
  const replayInFlightRef = useRef(false);
  const replayCommittedEventsRef = useRef<
    ((cursor: bigint) => Promise<void>) | null
  >(null);
  const acceptCommittedEventRef = useRef<
    ((event: CommittedCanvasItemEvent) => void) | null
  >(null);
  const onCommittedEventRef = useRef(onCommittedEvent);
  const onSnapshotRequiredRef = useRef(onSnapshotRequired);

  const BASE_RECONNECT_DELAY_MS = 1000;
  const MAX_RECONNECT_DELAY_MS = 15000;

  // Update ref when onMessage changes
  useEffect(() => {
    onMessageRef.current = onMessage;
    onCommittedEventRef.current = onCommittedEvent;
    onSnapshotRequiredRef.current = onSnapshotRequired;
  }, [onCommittedEvent, onMessage, onSnapshotRequired]);

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

      case "committed-event":
      case "event": {
        const event = message.event ?? message.payload;
        if (isCommittedCanvasItemEvent(event)) {
          acceptCommittedEventRef.current?.(event);
        }
        break;
      }
    }
  }, []);

  const acceptCommittedEvent = useCallback(
    (event: CommittedCanvasItemEvent, detectGap = true) => {
      const cursor = BigInt(event.cursor);
      const lastCursor = lastCursorRef.current;
      if (cursor <= lastCursor) return;
      if (detectGap && lastCursor > 0n && cursor > lastCursor + 1n) {
        void replayCommittedEventsRef.current?.(lastCursor);
      }
      lastCursorRef.current = cursor;
      void onCommittedEventRef.current?.(event);
    },
    [],
  );

  useEffect(() => {
    acceptCommittedEventRef.current = acceptCommittedEvent;
  }, [acceptCommittedEvent]);

  const replayCommittedEvents = useCallback(
    async (cursor: bigint) => {
      if (replayInFlightRef.current) return;
      replayInFlightRef.current = true;
      try {
        let nextCursor = cursor;
        for (let page = 0; page < 10; page += 1) {
          const response = await fetch(
            `/api/v1/canvases/${encodeURIComponent(canvasId)}/events?cursor=${nextCursor.toString()}&limit=200`,
          );
          if (!response.ok) throw new Error("Committed event replay failed");
          const payload = (await response.json()) as {
            events?: unknown[];
            nextCursor?: string;
            hasMore?: boolean;
            snapshotRequired?: boolean;
          };
          if (payload.snapshotRequired) {
            onSnapshotRequiredRef.current?.();
            return;
          }
          for (const event of payload.events || []) {
            if (isCommittedCanvasItemEvent(event)) {
              acceptCommittedEvent(event, false);
            }
          }
          const pageCursor = payload.nextCursor
            ? BigInt(payload.nextCursor)
            : nextCursor;
          nextCursor = pageCursor > nextCursor ? pageCursor : nextCursor;
          if (!payload.hasMore) return;
        }
        onSnapshotRequiredRef.current?.();
      } catch (error) {
        logger.warn(
          { error },
          "Committed event replay failed; requesting snapshot",
        );
        onSnapshotRequiredRef.current?.();
      } finally {
        replayInFlightRef.current = false;
      }
    },
    [acceptCommittedEvent, canvasId],
  );

  useEffect(() => {
    replayCommittedEventsRef.current = replayCommittedEvents;
  }, [replayCommittedEvents]);

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
        void replayCommittedEvents(lastCursorRef.current);
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
  }, [
    canvasId,
    userId,
    email,
    name,
    enabled,
    handleMessage,
    replayCommittedEvents,
  ]);

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

function isCommittedCanvasItemEvent(
  value: unknown,
): value is CommittedCanvasItemEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const entity = event.entity;
  if (!entity || typeof entity !== "object") return false;
  const entityRecord = entity as Record<string, unknown>;
  return (
    event.schemaVersion === 1 &&
    typeof event.cursor === "string" &&
    /^\d+$/.test(event.cursor) &&
    ["created", "updated", "deleted"].includes(String(event.operation)) &&
    entityRecord.type === "canvas-item" &&
    typeof entityRecord.id === "string" &&
    typeof entityRecord.version === "number" &&
    Number.isInteger(entityRecord.version) &&
    entityRecord.version > 0
  );
}
