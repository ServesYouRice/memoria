"use client";

/**
 * IMP-042 — open the collaborative document of the canvas on screen for as
 * long as the board is mounted.
 *
 * @module features/canvas/hooks/use-canvas-document-session
 */

import { useEffect, useRef, useState } from "react";
import {
  CanvasDocumentSession,
  collaborationSyncUrl,
} from "@/lib/collaboration/sync/client-session";

export function useCanvasDocumentSession(
  canvasId: string,
  options: { enabled?: boolean; onRejectedChange?: () => void } = {},
): CanvasDocumentSession | null {
  const { enabled = true } = options;
  const [session, setSession] = useState<CanvasDocumentSession | null>(null);
  const onRejectedChange = useRef(options.onRejectedChange);
  useEffect(() => {
    onRejectedChange.current = options.onRejectedChange;
  });

  useEffect(() => {
    if (!enabled || !canvasId) return;
    const opened = new CanvasDocumentSession({
      canvasId,
      url: collaborationSyncUrl(window.location),
      onRejectedChange: () => onRejectedChange.current?.(),
    });
    setSession(opened);
    return () => {
      opened.destroy();
      setSession((current) => (current === opened ? null : current));
    };
  }, [canvasId, enabled]);

  return session;
}
