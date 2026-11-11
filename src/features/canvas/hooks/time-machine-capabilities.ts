import type { CanvasCapabilities } from "@/types/canvas";

/**
 * The capabilities the board hands its surfaces. While the time machine
 * previews a version, the rendered items are snapshot copies that keep the
 * live item ids, so any move, resize, edit, create or delete would write to
 * the live canvas: all of them are off. Restoring the previewed version stays
 * with whoever may edit the live canvas.
 */
export function resolveBoardCapabilities(
  base: CanvasCapabilities,
  isTimeMachineActive: boolean,
): { capabilities: CanvasCapabilities; canRestore: boolean } {
  return {
    capabilities: resolveTimeMachineCapabilities(base, isTimeMachineActive),
    canRestore: base.canEditItems,
  };
}

/**
 * While a historical version is previewed, the board shows snapshot items
 * that carry the live item IDs, so any move, edit or delete would land on the
 * live item. The preview is read-only; "Restore This Version" is the only way
 * to apply history. Copying and commenting are left as they are.
 */
export function resolveTimeMachineCapabilities(
  capabilities: CanvasCapabilities,
  previewActive: boolean,
): CanvasCapabilities {
  if (!previewActive) return capabilities;
  return {
    ...capabilities,
    canMoveItems: false,
    canResizeItems: false,
    canEditItems: false,
    canCreateItems: false,
    canDeleteItems: false,
    canVote: false,
  };
}
