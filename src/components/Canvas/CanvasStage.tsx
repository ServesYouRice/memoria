'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { Stage, Layer } from 'react-konva';
import { Box, CircularProgress, Alert } from '@mui/material';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvas, useUpdateCanvas } from '@/hooks/useCanvas';
import type Konva from 'konva';

/**
 * CanvasStage Component
 *
 * Implements Slice 3 requirements:
 * - Konva.js + react-konva for canvas rendering
 * - Pan functionality (drag to pan)
 * - Zoom functionality (mouse wheel)
 * - Zustand for ephemeral UI state (current zoom, pan position)
 * - TanStack Query for persisted canvas data
 * - Responsive canvas sizing
 *
 * Per ADR-0007: Canvas libraries are lazy-loaded to meet performance budget
 */

interface CanvasStageProps {
  canvasId: string;
}

export function CanvasStage({ canvasId }: CanvasStageProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });

  // Zustand store - ephemeral UI state
  const { currentZoom, currentPanX, currentPanY, activeTool, setZoom, setPan } = useCanvasStore();

  // TanStack Query - server-persisted data
  const { data: canvas, isLoading, error } = useCanvas(canvasId);
  const updateCanvasMutation = useUpdateCanvas(canvasId);

  // Initialize canvas state from server data
  useEffect(() => {
    if (canvas) {
      setZoom(canvas.zoomLevel);
      setPan(canvas.panX, canvas.panY);
    }
  }, [canvas, setZoom, setPan]);

  // Debounced save to server
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const saveCanvasState = useCallback(
    (zoom: number, panX: number, panY: number) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        updateCanvasMutation.mutate({
          zoomLevel: zoom,
          panX,
          panY,
        });
      }, 500); // 500ms debounce per ADR-0009
    },
    [updateCanvasMutation]
  );

  // Handle zoom with mouse wheel
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = currentZoom;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // Zoom calculation
      const scaleBy = 1.1;
      const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

      // Clamp zoom between 0.1x and 10x
      const clampedScale = Math.max(0.1, Math.min(10, newScale));

      // Calculate new position to zoom towards pointer
      const mousePointTo = {
        x: (pointer.x - currentPanX) / oldScale,
        y: (pointer.y - currentPanY) / oldScale,
      };

      const newPanX = pointer.x - mousePointTo.x * clampedScale;
      const newPanY = pointer.y - mousePointTo.y * clampedScale;

      // Update Zustand state
      setZoom(clampedScale);
      setPan(newPanX, newPanY);

      // Persist to server (debounced)
      saveCanvasState(clampedScale, newPanX, newPanY);
    },
    [currentZoom, currentPanX, currentPanY, setZoom, setPan, saveCanvasState]
  );

  // Handle pan with drag
  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const newX = e.target.x();
      const newY = e.target.y();

      // Update Zustand state
      setPan(newX, newY);

      // Persist to server (debounced)
      saveCanvasState(currentZoom, newX, newY);
    },
    [currentZoom, setPan, saveCanvasState]
  );

  // Handle responsive sizing
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error">Failed to load canvas: {error.message}</Alert>
      </Box>
    );
  }

  if (!canvas) {
    return (
      <Box p={3}>
        <Alert severity="warning">Canvas not found</Alert>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
        cursor: activeTool === 'pan' ? 'grab' : 'default',
        '&:active': {
          cursor: activeTool === 'pan' ? 'grabbing' : 'default',
        },
      }}
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        draggable={activeTool === 'select' || activeTool === 'pan'}
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
        x={currentPanX}
        y={currentPanY}
        scaleX={currentZoom}
        scaleY={currentZoom}
      >
        <Layer>{/* Items will be rendered here in Slice 4 */}</Layer>
      </Stage>

      {/* Zoom level indicator */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          bgcolor: 'background.paper',
          px: 2,
          py: 1,
          borderRadius: 1,
          boxShadow: 1,
          fontSize: '0.875rem',
        }}
      >
        {Math.round(currentZoom * 100)}%
      </Box>
    </Box>
  );
}
