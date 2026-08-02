/**
 * Touch Gesture Hook for Canvas
 *
 * Provides pinch-to-zoom and pan gesture support for mobile devices.
 * Uses @use-gesture/react for gesture detection.
 *
 * @module lib/hooks/use-canvas-gestures
 *
 * @example
 * ```tsx
 * const { bind, zoom, pan } = useCanvasGestures({
 *   onZoom: (scale) => setZoom(scale),
 *   onPan: (x, y) => setPan({ x, y }),
 * });
 *
 * return <div {...bind()} style={{ transform: ... }} />;
 * ```
 */

import { useGesture } from "@use-gesture/react";
import { useCallback, useRef } from "react";

export interface CanvasGesturesOptions {
  /** Callback when zoom changes */
  onZoom?: (scale: number) => void;
  /** Callback when pan changes */
  onPan?: (x: number, y: number) => void;
  /** Callback when gesture ends */
  onGestureEnd?: () => void;
  /** Minimum zoom level */
  minZoom?: number;
  /** Maximum zoom level */
  maxZoom?: number;
  /** Initial zoom level */
  initialZoom?: number;
  /** Initial pan position */
  initialPan?: { x: number; y: number };
  /** Whether gestures are enabled */
  enabled?: boolean;
}

export interface CanvasGesturesResult {
  /** Bind function to attach to the target element */
  bind: ReturnType<typeof useGesture>;
  /** Current zoom level */
  zoom: number;
  /** Current pan position */
  pan: { x: number; y: number };
}

export function useCanvasGestures({
  onZoom,
  onPan,
  onGestureEnd,
  minZoom = 0.1,
  maxZoom = 5,
  initialZoom = 1,
  initialPan = { x: 0, y: 0 },
  enabled = true,
}: CanvasGesturesOptions = {}) {
  const zoomRef = useRef(initialZoom);
  const panRef = useRef(initialPan);

  const clamp = useCallback(
    (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max),
    [],
  );

  const bind = useGesture(
    {
      // Pinch gesture for zoom
      onPinch: ({ offset: [scale], memo }) => {
        if (!enabled) return memo;

        const newZoom = clamp(scale, minZoom, maxZoom);
        zoomRef.current = newZoom;
        onZoom?.(newZoom);

        return memo;
      },

      onPinchEnd: () => {
        if (!enabled) return;
        onGestureEnd?.();
      },

      // Drag gesture for pan
      onDrag: ({ offset: [x, y], pinching, memo }) => {
        // Don't pan while pinching
        if (!enabled || pinching) return memo;

        panRef.current = { x, y };
        onPan?.(x, y);

        return memo;
      },

      onDragEnd: () => {
        if (!enabled) return;
        onGestureEnd?.();
      },

      // Wheel gesture for zoom (desktop)
      onWheel: ({ delta: [, dy], event, memo }) => {
        if (!enabled) return memo;

        // Prevent default scroll behavior
        event.preventDefault();

        // Calculate new zoom based on scroll direction
        const zoomFactor = dy > 0 ? 0.9 : 1.1;
        const newZoom = clamp(zoomRef.current * zoomFactor, minZoom, maxZoom);
        zoomRef.current = newZoom;
        onZoom?.(newZoom);

        return memo;
      },
    },
    {
      // Configure gesture options
      drag: {
        from: () => [panRef.current.x, panRef.current.y],
        filterTaps: true,
        rubberband: true,
      },
      pinch: {
        scaleBounds: { min: minZoom, max: maxZoom },
        from: () => [zoomRef.current, 0],
        rubberband: true,
      },
      wheel: {
        eventOptions: { passive: false },
      },
    },
  );

  return {
    bind,
    get zoom() {
      return zoomRef.current;
    },
    get pan() {
      return panRef.current;
    },
  };
}
