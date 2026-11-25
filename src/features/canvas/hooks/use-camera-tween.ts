"use client";

import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import {
  clampZoom,
  easeOutQuint,
  prefersReducedMotion,
} from "@/features/canvas/lib/canvas-motion";

export interface CameraTarget {
  x: number;
  y: number;
  zoom: number;
  durationMs?: number;
}

export interface PanGlideTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface WheelZoomTarget {
  factor: number;
  pointerX: number;
  pointerY: number;
  durationMs?: number;
}

const PAN_GLIDE_MIN_SPEED = 0.12; // px/ms
const PAN_GLIDE_STOP_SPEED = 0.03; // px/ms
const PAN_GLIDE_FRICTION = 0.009; // per ms (~350ms settle)

interface UseCameraTweenOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  getCurrent: () => { x: number; y: number; zoom: number };
  onCommit: (next: { x: number; y: number; zoom: number }) => void;
  onFrame?: (current: { x: number; y: number; zoom: number }) => void;
}

/**
 * Smooth, interruptible 60fps camera transitions for fit-to-screen, zoom reset,
 * jump-to-item, collaborator follow mode, inertial pan glides, and micro-damped
 * mouse-wheel zoom ticks. Directly drives the Konva Stage during flight so
 * React only re-renders once the camera settles.
 */
export function useCameraTween({
  stageRef,
  getCurrent,
  onCommit,
  onFrame,
}: UseCameraTweenOptions) {
  const rafRef = useRef<number | null>(null);
  const activeModeRef = useRef<"tween" | "pan-glide" | "wheel-zoom" | null>(
    null,
  );
  const wheelTargetZoomRef = useRef<number | null>(null);
  const getCurrentRef = useRef(getCurrent);
  const onCommitRef = useRef(onCommit);
  const onFrameRef = useRef(onFrame);
  getCurrentRef.current = getCurrent;
  onCommitRef.current = onCommit;
  onFrameRef.current = onFrame;

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cancel = useCallback(
    (commitLiveState = false) => {
      const wasActive = activeModeRef.current !== null;
      stopRaf();
      activeModeRef.current = null;
      wheelTargetZoomRef.current = null;
      if (commitLiveState && wasActive && stageRef.current) {
        const stage = stageRef.current;
        const fallback = getCurrentRef.current();
        const liveZoom =
          typeof stage.scaleX === "function" && stage.scaleX() > 0
            ? stage.scaleX()
            : fallback.zoom;
        onCommitRef.current({
          x: typeof stage.x === "function" ? stage.x() : fallback.x,
          y: typeof stage.y === "function" ? stage.y() : fallback.y,
          zoom: liveZoom,
        });
      }
    },
    [stageRef, stopRaf],
  );

  const animateTo = useCallback(
    ({ x, y, zoom, durationMs = 320 }: CameraTarget) => {
      cancel(false);
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
      activeModeRef.current = "tween";

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
          activeModeRef.current = null;
          onCommitRef.current({ x, y, zoom });
        }
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [cancel, stageRef],
  );

  const glidePan = useCallback(
    ({ x, y, vx, vy }: PanGlideTarget) => {
      cancel(false);
      const stage = stageRef.current;
      const currentZoom = getCurrentRef.current().zoom;
      if (
        !stage ||
        prefersReducedMotion() ||
        typeof requestAnimationFrame !== "function" ||
        Math.hypot(vx, vy) < PAN_GLIDE_MIN_SPEED
      ) {
        onCommitRef.current({ x, y, zoom: currentZoom });
        return;
      }

      let curX = x;
      let curY = y;
      let curVx = vx;
      let curVy = vy;
      let lastTime = performance.now();
      activeModeRef.current = "pan-glide";

      const step = (now: number) => {
        const dt = Math.min(40, Math.max(1, now - lastTime));
        lastTime = now;
        curX += curVx * dt;
        curY += curVy * dt;
        const decay = Math.exp(-PAN_GLIDE_FRICTION * dt);
        curVx *= decay;
        curVy *= decay;

        stage.position({ x: curX, y: curY });
        stage.batchDraw();
        onFrameRef.current?.({ x: curX, y: curY, zoom: currentZoom });

        if (Math.hypot(curVx, curVy) >= PAN_GLIDE_STOP_SPEED) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          activeModeRef.current = null;
          onCommitRef.current({ x: curX, y: curY, zoom: currentZoom });
        }
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [cancel, stageRef],
  );

  const wheelZoomBy = useCallback(
    ({ factor, pointerX, pointerY, durationMs = 115 }: WheelZoomTarget) => {
      const stage = stageRef.current;
      const fallback = getCurrentRef.current();
      const liveZoom =
        stage && typeof stage.scaleX === "function" && stage.scaleX() > 0
          ? stage.scaleX()
          : fallback.zoom;
      const liveX =
        stage && typeof stage.x === "function" ? stage.x() : fallback.x;
      const liveY =
        stage && typeof stage.y === "function" ? stage.y() : fallback.y;

      const baseZoom =
        activeModeRef.current === "wheel-zoom" &&
        wheelTargetZoomRef.current !== null
          ? wheelTargetZoomRef.current
          : liveZoom;
      const targetZoom = clampZoom(baseZoom * factor);
      const worldX = (pointerX - liveX) / liveZoom;
      const worldY = (pointerY - liveY) / liveZoom;
      const targetX = pointerX - worldX * targetZoom;
      const targetY = pointerY - worldY * targetZoom;

      stopRaf();

      if (
        !stage ||
        prefersReducedMotion() ||
        durationMs <= 0 ||
        typeof requestAnimationFrame !== "function"
      ) {
        activeModeRef.current = null;
        wheelTargetZoomRef.current = null;
        onCommitRef.current({ x: targetX, y: targetY, zoom: targetZoom });
        return;
      }

      const startTime = performance.now();
      activeModeRef.current = "wheel-zoom";
      wheelTargetZoomRef.current = targetZoom;

      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = easeOutQuint(progress);
        const curZoom = liveZoom + (targetZoom - liveZoom) * eased;
        const curX = pointerX - worldX * curZoom;
        const curY = pointerY - worldY * curZoom;

        stage.position({ x: curX, y: curY });
        stage.scale({ x: curZoom, y: curZoom });
        stage.batchDraw();
        onFrameRef.current?.({ x: curX, y: curY, zoom: curZoom });

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          activeModeRef.current = null;
          wheelTargetZoomRef.current = null;
          onCommitRef.current({ x: targetX, y: targetY, zoom: targetZoom });
        }
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [stageRef, stopRaf],
  );

  useEffect(() => () => stopRaf(), [stopRaf]);

  return { animateTo, glidePan, wheelZoomBy, cancel };
}
