/**
 * The canvas header's save status: what the collaborative document reports
 * (IMP-042), including edits kept on this device while offline (IMP-045),
 * and the words the header shows for each status.
 *
 * @module features/canvas/save-status
 */

import type { AutosaveStatus } from "@/lib/autosave/serialized-delta-queue";
import type { CanvasDocumentSnapshot } from "@/lib/collaboration/sync/client-session";

type DocumentSaveState = Pick<
  CanvasDocumentSnapshot,
  | "ready"
  | "forbidden"
  | "connected"
  | "restored"
  | "localChanges"
  | "pendingChanges"
  | "unsavedChanges"
>;

/**
 * Offline while the document shows edits or the device copy; saving until
 * the server has stored every local edit; saved after that. Nothing before
 * the document renders, or once the canvas fell back to the HTTP API.
 */
export function documentSaveStatus(
  state: DocumentSaveState,
): AutosaveStatus | undefined {
  if (!state.ready || state.forbidden) return undefined;
  const edited = state.localChanges || state.unsavedChanges > 0;
  if (!state.connected && (edited || state.restored)) return "offline/retrying";
  if (!edited) return undefined;
  return state.pendingChanges === 0 && state.unsavedChanges === 0
    ? "saved"
    : "saving";
}

const LABELS = {
  saving: "Saving…",
  saved: "Saved",
  "offline/retrying": "Offline · retrying",
  conflict: "Conflict",
  failed: "Not saved",
} satisfies Record<AutosaveStatus, string>;

const TOOLTIPS = {
  saving: "Changes are being saved",
  saved: "Changes saved",
  "offline/retrying": "Offline; changes will retry",
  conflict: "This change conflicts with a newer server version",
  failed: "Changes were not saved",
} satisfies Record<AutosaveStatus, string>;

export interface SaveStatusDetails {
  /**
   * Set when the offline status comes from the document: the number of
   * edits the server has not stored.
   */
  offlineChanges?: number;
  /**
   * The copy kept on this device could not be written
   * (`CanvasDocumentSnapshot.deviceCopyFailed`): those edits are held only
   * in this tab.
   */
  deviceCopyFailed?: boolean;
}

export function describeSaveStatus(
  status: AutosaveStatus,
  { offlineChanges, deviceCopyFailed = false }: SaveStatusDetails = {},
): { label: string; tooltip: string } {
  if (status !== "offline/retrying" || offlineChanges === undefined)
    return { label: LABELS[status], tooltip: TOOLTIPS[status] };
  if (offlineChanges === 0)
    return {
      label: "Offline",
      tooltip: deviceCopyFailed
        ? "Offline. Changes you make cannot be stored on this device and are held only in this tab until you reconnect."
        : "Offline. Showing the copy kept on this device; changes you make are kept here and sync when you reconnect.",
    };
  const plural = offlineChanges !== 1;
  return {
    label: `Offline · ${offlineChanges} unsaved ${plural ? "changes" : "change"}`,
    tooltip: deviceCopyFailed
      ? `Offline. ${offlineChanges} ${plural ? "changes" : "change"} could not be stored on this device and ${plural ? "are" : "is"} held only in this tab until you reconnect. Keep this tab open.`
      : `Offline. ${offlineChanges} ${plural ? "changes are" : "change is"} kept on this device and will sync when you reconnect.`,
  };
}
