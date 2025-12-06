'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer } from 'react-konva';
import { Box, Button, CircularProgress, Alert } from '@mui/material';
import { ItemType } from '@prisma/client';
import { NoteItem } from './NoteItem';
import { useCanvasItems, useCreateCanvasItem, useDeleteCanvasItem } from '@/lib/hooks/use-canvas-items';

interface CanvasProps {
  canvasId: string;
}

export const Canvas: React.FC<CanvasProps> = ({ canvasId }) => {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: items, isLoading, error, refetch } = useCanvasItems(canvasId);
  const createMutation = useCreateCanvasItem();
  const deleteMutation = useDeleteCanvasItem();

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Delete selected item
    if (e.key === 'Delete' && selectedItemId) {
      deleteMutation.mutate({ itemId: selectedItemId, canvasId });
      setSelectedItemId(null);
    }
    // Escape to deselect
    if (e.key === 'Escape') {
      setSelectedItemId(null);
    }
    // Ctrl+N to add note (when not in input)
    if (e.ctrlKey && e.key === 'n' && !(e.target as HTMLElement).matches('input, textarea')) {
      e.preventDefault();
      createMutation.mutate({
        canvasId,
        type: ItemType.NOTE,
        positionX: stageSize.width / 2 - 100,
        positionY: stageSize.height / 2 - 75,
        width: 200,
        height: 150,
        content: { text: 'New Note' },
      });
    }
  }, [selectedItemId, canvasId, deleteMutation, createMutation, stageSize]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Update stage size to match container
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleCreateNote = () => {
    // Create a new note in the center of the visible area
    createMutation.mutate({
      canvasId,
      type: ItemType.NOTE,
      positionX: stageSize.width / 2 - 100,
      positionY: stageSize.height / 2 - 75,
      width: 200,
      height: 150,
      content: {
        text: 'New Note',
      },
    });
  };

  const handleStageClick = (e: any) => {
    // Deselect if clicking on the stage background
    if (e.target === e.target.getStage()) {
      setSelectedItemId(null);
    }
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load canvas items: {(error as Error).message}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleCreateNote}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Creating...' : 'Add Note'}
        </Button>
      </Box>

      {/* Canvas */}
      <Box ref={containerRef} sx={{ flex: 1, bgcolor: '#f5f5f5', overflow: 'hidden' }}>
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          onClick={handleStageClick}
          onTap={handleStageClick}
        >
          <Layer>
            {items?.map((item) => {
              if (item.type === ItemType.NOTE) {
                return (
                  <NoteItem
                    key={item.id}
                    item={item}
                    canvasId={canvasId}
                    isSelected={item.id === selectedItemId}
                    onSelect={() => setSelectedItemId(item.id)}
                  />
                );
              }
              return null;
            })}
          </Layer>
        </Stage>
      </Box>
    </Box>
  );
};
