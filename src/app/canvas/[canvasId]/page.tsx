/**
 * Canvas Page
 *
 * Main canvas view integrating both NOTE and BOOKMARK items
 * This is a simplified example showing how components integrate
 */

'use client';

import React, { useState } from 'react';
import { Stage, Layer } from 'react-konva';
import { Box, Fab, SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material';
import { NoteAdd, Bookmark } from '@mui/icons-material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCanvasItems } from '@/lib/hooks/use-canvas-items';
import { BookmarkItem } from '@/features/canvas/components/BookmarkItem';
import { NoteItem } from '@/features/canvas/components/NoteItem';
import { CreateBookmarkDialog } from '@/features/canvas/components/CreateBookmarkDialog';
import { ItemType, isBookmarkContent } from '@/types/canvas';

const queryClient = new QueryClient();

interface CanvasPageProps {
  params: {
    canvasId: string;
  };
}

function CanvasContent({ canvasId }: { canvasId: string }) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

  // Fetch all items for this canvas
  const { data: items = [], isLoading, error } = useCanvasItems(canvasId);

  // Update stage size on mount
  React.useEffect(() => {
    const updateSize = () => {
      setStageSize({
        width: window.innerWidth,
        height: window.innerHeight - 64, // Subtract app bar height
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleStageClick = (e: any) => {
    // Deselect if clicking on empty canvas
    if (e.target === e.target.getStage()) {
      setSelectedItemId(null);
    }
  };

  if (isLoading) {
    return <div>Loading canvas...</div>;
  }

  if (error) {
    return <div>Error loading canvas: {error.message}</div>;
  }

  return (
    <Box sx={{ width: '100%', height: '100vh', overflow: 'hidden' }}>
      {/* Canvas */}
      <Stage
        width={stageSize.width}
        height={stageSize.height}
        onClick={handleStageClick}
        onTap={handleStageClick}
      >
        <Layer>
          {items.map((item) => {
            if (item.type === ItemType.BOOKMARK) {
              return (
                <BookmarkItem
                  key={item.id}
                  item={item}
                  isSelected={selectedItemId === item.id}
                  onSelect={() => setSelectedItemId(item.id)}
                  onDeselect={() => setSelectedItemId(null)}
                />
              );
            } else if (item.type === ItemType.NOTE) {
              return (
                <NoteItem
                  key={item.id}
                  item={item}
                  isSelected={selectedItemId === item.id}
                  onSelect={() => setSelectedItemId(item.id)}
                />
              );
            }
            return null;
          })}
        </Layer>
      </Stage>

      {/* Floating Action Buttons */}
      <SpeedDial
        ariaLabel="Add item"
        sx={{ position: 'absolute', bottom: 16, right: 16 }}
        icon={<SpeedDialIcon />}
      >
        <SpeedDialAction
          icon={<Bookmark />}
          tooltipTitle="Add Bookmark"
          onClick={() => setBookmarkDialogOpen(true)}
          data-testid="add-bookmark-button"
        />
        <SpeedDialAction
          icon={<NoteAdd />}
          tooltipTitle="Add Note"
          onClick={() => {
            // Note creation dialog would go here
            console.log('Add note clicked');
          }}
        />
      </SpeedDial>

      {/* Create Bookmark Dialog */}
      <CreateBookmarkDialog
        open={bookmarkDialogOpen}
        onClose={() => setBookmarkDialogOpen(false)}
        canvasId={canvasId}
        initialPosition={{ x: 100, y: 100 }}
      />
    </Box>
  );
}

export default function CanvasPage({ params }: CanvasPageProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <CanvasContent canvasId={params.canvasId} />
    </QueryClientProvider>
  );
}
