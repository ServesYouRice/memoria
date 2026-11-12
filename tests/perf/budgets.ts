/**
 * IMP-103 — how a full canvas (2,000 items, the per-canvas limit) must feel
 * in the browser. `docs/operations/resource-budgets.md` lists the same
 * numbers with the measured results; change both together.
 *
 * Frame times are the gaps between animation frames while the action runs.
 * Frames land on 16.7 ms steps: 50 ms (three frames) is where movement
 * visibly stutters; zoom gets four frames (67 ms) because every wheel step
 * rescales and redraws the board.
 */
export const FULL_CANVAS_ITEMS = 2_000;

export const CANVAS_SPEED_BUDGETS = {
  /** From navigation start until the items are drawn and the canvas answers. */
  openMs: 6_000,
  pan: { p95FrameMs: 50, longFrameShare: 0.1 },
  zoom: { p95FrameMs: 67, longFrameShare: 0.1 },
  drag: { p95FrameMs: 50, longFrameShare: 0.1 },
} as const;

/** A frame longer than this counts as a "long frame". */
export const LONG_FRAME_MS = 50;
