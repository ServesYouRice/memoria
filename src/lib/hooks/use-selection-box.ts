/**
 * Selection Box Hook
 *
 * Manages rectangle selection on canvas for multi-select functionality
 */

import { useState, useCallback, useRef } from 'react';

export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function useSelectionBox() {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const startPoint = useRef<Point | null>(null);

  /**
   * Start selection at a point
   */
  const startSelection = useCallback((point: Point) => {
    startPoint.current = point;
    setIsSelecting(true);
    setSelectionBox({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    });
  }, []);

  /**
   * Update selection as mouse moves
   */
  const updateSelection = useCallback((currentPoint: Point) => {
    if (!isSelecting || !startPoint.current) return;

    const start = startPoint.current;
    const x = Math.min(start.x, currentPoint.x);
    const y = Math.min(start.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - start.x);
    const height = Math.abs(currentPoint.y - start.y);

    setSelectionBox({ x, y, width, height });
  }, [isSelecting]);

  /**
   * End selection and return final box
   */
  const endSelection = useCallback((): SelectionBox | null => {
    setIsSelecting(false);
    const finalBox = selectionBox;
    startPoint.current = null;

    // Keep box visible briefly then clear
    setTimeout(() => {
      setSelectionBox(null);
    }, 100);

    return finalBox;
  }, [selectionBox]);

  /**
   * Cancel selection
   */
  const cancelSelection = useCallback(() => {
    setIsSelecting(false);
    setSelectionBox(null);
    startPoint.current = null;
  }, []);

  /**
   * Check if an item intersects with selection box
   */
  const isItemInSelection = useCallback((itemBox: SelectionBox, box: SelectionBox): boolean => {
    return !(
      itemBox.x + itemBox.width < box.x ||
      itemBox.x > box.x + box.width ||
      itemBox.y + itemBox.height < box.y ||
      itemBox.y > box.y + box.height
    );
  }, []);

  return {
    isSelecting,
    selectionBox,
    startSelection,
    updateSelection,
    endSelection,
    cancelSelection,
    isItemInSelection,
  };
}
