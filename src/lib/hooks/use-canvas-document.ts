"use client";

/**
 * IMP-042 — React access to the collaborative canvas document.
 *
 * `CanvasBoard` opens one `CanvasDocumentSession` per canvas
 * (`useCanvasDocumentSession`) and provides it through
 * `CanvasDocumentContext`; the item mutation hooks, the board's data hook and
 * the note editor read it from here. Without a provider (tests, other pages)
 * everything keeps using the HTTP API. Type-only imports keep Yjs and the
 * sync provider out of bundles that never open a document.
 *
 * @module lib/hooks/use-canvas-document
 */

import { createContext, useContext, useSyncExternalStore } from "react";
import type {
  CanvasDocumentSession,
  CanvasDocumentSnapshot,
} from "@/lib/collaboration/sync/client-session";

export const CanvasDocumentContext =
  createContext<CanvasDocumentSession | null>(null);

const IDLE_SNAPSHOT: CanvasDocumentSnapshot = Object.freeze({
  ready: false,
  writable: false,
  connected: false,
  pendingChanges: 0,
  localChanges: false,
  forbidden: false,
  generation: 0,
  accessRevision: 0,
  items: new Map(),
});

const subscribeNothing = () => () => {};
const readIdleSnapshot = () => IDLE_SNAPSHOT;

/** The open document session, or null when the canvas uses HTTP only. */
export function useCanvasDocument(): CanvasDocumentSession | null {
  return useContext(CanvasDocumentContext);
}

export function useCanvasDocumentSnapshot(
  session: CanvasDocumentSession | null,
): CanvasDocumentSnapshot {
  return useSyncExternalStore(
    session ? session.subscribe : subscribeNothing,
    session ? session.getSnapshot : readIdleSnapshot,
    readIdleSnapshot,
  );
}

/** The board renders from the document once it has synced. */
export function rendersFromDocument(snapshot: CanvasDocumentSnapshot): boolean {
  return snapshot.ready && !snapshot.forbidden;
}
