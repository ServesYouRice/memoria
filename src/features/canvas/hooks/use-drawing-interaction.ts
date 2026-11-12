import { useState, useRef, useCallback } from "react";
import type Konva from "konva";
import { useCanvasStore } from "@/stores/canvasStore";
import { ItemType, type CanvasItem, type DrawingPath } from "@/types/canvas";
import { drawnArrow } from "@/features/canvas/lib/arrow-attachment";
import { useCreateCanvasItem } from "@/lib/hooks/use-canvas-items";

/** Arrows shorter than this (in canvas units) are treated as a stray click. */
const MIN_ARROW_LENGTH = 5;

type Point = { x: number; y: number };

interface UseDrawingInteractionProps {
  canvasId: string;
  /** IMP-008: without it, no stroke or shape is started or created. */
  canCreateItems: boolean;
  /** Items an arrow's ends can attach to (IMP-095). */
  items?: readonly CanvasItem[];
}

const NO_ITEMS: readonly CanvasItem[] = [];

export function useDrawingInteraction({
  canvasId,
  canCreateItems,
  items = NO_ITEMS,
}: UseDrawingInteractionProps) {
  const { activeTool: storedTool, drawingState } = useCanvasStore();
  // The persisted tool may come from a canvas this user could edit.
  const activeTool = canCreateItems ? storedTool : "select";
  const { mutate: createItem } = useCreateCanvasItem();

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const currentPathRef = useRef<DrawingPath | null>(null);

  // Shape/Arrow creation state
  const [creationStart, setCreationStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // Where the pointer is now; the normalized rectangle loses the direction.
  const creationEndRef = useRef<Point | null>(null);
  const [currentCreation, setCurrentCreation] = useState<{
    type: "shape" | "arrow";
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;

      if (activeTool === "draw") {
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
      } else if (activeTool === "shape" || activeTool === "arrow") {
        setCreationStart({ x: pos.x, y: pos.y });
        creationEndRef.current = { x: pos.x, y: pos.y };
        setCurrentCreation({
          type: activeTool,
          x: pos.x,
          y: pos.y,
          width: 0,
          height: 0,
        });
      }
    },
    [activeTool, drawingState],
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;

      if (activeTool === "draw" && isDrawing && currentPathRef.current) {
        const updatedPoints = [...currentPathRef.current.points, pos.x, pos.y];
        const updatedPath = {
          ...currentPathRef.current,
          points: updatedPoints,
        };
        currentPathRef.current = updatedPath;
        setCurrentPath(updatedPath);
      } else if (
        (activeTool === "shape" || activeTool === "arrow") &&
        creationStart
      ) {
        const width = pos.x - creationStart.x;
        const height = pos.y - creationStart.y;
        creationEndRef.current = { x: pos.x, y: pos.y };

        setCurrentCreation({
          type: activeTool,
          x: width > 0 ? creationStart.x : pos.x,
          y: height > 0 ? creationStart.y : pos.y,
          width: Math.abs(width),
          height: Math.abs(height),
        });
      }
    },
    [activeTool, isDrawing, creationStart],
  );

  const handleMouseUp = useCallback(() => {
    if (activeTool === "draw" && isDrawing) {
      setIsDrawing(false);
      if (currentPathRef.current && currentPathRef.current.points.length > 2) {
        const points = currentPathRef.current.points;
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
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
        const normalizedPoints = points.map((val, i) =>
          i % 2 === 0 ? (val || 0) - minX : (val || 0) - minY,
        );

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
            paths: [
              {
                ...currentPathRef.current,
                points: normalizedPoints,
              },
            ],
          },
        });
      }
      setCurrentPath(null);
      currentPathRef.current = null;
    } else if (
      (activeTool === "shape" || activeTool === "arrow") &&
      creationStart &&
      currentCreation
    ) {
      if (activeTool === "arrow") {
        // An end released on an item attaches to it, linking the two.
        const arrow = drawnArrow(
          creationStart,
          creationEndRef.current ?? creationStart,
          items,
        );
        if (arrow.length > MIN_ARROW_LENGTH) {
          createItem({
            canvasId,
            type: ItemType.ARROW,
            positionX: arrow.positionX,
            positionY: arrow.positionY,
            width: arrow.width,
            height: arrow.height,
            zIndex: arrow.zIndex ?? 10,
            tags: [],
            content: {
              ...arrow.content,
              arrowHeadStart: "none",
              arrowHeadEnd: "arrow",
              stroke: "#000000",
              strokeWidth: 2,
              startPoint: arrow.startPoint,
              endPoint: arrow.endPoint,
            },
          });
        }
      } else if (currentCreation.width > 5 && currentCreation.height > 5) {
        createItem({
          canvasId,
          type: ItemType.SHAPE,
          positionX: currentCreation.x,
          positionY: currentCreation.y,
          width: currentCreation.width,
          height: currentCreation.height,
          zIndex: 10,
          tags: [],
          content: {
            shapeType: "rectangle",
            fill: "transparent",
            stroke: "#000000",
            strokeWidth: 2,
          },
        });
      }
      creationEndRef.current = null;
      setCreationStart(null);
      setCurrentCreation(null);
    }
  }, [
    activeTool,
    isDrawing,
    creationStart,
    currentCreation,
    canvasId,
    createItem,
    items,
  ]);

  return {
    isDrawing,
    currentPath,
    currentCreation,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
