/**
 * Canvas Page
 *
 * Main canvas view integrating both NOTE and BOOKMARK items with zoom and pan controls
 */

'use client';

import React, { useState, useRef } from 'react';
import { Stage, Layer } from 'react-konva';
import { Box, SpeedDial, SpeedDialAction, SpeedDialIcon, CircularProgress } from '@mui/material';
import { NoteAdd, Bookmark } from '@mui/icons-material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCanvasItems, useDeleteCanvasItem, useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { BookmarkItem } from '@/features/canvas/components/BookmarkItem';
import { NoteItem } from '@/features/canvas/components/NoteItem';
import { CreateBookmarkDialog } from '@/features/canvas/components/CreateBookmarkDialog';
import { CreateNoteDialog } from '@/features/canvas/components/CreateNoteDialog';
import { CanvasHeader } from '@/features/canvas/components/CanvasHeader';
import { CanvasContextMenu, ContextMenuPosition } from '@/features/canvas/components/CanvasContextMenu';
import { ItemType } from '@/types/canvas';
import Konva from 'konva';

const queryClient = new QueryClient();

interface CanvasPageProps {
  params: {
    canvasId: string;
  };
}

function CanvasContent({ canvasId }: { canvasId: string }) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [canvasName, setCanvasName] = useState('Untitled Canvas');
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const stageRef = useRef<Konva.Stage>(null);

  // Fetch all items for this canvas
  const { data, isLoading, error } = useCanvasItems(canvasId);
  const allItems = data?.items || [];
  const { mutateAsync: deleteItem } = useDeleteCanvasItem();
  const { mutateAsync: createItem } = useCreateCanvasItem();

  // Filter items based on search query
  const items = React.useMemo(() => {
    if (!searchQuery.trim()) return allItems;

    const query = searchQuery.toLowerCase();
    return allItems.filter((item) => {
      if (item.type === ItemType.NOTE) {
        const noteContent = item.content as { text: string };
        return noteContent.text.toLowerCase().includes(query);
      } else if (item.type === ItemType.BOOKMARK) {
        const bookmarkContent = item.content as { url: string };
        return bookmarkContent.url.toLowerCase().includes(query);
      }
      return false;
    });
  }, [allItems, searchQuery]);

  // Fetch canvas details (name, zoom, pan)
  React.useEffect(() => {
    const fetchCanvas = async () => {
      try {
        const response = await fetch(`/api/v1/canvases`);
        if (response.ok) {
          const canvases = await response.json();
          const canvas = canvases.find((c: any) => c.id === canvasId);
          if (canvas) {
            setCanvasName(canvas.name);
            setZoom(canvas.zoomLevel || 1);
            setPosition({ x: canvas.panX || 0, y: canvas.panY || 0 });
          }
        }
      } catch (err) {
        console.error('Failed to fetch canvas:', err);
      }
    };
    fetchCanvas();
  }, [canvasId]);

  // Update stage size on mount and resize
  React.useEffect(() => {
    const HEADER_HEIGHT = 64;
    const updateSize = () => {
      setStageSize({
        width: window.innerWidth,
        height: window.innerHeight - HEADER_HEIGHT,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Delete key - delete selected item
      if (e.key === 'Delete' && selectedItemId) {
        const selectedItem = allItems.find((item) => item.id === selectedItemId);
        if (selectedItem) {
          try {
            await deleteItem({
              itemId: selectedItemId,
              version: selectedItem.version,
            });
            setSelectedItemId(null);
          } catch (err) {
            console.error('Failed to delete item:', err);
          }
        }
      }
      // Escape key - deselect
      else if (e.key === 'Escape') {
        setSelectedItemId(null);
        setContextMenuPosition(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemId, allItems, deleteItem]);

  // Prevent default context menu on stage
  React.useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (stageRef.current?.container().contains(e.target as Node)) {
        e.preventDefault();
      }
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  const handleStageClick = (e: any) => {
    // Deselect if clicking on empty canvas
    if (e.target === e.target.getStage()) {
      setSelectedItemId(null);
    }
  };

  const handleCanvasNameChange = async (name: string) => {
    setCanvasName(name);
    // Update canvas name via API
    try {
      const response = await fetch(`/api/v1/canvases/${canvasId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        console.error('Failed to update canvas name');
      }
    } catch (err) {
      console.error('Failed to update canvas name:', err);
    }
  };

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
    if (stageRef.current) {
      stageRef.current.scale({ x: newZoom, y: newZoom });
    }
    // TODO: Persist zoom to canvas via API
  };

  const handleFitToScreen = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    if (stageRef.current) {
      stageRef.current.position({ x: 0, y: 0 });
      stageRef.current.scale({ x: 1, y: 1 });
    }
  };

  const handleContextMenu = (e: React.MouseEvent, itemId: string) => {
    e.preventDefault();
    setSelectedItemId(itemId);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleDeleteFromMenu = async () => {
    if (!selectedItemId) return;
    const selectedItem = allItems.find((item) => item.id === selectedItemId);
    if (selectedItem) {
      try {
        await deleteItem({
          itemId: selectedItemId,
          version: selectedItem.version,
        });
        setSelectedItemId(null);
      } catch (err) {
        console.error('Failed to delete item:', err);
      }
    }
  };

  const handleDuplicate = async () => {
    if (!selectedItemId) return;
    const selectedItem = allItems.find((item) => item.id === selectedItemId);
    if (selectedItem) {
      try {
        await createItem({
          canvasId,
          type: selectedItem.type,
          positionX: selectedItem.positionX + 20,
          positionY: selectedItem.positionY + 20,
          width: selectedItem.width,
          height: selectedItem.height,
          zIndex: selectedItem.zIndex,
          content: selectedItem.content,
        });
      } catch (err) {
        console.error('Failed to duplicate item:', err);
      }
    }
  };

  const handleCopy = () => {
    if (!selectedItemId) return;
    const selectedItem = allItems.find((item) => item.id === selectedItemId);
    if (selectedItem) {
      // Copy to clipboard (JSON format for now)
      const copyData = {
        type: selectedItem.type,
        content: selectedItem.content,
        width: selectedItem.width,
        height: selectedItem.height,
      };
      navigator.clipboard.writeText(JSON.stringify(copyData));
    }
  };

  const handleExportPNG = () => {
    if (!stageRef.current) return;

    const uri = stageRef.current.toDataURL({
      pixelRatio: 2, // Higher quality
    });

    // Create download link
    const link = document.createElement('a');
    link.download = `${canvasName.replace(/\s+/g, '_')}.png`;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    // PDF export would require jsPDF library
    // For now, just show an alert
    alert('PDF export will be implemented in a future update. Use PNG export for now.');
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 4 }}>
        <div>Error loading canvas: {error.message}</div>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Canvas Header */}
      <CanvasHeader
        canvasName={canvasName}
        onCanvasNameChange={handleCanvasNameChange}
        zoom={zoom}
        onZoomChange={handleZoomChange}
        onFitToScreen={handleFitToScreen}
        onExportPNG={handleExportPNG}
        onExportPDF={handleExportPDF}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Canvas */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          onClick={handleStageClick}
          onTap={handleStageClick}
          scaleX={zoom}
          scaleY={zoom}
          x={position.x}
          y={position.y}
          draggable
          onDragEnd={(e) => {
            setPosition({
              x: e.target.x(),
              y: e.target.y(),
            });
          }}
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
                    onContextMenu={(e: any) => {
                      const stage = e.target.getStage();
                      const pointerPosition = stage.getPointerPosition();
                      handleContextMenu(
                        { clientX: pointerPosition.x, clientY: pointerPosition.y, preventDefault: () => {} } as React.MouseEvent,
                        item.id
                      );
                    }}
                  />
                );
              } else if (item.type === ItemType.NOTE) {
                return (
                  <NoteItem
                    key={item.id}
                    item={item}
                    isSelected={selectedItemId === item.id}
                    onSelect={() => setSelectedItemId(item.id)}
                    onContextMenu={(e: any) => {
                      const stage = e.target.getStage();
                      const pointerPosition = stage.getPointerPosition();
                      handleContextMenu(
                        { clientX: pointerPosition.x, clientY: pointerPosition.y, preventDefault: () => {} } as React.MouseEvent,
                        item.id
                      );
                    }}
                  />
                );
              }
              return null;
            })}
          </Layer>
        </Stage>
      </Box>

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
          onClick={() => setNoteDialogOpen(true)}
          data-testid="add-note-button"
        />
      </SpeedDial>

      {/* Create Bookmark Dialog */}
      <CreateBookmarkDialog
        open={bookmarkDialogOpen}
        onClose={() => setBookmarkDialogOpen(false)}
        canvasId={canvasId}
        initialPosition={{ x: 100, y: 100 }}
      />

      {/* Create Note Dialog */}
      <CreateNoteDialog
        open={noteDialogOpen}
        onClose={() => setNoteDialogOpen(false)}
        canvasId={canvasId}
        initialPosition={{ x: 200, y: 200 }}
      />

      {/* Context Menu */}
      <CanvasContextMenu
        position={contextMenuPosition}
        onClose={() => setContextMenuPosition(null)}
        onDelete={handleDeleteFromMenu}
        onDuplicate={handleDuplicate}
        onCopy={handleCopy}
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
