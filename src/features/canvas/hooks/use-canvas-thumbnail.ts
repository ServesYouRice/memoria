/**
 * Canvas Thumbnail Hook
 * Handles automatic thumbnail generation from canvas content
 */

import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import { useUpdateCanvasThumbnail } from "@/lib/hooks/use-canvases";

interface UseCanvasThumbnailOptions {
  canvasId: string;
  stageRef: React.RefObject<Konva.Stage>;
  itemCount: number;
  /** Delay before generating thumbnail after items change (ms) */
  debounceMs?: number;
}

export function useCanvasThumbnail({
  canvasId,
  stageRef,
  itemCount,
  debounceMs = 3000,
}: UseCanvasThumbnailOptions) {
  const updateThumbnail = useUpdateCanvasThumbnail();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Generate and upload thumbnail from current canvas state
   */
  const generateThumbnail = useCallback(() => {
    if (!stageRef.current) return;

    try {
      const thumbnail = stageRef.current.toDataURL({
        pixelRatio: 0.3,
        mimeType: "image/jpeg",
        quality: 0.6,
      });
      updateThumbnail.mutate({ canvasId, thumbnail });
    } catch (err) {
      console.error("Failed to generate thumbnail:", err);
    }
  }, [canvasId, stageRef, updateThumbnail]);

  /**
   * Auto-generate thumbnail when items change (debounced)
   */
  useEffect(() => {
    if (itemCount === 0) return;

    // Clear any pending thumbnail generation
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Schedule thumbnail generation after debounce period
    timeoutRef.current = setTimeout(() => {
      generateThumbnail();
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [itemCount, generateThumbnail, debounceMs]);

  return {
    generateThumbnail,
  };
}
