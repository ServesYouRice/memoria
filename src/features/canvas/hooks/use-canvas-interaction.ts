import type React from 'react';
import type Konva from 'konva';
import { useDrawingInteraction } from './use-drawing-interaction';
import { type CanvasItem } from '@/types/canvas';

interface UseCanvasInteractionProps {
    canvasId: string;
    stageRef: React.RefObject<Konva.Stage>;
    activeTool: string;
    zoom: number;
    position: { x: number, y: number };

    // Selection Hook Logic
    isSelecting: boolean;
    startSelection: (pos: { x: number, y: number }) => void;
    updateSelection: (pos: { x: number, y: number }) => void;
    endSelection: () => { x: number, y: number, width: number, height: number } | null;
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

    const drawing = useDrawingInteraction({ canvasId });
    const isDrawingOrCreating = activeTool === 'draw' || activeTool === 'shape' || activeTool === 'arrow';

    const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
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
                    if (isItemInSelection({
                        x: item.positionX,
                        y: item.positionY,
                        width: item.width,
                        height: item.height,
                    }, finalBox)) {
                        selected.add(item.id);
                    }
                });
                setSelectedItemIds(selected);
                setSelectedItemId(null);
            } else {
                // If it was a tiny drag (click), logic handled in onClick usually, 
                // but here we ensure cleanup
                // Note: handleStageClick handles deselection on background click
            }
        }
    };

    const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
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

        // Expose drawing state
        isDrawing: drawing.isDrawing,
        currentPath: drawing.currentPath,
        currentCreation: drawing.currentCreation
    };
}
