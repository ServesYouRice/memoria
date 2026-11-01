"use client";

/**
 * IMP-042 — open the collaborative document of the canvas on screen for as
 * long as the board is mounted.
 *
 * IMP-045 — the session keeps a device copy for the signed-in user, so it
 * waits until it knows who that is (`useOfflineCacheOwner`). Without a
 * signed-in user (a guest, or a session that has ended) it keeps no copy.
 *
 * @module features/canvas/hooks/use-canvas-document-session
 */

import { useEffect, useRef, useState } from "react";
import {
  CanvasDocumentSession,
  collaborationSyncUrl,
} from "@/lib/collaboration/sync/client-session";
import {
  openCanvasDocumentCache,
  pruneOfflineCache,
  rememberCanvasShell,
} from "@/lib/collaboration/sync/offline-store";
import { useOfflineCacheOwner } from "@/features/canvas/hooks/use-offline-cache-owner";

export function useCanvasDocumentSession(
  canvasId: string,
  options: { enabled?: boolean; onRejectedChange?: () => void } = {},
): CanvasDocumentSession | null {
  const { enabled = true } = options;
  const owner = useOfflineCacheOwner();
  const [session, setSession] = useState<CanvasDocumentSession | null>(null);
  const onRejectedChange = useRef(options.onRejectedChange);
  useEffect(() => {
    onRejectedChange.current = options.onRejectedChange;
  });

  const ownerId = owner?.userId ?? null;
  const ownerKnown = owner !== undefined;
  const ownerConfirmed = owner?.confirmed ?? false;

  useEffect(() => {
    if (!enabled || !canvasId || !ownerKnown) return;
    const opened = new CanvasDocumentSession({
      canvasId,
      url: collaborationSyncUrl(window.location),
      onRejectedChange: () => onRejectedChange.current?.(),
      cache: ownerId ? openCanvasDocumentCache(ownerId, canvasId) : null,
    });
    setSession(opened);
    return () => {
      opened.destroy();
      setSession((current) => (current === opened ? null : current));
    };
  }, [canvasId, enabled, ownerId, ownerKnown]);

  useEffect(() => {
    // Online and signed in: refresh this page's offline shell and keep the
    // number of device copies bounded.
    if (!enabled || !canvasId || !ownerId || !ownerConfirmed) return;
    void rememberCanvasShell(window.location.pathname).catch(() => {});
    void pruneOfflineCache({ keep: canvasId }).catch(() => {});
  }, [canvasId, enabled, ownerConfirmed, ownerId]);

  return session;
}
