
import { useState, useRef, useCallback } from 'react';
import type Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { ItemType, type DrawingPath } from '@/types/canvas';
import { useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';

interface UseDrawingInteractionProps {
    canvasId: string;
}

export function useDrawingInteraction({ canvasId }: UseDrawingInteractionProps) {
    const { activeTool, drawingState } = useCanvasStore();
    const { mutate: createItem } = useCreateCanvasItem();

    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
    const currentPathRef = useRef<DrawingPath | null>(null);

    // Shape/Arrow creation state
    const [creationStart, setCreationStart] = useState<{ x: number, y: number } | null>(null);
    const [currentCreation, setCurrentCreation] = useState<{
        type: 'shape' | 'arrow',
        x: number,
        y: number,
        width: number,
        height: number
    } | null>(null);

    const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        const stage = e.target.getStage();
        if (!stage) return;
        const pos = stage.getRelativePointerPosition();
        if (!pos) return;

        if (activeTool === 'draw') {
            setIsDrawing(true);
            const newPath: DrawingPath = {
                points: [pos.x, pos.y],
                stroke: drawingState.color,
                strokeWidth: drawingState.strokeWidth,
                opacity: drawingState.opacity,
                tension: 0.5,
            };
            setCurrentPath(newPath);
            currentPathRef.current = newPath;
        } else if (activeTool === 'shape' || activeTool === 'arrow') {
            setCreationStart({ x: pos.x, y: pos.y });
            setCurrentCreation({
                type: activeTool,
                x: pos.x,
                y: pos.y,
                width: 0,
                height: 0
            });
        }
    }, [activeTool, drawingState]);

    const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        const stage = e.target.getStage();
        if (!stage) return;
        const pos = stage.getRelativePointerPosition();
        if (!pos) return;

        if (activeTool === 'draw' && isDrawing && currentPathRef.current) {
            const updatedPoints = [...currentPathRef.current.points, pos.x, pos.y];
            const updatedPath = { ...currentPathRef.current, points: updatedPoints };
            currentPathRef.current = updatedPath;
            setCurrentPath(updatedPath);
        } else if ((activeTool === 'shape' || activeTool === 'arrow') && creationStart) {
            const width = pos.x - creationStart.x;
            const height = pos.y - creationStart.y;

            setCurrentCreation({
                type: activeTool,
                x: width > 0 ? creationStart.x : pos.x,
                y: height > 0 ? creationStart.y : pos.y,
                width: Math.abs(width),
                height: Math.abs(height)
            });
        }
    }, [activeTool, isDrawing, creationStart]);

    const handleMouseUp = useCallback(() => {
        if (activeTool === 'draw' && isDrawing) {
            setIsDrawing(false);
            if (currentPathRef.current && currentPathRef.current.points.length > 2) {
                const points = currentPathRef.current.points;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < points.length; i += 2) {
                    const x = points[i] || 0;
                    const y = points[i + 1] || 0;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
                const width = maxX - minX;
                const height = maxY - minY;
                const normalizedPoints = points.map((val, i) => i % 2 === 0 ? (val || 0) - minX : (val || 0) - minY);

                createItem({
                    canvasId,
                    type: ItemType.DRAWING,
                    positionX: minX,
                    positionY: minY,
                    width: Math.max(width, 1),
                    height: Math.max(height, 1),
                    zIndex: 10,
                    tags: [],
                    content: {
                        paths: [{
                            ...currentPathRef.current,
                            points: normalizedPoints
                        }]
                    }
                });
            }
            setCurrentPath(null);
            currentPathRef.current = null;
        } else if ((activeTool === 'shape' || activeTool === 'arrow') && creationStart && currentCreation) {
            if (currentCreation.width > 5 && currentCreation.height > 5) {
                createItem({
                    canvasId,
                    type: activeTool === 'shape' ? ItemType.SHAPE : ItemType.ARROW,
                    positionX: currentCreation.x,
                    positionY: currentCreation.y,
                    width: currentCreation.width,
                    height: currentCreation.height,
                    zIndex: 10,
                    tags: [],
                    content: activeTool === 'shape' ? {
                        shapeType: 'rectangle',
                        fill: 'transparent',
                        stroke: '#000000',
                        strokeWidth: 2,
                    } : {
                        arrowHeadStart: 'none',
                        arrowHeadEnd: 'arrow',
                        stroke: '#000000',
                        strokeWidth: 2,
                        startPoint: { x: 0, y: 0 },
                        endPoint: { x: currentCreation.width, y: currentCreation.height },
                    }
                });
            }
            setCreationStart(null);
            setCurrentCreation(null);
        }
    }, [activeTool, isDrawing, creationStart, currentCreation, canvasId, createItem]);

    return {
        isDrawing,
        currentPath,
        currentCreation,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp
    };
}
