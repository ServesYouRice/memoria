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
