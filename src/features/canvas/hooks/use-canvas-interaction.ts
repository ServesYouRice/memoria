import type React from "react";
import { useRef } from "react";
import type Konva from "konva";
import { useDrawingInteraction } from "./use-drawing-interaction";
import { type CanvasCapabilities, type CanvasItem } from "@/types/canvas";

const CREATING_TOOLS = new Set(["draw", "shape", "arrow"]);

/**
 * The tool the stage actually uses. `activeTool` is a persisted preference
 * shared by every canvas, so a drawing tool saved on an editable board falls
 * back to select where the user cannot create items (IMP-008), without
 * touching the saved preference.
 */
export function resolveEffectiveTool(
  activeTool: string,
  capabilities: Pick<CanvasCapabilities, "canCreateItems">,
): string {
  return CREATING_TOOLS.has(activeTool) && !capabilities.canCreateItems
    ? "select"
    : activeTool;
}

interface UseCanvasInteractionProps {
  canvasId: string;
  stageRef: React.RefObject<Konva.Stage>;
  activeTool: string;
  /** IMP-008 create capability; without it drawing tools act as select. */
  canCreateItems: boolean;
  zoom: number;
  position: { x: number; y: number };

  // Selection Hook Logic
  isSelecting: boolean;
  startSelection: (pos: { x: number; y: number }) => void;
  updateSelection: (pos: { x: number; y: number }) => void;
  endSelection: () => {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  isItemInSelection: (itemRect: any, selectionRect: any) => boolean;

  // State Setters
  items: CanvasItem[];
  setSelectedItemIds: (ids: Set<string>) => void;
  setSelectedItemId: (id: string | null) => void;
}

export function useCanvasInteraction({
  canvasId,
  stageRef: _stageRef,
  activeTool,
  canCreateItems,
  zoom,
  position,
  isSelecting,
  startSelection,
  updateSelection,
  endSelection,
  isItemInSelection,
  items,
  setSelectedItemIds,
  setSelectedItemId,
}: UseCanvasInteractionProps) {
  const drawing = useDrawingInteraction({
    canvasId,
    canCreateItems,
    items,
  });
  const effectiveTool = resolveEffectiveTool(activeTool, { canCreateItems });
  const isDrawingOrCreating = CREATING_TOOLS.has(effectiveTool);
  // A marquee drag ends with a click on the empty stage; that click must not
  // clear the selection the drag just made.
  const suppressNextStageClickRef = useRef(false);

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    suppressNextStageClickRef.current = false;
    if (isDrawingOrCreating) {
      drawing.handleMouseDown(e);
      return;
    }

    // Only start selection on empty canvas
    if (e.target === e.target.getStage()) {
      const stage = e.target.getStage();
      if (!stage) return;
      const pointerPos = stage.getPointerPosition();
      if (pointerPos) {
        startSelection({
          x: (pointerPos.x - position.x) / zoom,
          y: (pointerPos.y - position.y) / zoom,
        });
      }
    }
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDrawingOrCreating) {
      drawing.handleMouseMove(e);
      return;
    }

    const stage = e.target.getStage();
    if (!stage) return;
    const pointerPos = stage.getPointerPosition();

    if (pointerPos) {
      if (isSelecting) {
        updateSelection({
          x: (pointerPos.x - position.x) / zoom,
          y: (pointerPos.y - position.y) / zoom,
        });
      }
    }
  };

  const handleStageMouseUp = (_e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDrawingOrCreating) {
      drawing.handleMouseUp();
      return;
    }

    if (isSelecting) {
      const finalBox = endSelection();
      if (finalBox && finalBox.width > 5 && finalBox.height > 5) {
        const selected = new Set<string>();
        items.forEach((item) => {
          if (
            isItemInSelection(
              {
                x: item.positionX,
                y: item.positionY,
                width: item.width,
                height: item.height,
              },
              finalBox,
            )
          ) {
            selected.add(item.id);
          }
        });
        setSelectedItemIds(selected);
        setSelectedItemId(null);
        suppressNextStageClickRef.current = true;
      } else {
        // If it was a tiny drag (click), logic handled in onClick usually,
        // but here we ensure cleanup
        // Note: handleStageClick handles deselection on background click
      }
    }
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (suppressNextStageClickRef.current) {
      suppressNextStageClickRef.current = false;
      return;
    }
    // Deselect if clicking on empty stage
    if (e.target === e.target.getStage()) {
      setSelectedItemId(null);
      setSelectedItemIds(new Set());
    }
  };

  return {
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleStageClick,
    effectiveTool,

    // Expose drawing state
    isDrawing: drawing.isDrawing,
    currentPath: drawing.currentPath,
    currentCreation: drawing.currentCreation,
  };
}
