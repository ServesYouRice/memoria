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
  const capabilities = isTimeMachineActive
    ? {
        ...base,
        canMoveItems: false,
        canResizeItems: false,
        canEditItems: false,
        canCreateItems: false,
        canDeleteItems: false,
      }
    : base;
  return { capabilities, canRestore: base.canEditItems };
}
