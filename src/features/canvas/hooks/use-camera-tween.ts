"use client";

import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import {
  easeOutQuint,
  prefersReducedMotion,
} from "@/features/canvas/lib/canvas-motion";

export interface CameraTarget {
  x: number;
  y: number;
  zoom: number;
  durationMs?: number;
}

interface UseCameraTweenOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  getCurrent: () => { x: number; y: number; zoom: number };
  onCommit: (next: { x: number; y: number; zoom: number }) => void;
  onFrame?: (current: { x: number; y: number; zoom: number }) => void;
}

/**
 * Smooth, interruptible 60fps camera transitions for fit-to-screen, zoom reset,
 * jump-to-item, and collaborator follow mode. Directly drives the Konva Stage
 * during flight so React only re-renders once the camera settles.
 */
export function useCameraTween({
  stageRef,
  getCurrent,
  onCommit,
  onFrame,
}: UseCameraTweenOptions) {
  const rafRef = useRef<number | null>(null);
  const getCurrentRef = useRef(getCurrent);
  const onCommitRef = useRef(onCommit);
  const onFrameRef = useRef(onFrame);
  getCurrentRef.current = getCurrent;
  onCommitRef.current = onCommit;
  onFrameRef.current = onFrame;

  const cancel = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const animateTo = useCallback(
    ({ x, y, zoom, durationMs = 320 }: CameraTarget) => {
      cancel();
      const stage = stageRef.current;
      if (
        !stage ||
        prefersReducedMotion() ||
        durationMs <= 0 ||
        typeof requestAnimationFrame !== "function"
      ) {
        onCommitRef.current({ x, y, zoom });
        return;
      }

      const start = getCurrentRef.current();
      const startTime = performance.now();

      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = easeOutQuint(progress);
        const curX = start.x + (x - start.x) * eased;
        const curY = start.y + (y - start.y) * eased;
        const curZoom = start.zoom + (zoom - start.zoom) * eased;

        stage.position({ x: curX, y: curY });
        stage.scale({ x: curZoom, y: curZoom });
        stage.batchDraw();
        onFrameRef.current?.({ x: curX, y: curY, zoom: curZoom });

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          onCommitRef.current({ x, y, zoom });
        }
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [cancel, stageRef],
  );

  useEffect(() => cancel, [cancel]);

  return { animateTo, cancel };
}
