/**
 * IMP-140 — press and hold on a touch screen opens an item's menu.
 *
 * iOS Safari does not send `contextmenu` for a long press on a canvas, so the
 * item layer listens for the hold itself. This is the timing logic only, with
 * no canvas or DOM in it, so it can be tested with fake timers.
 *
 * Rules:
 *  - one finger down starts a timer;
 *  - lifting, a second finger, a cancelled touch, or moving more than
 *    `moveTolerancePx` (that is a drag, or a pinch starting) cancels it;
 *  - when the timer fires, `onHold` runs once with the start position;
 *  - a `contextmenu` event that arrives within `suppressMs` after a hold is
 *    ignored, so Android (which also sends one) never opens a second menu;
 *  - a `contextmenu` that arrives first, while the timer is still pending,
 *    cancels the timer so the hold does not open the menu again.
 */

export const HOLD_DELAY_MS = 500;
export const HOLD_MOVE_TOLERANCE_PX = 10;
export const HOLD_CONTEXT_MENU_SUPPRESS_MS = 700;

export interface HoldPoint {
  x: number;
  y: number;
}

export interface PressAndHoldOptions<T> {
  onHold: (point: HoldPoint, target: T) => void;
  delayMs?: number;
  moveTolerancePx?: number;
  suppressMs?: number;
}

export interface PressAndHold<T> {
  /** A finger went down. Only a single finger starts a hold. */
  start: (point: HoldPoint, target: T, fingers: number) => void;
  /** The finger moved. */
  move: (point: HoldPoint) => void;
  /** A finger was lifted or the touch was cancelled. */
  cancel: () => void;
  /**
   * Call for every `contextmenu` on an item. Returns true when the event is
   * the echo of a hold that already opened the menu and must be ignored.
   */
  shouldIgnoreContextMenu: () => boolean;
  /** True from the moment a hold fired until the finger is lifted. */
  isHeld: () => boolean;
}

export function createPressAndHold<T>({
  onHold,
  delayMs = HOLD_DELAY_MS,
  moveTolerancePx = HOLD_MOVE_TOLERANCE_PX,
  suppressMs = HOLD_CONTEXT_MENU_SUPPRESS_MS,
}: PressAndHoldOptions<T>): PressAndHold<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: HoldPoint | null = null;
  let held = false;
  let suppressUntil = 0;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    start(point, target, fingers) {
      clearTimer();
      held = false;
      origin = null;
      if (fingers !== 1) return;
      origin = point;
      timer = setTimeout(() => {
        timer = null;
        held = true;
        suppressUntil = Date.now() + suppressMs;
        onHold(point, target);
      }, delayMs);
    },
    move(point) {
      if (timer === null || !origin) return;
      if (
        Math.hypot(point.x - origin.x, point.y - origin.y) > moveTolerancePx
      ) {
        clearTimer();
      }
    },
    cancel() {
      clearTimer();
      origin = null;
      held = false;
    },
    shouldIgnoreContextMenu() {
      if (Date.now() < suppressUntil) return true;
      // The browser opened the menu first: the hold must not open it again.
      clearTimer();
      return false;
    },
    isHeld: () => held,
  };
}
