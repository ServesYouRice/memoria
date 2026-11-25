"use client";

import Konva from "konva";

/**
 * Shared canvas motion helpers. Every helper guards against SSR, mocked Konva
 * nodes in unit tests, and `prefers-reduced-motion: reduce`.
 */

export function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface KonvaTweenOptions {
  duration?: number;
  easing?: (t: number, b: number, c: number, d: number) => number;
  onFinish?: () => void;
  [attr: string]: unknown;
}

/**
 * Safely animates a Konva node's attributes, falling back to an immediate
 * `setAttrs` when reduced motion is enabled or in mocked test environments.
 */
export function tweenKonvaNode(
  node: Konva.Node | null | undefined,
  options: KonvaTweenOptions,
): void {
  if (!node) return;
  const {
    duration = 0.2,
    easing = Konva.Easings.EaseOut,
    onFinish,
    ...attrs
  } = options;
  if (prefersReducedMotion() || typeof node.to !== "function") {
    if (typeof node.setAttrs === "function") node.setAttrs(attrs);
    onFinish?.();
    return;
  }
  try {
    node.to({
      ...attrs,
      duration,
      easing,
      onFinish,
    });
  } catch {
    if (typeof node.setAttrs === "function") node.setAttrs(attrs);
    onFinish?.();
  }
}

/**
 * Subtle tactile pickup/settle feedback while dragging a canvas card.
 */
export function animateDragLift(
  node: Konva.Node | null | undefined,
  lifting: boolean,
  tiltDeg = 0,
): void {
  tweenKonvaNode(node, {
    scaleX: lifting ? 1.02 : 1,
    scaleY: lifting ? 1.02 : 1,
    rotation: lifting ? tiltDeg : 0,
    duration: lifting ? 0.14 : 0.2,
    easing: lifting ? Konva.Easings.EaseOut : Konva.Easings.BackEaseOut,
  });
}

/**
 * Smooth spring-like entrance for a newly spawned canvas item.
 */
export function animateItemSpawn(node: Konva.Node | null | undefined): void {
  if (!node || prefersReducedMotion() || typeof node.to !== "function") return;
  if (typeof node.setAttrs !== "function") return;
  node.setAttrs({ opacity: 0, scaleX: 0.9, scaleY: 0.9 });
  tweenKonvaNode(node, {
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    duration: 0.24,
    easing: Konva.Easings.BackEaseOut,
  });
}

/** Safely updates the Konva stage cursor (tolerates minimal mocks in unit tests). */
export function setStageCursor(
  target: { getStage?: () => Konva.Stage | null } | null | undefined,
  cursor: string,
): void {
  const container = target?.getStage?.()?.container?.();
  if (container) container.style.cursor = cursor;
}

/** Quintic ease-out for silky camera glides (fit-to-screen, jump-to-item). */
export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 5);
}

/**
 * Choreographed item flight when an item's world position changes externally
 * (alignment, distribution, auto-layout, or remote moves).
 */
export function animateItemFlight(
  node: Konva.Node | null | undefined,
  from: { x: number; y: number },
  to: { x: number; y: number },
  duration = 0.26,
): void {
  if (!node) return;
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return;
  if (
    prefersReducedMotion() ||
    typeof node.to !== "function" ||
    typeof node.setAttrs !== "function"
  ) {
    return;
  }
  node.setAttrs({ x: from.x, y: from.y });
  tweenKonvaNode(node, {
    x: to.x,
    y: to.y,
    duration,
    easing: Konva.Easings.EaseOut,
  });
}

/**
 * Returns true if an item was created very recently, used to trigger spawn
 * entrance animations without animating pre-existing items on initial load or pan.
 */
export function isRecentlyCreatedItem(
  createdAt: Date | string | number | null | undefined,
  windowMs = 1500,
): boolean {
  if (!createdAt) return false;
  const timestamp =
    createdAt instanceof Date
      ? createdAt.getTime()
      : typeof createdAt === "number"
        ? createdAt
        : Date.parse(createdAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const age = Date.now() - timestamp;
  return age >= -1000 && age <= windowMs;
}

/**
 * Computes zoom-invariant resize handle dimensions in world units so handles
 * stay visually consistent and comfortably clickable across zoom levels.
 */
export function zoomInvariantHandleMetrics(
  zoom: number,
  baseRadius = 7,
  baseStrokeWidth = 2,
): { radius: number; strokeWidth: number } {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const radius = Math.min(36, Math.max(2, baseRadius / safeZoom));
  const strokeWidth = Math.min(8, Math.max(0.75, baseStrokeWidth / safeZoom));
  return { radius, strokeWidth };
}

export interface PanVelocitySample {
  x: number;
  y: number;
  t: number;
}

/**
 * Computes release velocity (px/ms) from recent Stage pan drag samples.
 * Returns zero velocity if the pointer paused before release.
 */
export function computePanReleaseVelocity(
  samples: readonly PanVelocitySample[],
  now: number,
  maxAgeMs = 90,
  maxSpeed = 2.4,
): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const latest = samples[samples.length - 1];
  if (!latest || now - latest.t > 55) return { vx: 0, vy: 0 };

  let anchor = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i--) {
    const candidate = samples[i]!;
    if (latest.t - candidate.t <= maxAgeMs) {
      anchor = candidate;
    } else {
      break;
    }
  }

  const dt = latest.t - anchor.t;
  if (dt <= 4) return { vx: 0, vy: 0 };

  let vx = (latest.x - anchor.x) / dt;
  let vy = (latest.y - anchor.y) / dt;
  const speed = Math.hypot(vx, vy);
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    vx *= scale;
    vy *= scale;
  }
  return { vx, vy };
}

/**
 * Distinguishes discrete mouse-wheel zoom ticks from continuous trackpad
 * pinch/scroll gestures so trackpad pinch remains immediate while wheel ticks
 * receive smooth micro-damping.
 */
export function isDiscreteWheelEvent(
  evt: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY" | "ctrlKey">,
): boolean {
  if (evt.ctrlKey && evt.deltaMode === 0 && Math.abs(evt.deltaY) < 40) {
    return false;
  }
  if (evt.deltaMode !== 0) return true;
  return (
    evt.deltaX === 0 &&
    Number.isInteger(evt.deltaY) &&
    Math.abs(evt.deltaY) >= 40
  );
}

/** Clamps canvas zoom within the supported [0.1, 5] range. */
export function clampZoom(zoom: number, min = 0.1, max = 5): number {
  return Math.min(max, Math.max(min, zoom));
}
