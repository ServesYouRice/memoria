/**
 * Shared Resizable Hook
 *
 * Consolidates resize handle logic from BookmarkItem, NoteItem, and ImageItem.
 * Reduces code duplication and ensures consistent resize behavior.
 *
 * @module lib/hooks/use-resizable
 */

import { useCallback, useRef, useState } from "react";

export interface ResizeOptions {
  /** Initial width */
  initialWidth: number;
  /** Initial height */
  initialHeight: number;
  /** Minimum width */
  minWidth?: number;
  /** Minimum height */
  minHeight?: number;
  /** Maximum width */
  maxWidth?: number;
  /** Maximum height */
  maxHeight?: number;
  /** Callback when resize starts */
  onResizeStart?: () => void;
  /** Callback during resize */
  onResize?: (width: number, height: number) => void;
  /** Callback when resize ends */
  onResizeEnd?: (width: number, height: number) => void;
  /** Whether to maintain aspect ratio */
  aspectRatio?: boolean;
}

export interface ResizeState {
  width: number;
  height: number;
  isResizing: boolean;
}

export interface ResizeHandlers {
  /** Start resize from a corner */
  startResize: (
    corner: ResizeCorner,
    e: React.MouseEvent | React.TouchEvent,
  ) => void;
  /** Handle resize during drag */
  handleResize: (e: MouseEvent | TouchEvent) => void;
  /** End the resize operation */
  endResize: () => void;
}

export type ResizeCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

export function useResizable(
  options: ResizeOptions,
): [ResizeState, ResizeHandlers] {
  const {
    initialWidth,
    initialHeight,
    minWidth = 50,
    minHeight = 50,
    maxWidth = 2000,
    maxHeight = 2000,
    onResizeStart,
    onResize,
    onResizeEnd,
    aspectRatio = false,
  } = options;

  const [state, setState] = useState<ResizeState>({
    width: initialWidth,
    height: initialHeight,
    isResizing: false,
  });

  const startRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    corner: ResizeCorner;
    ratio: number;
  } | null>(null);

  const clamp = useCallback(
    (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max),
    [],
  );

  const getEventCoords = useCallback(
    (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
      if ("touches" in e) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      return { x: e.clientX, y: e.clientY };
    },
    [],
  );

  const startResize = useCallback(
    (corner: ResizeCorner, e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const { x, y } = getEventCoords(e);
      startRef.current = {
        x,
        y,
        width: state.width,
        height: state.height,
        corner,
        ratio: state.width / state.height,
      };

      setState((prev) => ({ ...prev, isResizing: true }));
      onResizeStart?.();
    },
    [state.width, state.height, onResizeStart, getEventCoords],
  );

  const handleResize = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!startRef.current) return;

      const { x, y } = getEventCoords(e);
      const start = startRef.current;
      const deltaX = x - start.x;
      const deltaY = y - start.y;

      let newWidth = start.width;
      let newHeight = start.height;

      // Calculate new dimensions based on corner
      switch (start.corner) {
        case "bottom-right":
          newWidth = start.width + deltaX;
          newHeight = start.height + deltaY;
          break;
        case "bottom-left":
          newWidth = start.width - deltaX;
          newHeight = start.height + deltaY;
          break;
        case "top-right":
          newWidth = start.width + deltaX;
          newHeight = start.height - deltaY;
          break;
        case "top-left":
          newWidth = start.width - deltaX;
          newHeight = start.height - deltaY;
          break;
      }

      // Maintain aspect ratio if enabled
      if (aspectRatio) {
        const currentRatio = newWidth / newHeight;
        if (currentRatio > start.ratio) {
          newWidth = newHeight * start.ratio;
        } else {
          newHeight = newWidth / start.ratio;
        }
      }

      // Clamp values
      newWidth = clamp(newWidth, minWidth, maxWidth);
      newHeight = clamp(newHeight, minHeight, maxHeight);

      setState((prev) => ({ ...prev, width: newWidth, height: newHeight }));
      onResize?.(newWidth, newHeight);
    },
    [
      aspectRatio,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      clamp,
      onResize,
      getEventCoords,
    ],
  );

  const endResize = useCallback(() => {
    if (startRef.current) {
      onResizeEnd?.(state.width, state.height);
      startRef.current = null;
    }
    setState((prev) => ({ ...prev, isResizing: false }));
  }, [state.width, state.height, onResizeEnd]);

  return [state, { startResize, handleResize, endResize }];
}
