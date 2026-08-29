/**
 * React Hook for Real-Time Collaboration
 * Following ADR-0010: Real-Time Collaboration Strategy
 * Manages WebSocket presence, cursors, chat, and reactions.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { createLogger } from "@/lib/logger";
import type { CommittedCanvasItemEvent } from "@/lib/hooks/use-canvas-items";
import {
  CURSOR_TICK_MS,
  collaborationCloseDisposition,
  reconnectDelayMs,
} from "@/lib/collaboration/transport-policy";

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
  onCommittedEvents?: (
    events: CommittedCanvasItemEvent[],
  ) => void | Promise<void>;
  onSnapshotRequired?: () => void;
}

export type CollaborationOutgoingMessage =
  | {
      kind: "cursor_chat";
      message: string;
      position: { x: number; y: number };
    }
  | {
      kind: "reaction";
      emoji: string;
      position: { x: number; y: number };
    };

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
  connectionMessage: string | null;
  updateCursor: (x: number, y: number) => void;
  broadcastMessage: (payload: CollaborationOutgoingMessage) => void;
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
    onCommittedEvents,
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
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );

  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const statusRef = useRef(status);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectStableTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const cursorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorRef = useRef<bigint>(0n);
  const replayInFlightRef = useRef(false);
  const deferredCommittedEventsRef = useRef(
    new Map<string, CommittedCanvasItemEvent>(),
  );
  const pendingCommittedEventsRef = useRef<CommittedCanvasItemEvent[]>([]);
  const committedFlushInFlightRef = useRef(false);
  const committedBatchGenerationRef = useRef(0);
  const committedFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const flushCommittedEventsRef = useRef<(() => void) | null>(null);
  const replayCommittedEventsRef = useRef<
    ((cursor: bigint) => Promise<void>) | null
  >(null);
  const acceptCommittedEventRef = useRef<
    ((event: CommittedCanvasItemEvent) => void) | null
  >(null);
  const onCommittedEventsRef = useRef(onCommittedEvents);
  const onSnapshotRequiredRef = useRef(onSnapshotRequired);

  const MAX_RECONNECT_ATTEMPTS = 8;
  const STABLE_CONNECTION_MS = 30_000;
  const COMMITTED_EVENT_BATCH_MS = 40;

  // Update ref when onMessage changes
  useEffect(() => {
    onMessageRef.current = onMessage;
    onCommittedEventsRef.current = onCommittedEvents;
    onSnapshotRequiredRef.current = onSnapshotRequired;
  }, [onCommittedEvents, onMessage, onSnapshotRequired]);

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

  const flushCommittedEvents = useCallback(() => {
    committedFlushTimeoutRef.current = null;
    if (committedFlushInFlightRef.current) return;
    const events = pendingCommittedEventsRef.current.splice(0);
    if (events.length === 0) return;
    const generation = committedBatchGenerationRef.current;
    committedFlushInFlightRef.current = true;
    void Promise.resolve(onCommittedEventsRef.current?.(events))
      .catch((error) => {
        if (generation !== committedBatchGenerationRef.current) return;
        logger.warn(
          { error, eventCount: events.length },
          "Committed event batch failed; requesting snapshot",
        );
        onSnapshotRequiredRef.current?.();
      })
      .finally(() => {
        if (generation !== committedBatchGenerationRef.current) return;
        committedFlushInFlightRef.current = false;
        if (
          pendingCommittedEventsRef.current.length > 0 &&
          !committedFlushTimeoutRef.current
        ) {
          committedFlushTimeoutRef.current = setTimeout(
            () => flushCommittedEventsRef.current?.(),
            COMMITTED_EVENT_BATCH_MS,
          );
        }
      });
  }, []);

  useEffect(() => {
    flushCommittedEventsRef.current = flushCommittedEvents;
  }, [flushCommittedEvents]);

  const queueCommittedEvent = useCallback((event: CommittedCanvasItemEvent) => {
    pendingCommittedEventsRef.current.push(event);
    if (
      !committedFlushInFlightRef.current &&
      !committedFlushTimeoutRef.current
    ) {
      committedFlushTimeoutRef.current = setTimeout(
        () => flushCommittedEventsRef.current?.(),
        COMMITTED_EVENT_BATCH_MS,
      );
    }
  }, []);

  const acceptCommittedEvent = useCallback(
    (event: CommittedCanvasItemEvent, detectGap = true) => {
      const cursor = BigInt(event.cursor);
      const lastCursor = lastCursorRef.current;
      if (cursor <= lastCursor) return;
      if (detectGap && replayInFlightRef.current) {
        deferredCommittedEventsRef.current.set(event.cursor, event);
        return;
      }
      if (detectGap && lastCursor > 0n && cursor > lastCursor + 1n) {
        deferredCommittedEventsRef.current.set(event.cursor, event);
        void replayCommittedEventsRef.current?.(lastCursor);
        return;
      }
      lastCursorRef.current = cursor;
      queueCommittedEvent(event);
    },
    [queueCommittedEvent],
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
        const deferred = Array.from(
          deferredCommittedEventsRef.current.values(),
        ).sort((left, right) =>
          BigInt(left.cursor) < BigInt(right.cursor) ? -1 : 1,
        );
        deferredCommittedEventsRef.current.clear();
        for (const event of deferred) acceptCommittedEvent(event);
      }
    },
    [acceptCommittedEvent, canvasId],
  );

  useEffect(() => {
    replayCommittedEventsRef.current = replayCommittedEvents;
  }, [replayCommittedEvents]);

  useEffect(() => {
    committedBatchGenerationRef.current += 1;
    lastCursorRef.current = 0n;
    replayInFlightRef.current = false;
    deferredCommittedEventsRef.current.clear();
    pendingCommittedEventsRef.current = [];
    committedFlushInFlightRef.current = false;
    if (committedFlushTimeoutRef.current) {
      clearTimeout(committedFlushTimeoutRef.current);
      committedFlushTimeoutRef.current = null;
    }
  }, [canvasId]);

  // Connect to WebSocket server with reconnect/backoff
  useEffect(() => {
    if (!enabled || !canvasId) {
      shouldReconnectRef.current = false;
      setStatus("idle");
      setConnected(false);
      return;
    }

    shouldReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    setConnectionMessage(null);
    const deferredCommittedEvents = deferredCommittedEventsRef.current;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/collaboration/${canvasId}`;

    const scheduleReconnect = () => {
      if (!shouldReconnectRef.current) return;

      const attempt = reconnectAttemptsRef.current + 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        setStatus("error");
        setConnectionMessage(
          "Live collaboration could not reconnect. Check your connection and refresh to try again.",
        );
        return;
      }

      setStatus("reconnecting");
      reconnectAttemptsRef.current = attempt;
      const delay = reconnectDelayMs(attempt);

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!shouldReconnectRef.current) return;

      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      setStatus(
        reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting",
      );

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (error) {
        logger.error({ error }, "Collaboration upgrade could not start");
        shouldReconnectRef.current = false;
        setStatus("error");
        setConnectionMessage(
          "Live collaboration access could not be established. Refresh after confirming your canvas access.",
        );
        return;
      }
      let opened = false;
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        opened = true;
        logger.info("Connected to collaboration server");
        if (reconnectStableTimeoutRef.current) {
          clearTimeout(reconnectStableTimeoutRef.current);
        }
        reconnectStableTimeoutRef.current = setTimeout(() => {
          reconnectStableTimeoutRef.current = null;
          reconnectAttemptsRef.current = 0;
        }, STABLE_CONNECTION_MS);
        setConnected(true);
        setStatus("connected");
        setConnectionMessage(null);
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

      ws.onclose = (event) => {
        logger.info("Disconnected from collaboration server");
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (reconnectStableTimeoutRef.current) {
          clearTimeout(reconnectStableTimeoutRef.current);
          reconnectStableTimeoutRef.current = null;
        }
        setConnected(false);
        setUsers([]);
        setCursors([]);
        const disposition = collaborationCloseDisposition({
          code: event.code,
          opened,
          intentional: !shouldReconnectRef.current,
        });
        if (disposition === "stop") {
          if (shouldReconnectRef.current) {
            shouldReconnectRef.current = false;
            setStatus("error");
            setConnectionMessage(terminalConnectionMessage(event.code, opened));
          } else {
            setConnectionMessage(null);
            setStatus("disconnected");
          }
        } else {
          scheduleReconnect();
        }
      };
    };

    connect();

    const handleOnline = () => {
      if (
        shouldReconnectRef.current &&
        (statusRef.current === "disconnected" || statusRef.current === "error")
      ) {
        reconnectAttemptsRef.current = 0;
        setConnectionMessage(null);
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
        reconnectTimeoutRef.current = null;
      }
      if (reconnectStableTimeoutRef.current) {
        clearTimeout(reconnectStableTimeoutRef.current);
        reconnectStableTimeoutRef.current = null;
      }
      if (cursorTimeoutRef.current) {
        clearTimeout(cursorTimeoutRef.current);
        cursorTimeoutRef.current = null;
      }
      pendingCursorRef.current = null;
      if (committedFlushTimeoutRef.current) {
        clearTimeout(committedFlushTimeoutRef.current);
        committedFlushTimeoutRef.current = null;
      }
      pendingCommittedEventsRef.current = [];
      committedFlushInFlightRef.current = false;
      committedBatchGenerationRef.current += 1;
      deferredCommittedEvents.clear();
      const activeSocket = wsRef.current;
      wsRef.current = null;
      activeSocket?.close();
      setConnected(false);
      setStatus("disconnected");
      setConnectionMessage(null);
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

  // Coalesce pointer movement to the same cadence as the server cursor tick.
  const updateCursor = useCallback((x: number, y: number) => {
    pendingCursorRef.current = { x, y };
    if (cursorTimeoutRef.current) return;

    cursorTimeoutRef.current = setTimeout(() => {
      cursorTimeoutRef.current = null;
      const position = pendingCursorRef.current;
      pendingCursorRef.current = null;
      if (position && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "cursor", position }));
      }
    }, CURSOR_TICK_MS);
  }, []);

  // Broadcast message (chat, reaction, etc.)
  const broadcastMessage = useCallback(
    (payload: CollaborationOutgoingMessage) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "message",
            payload,
          }),
        );
      }
    },
    [],
  );

  return {
    users,
    cursors,
    connected,
    status,
    connectionMessage,
    updateCursor,
    broadcastMessage,
  };
}

function terminalConnectionMessage(code: number, opened: boolean): string {
  if (!opened) {
    return "Live collaboration access could not be established. Refresh after confirming your canvas access.";
  }
  if (code === 1008) {
    return "Live collaboration access was revoked. Your saved canvas changes remain available.";
  }
  if (code === 1009) {
    return "Live collaboration stopped because a transport limit was exceeded. Refresh to reconnect.";
  }
  if (code === 1003) {
    return "Live collaboration stopped because this client used an unsupported transport message.";
  }
  return "Live collaboration ended. Refresh to reconnect.";
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
