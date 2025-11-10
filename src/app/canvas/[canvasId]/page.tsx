/**
 * Canvas Page
 *
 * Main canvas view integrating both NOTE and BOOKMARK items with zoom and pan controls
 */

'use client';

import React, { useState, useRef } from 'react';
import { Stage, Layer } from 'react-konva';
import { Box, SpeedDial, SpeedDialAction, SpeedDialIcon, CircularProgress } from '@mui/material';
import { NoteAdd, Bookmark, Image } from '@mui/icons-material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCanvasItems, useDeleteCanvasItem, useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { useCanvasHistory, Command } from '@/lib/hooks/use-canvas-history';
import { useSelectionBox } from '@/lib/hooks/use-selection-box';
import { useUpdateCanvasThumbnail } from '@/lib/hooks/use-canvases';
import { stripHtmlTags } from '@/lib/utils/html';
import { BookmarkItem } from '@/features/canvas/components/BookmarkItem';
import { NoteItem } from '@/features/canvas/components/NoteItem';
import { ImageItem } from '@/features/canvas/components/ImageItem';
import { CreateBookmarkDialog } from '@/features/canvas/components/CreateBookmarkDialog';
import { CreateNoteDialog } from '@/features/canvas/components/CreateNoteDialog';
import { CreateImageDialog } from '@/features/canvas/components/CreateImageDialog';
import { EditNoteDialog } from '@/features/canvas/components/EditNoteDialog';
import { EditBookmarkDialog } from '@/features/canvas/components/EditBookmarkDialog';
import { EditImageDialog } from '@/features/canvas/components/EditImageDialog';
import { CanvasHeader } from '@/features/canvas/components/CanvasHeader';
import { CanvasContextMenu, ContextMenuPosition } from '@/features/canvas/components/CanvasContextMenu';
import { SelectionBox } from '@/features/canvas/components/SelectionBox';
import { CommentsPanel } from '@/features/canvas/components/CommentsPanel';
import { SaveAsTemplateDialog } from '@/features/canvas/components/SaveAsTemplateDialog';
import { VersionHistoryDialog } from '@/features/canvas/components/VersionHistoryDialog';
import { ExportDialog, ExportFormat, ExportOptions } from '@/features/canvas/components/ExportDialog';
import { TagFilterPanel } from '@/features/canvas/components/TagFilterPanel';
import { GridOverlay, snapPositionToGrid } from '@/features/canvas/components/GridOverlay';
import { ItemType, CanvasItem } from '@/types/canvas';
import Konva from 'konva';
import { jsPDF } from 'jspdf';

const queryClient = new QueryClient();

interface CanvasPageProps {
  params: {
    canvasId: string;
  };
}

function CanvasContent({ canvasId }: { canvasId: string }) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [editNoteDialogOpen, setEditNoteDialogOpen] = useState(false);
  const [editingNoteItem, setEditingNoteItem] = useState<CanvasItem | null>(null);
  const [editBookmarkDialogOpen, setEditBookmarkDialogOpen] = useState(false);
  const [editingBookmarkItem, setEditingBookmarkItem] = useState<CanvasItem | null>(null);
  const [editImageDialogOpen, setEditImageDialogOpen] = useState(false);
  const [editingImageItem, setEditingImageItem] = useState<CanvasItem | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition | null>(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [commentsItemId, setCommentsItemId] = useState<string | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [gridVisible, setGridVisible] = useState(false);
  const [snapToGridEnabled, setSnapToGridEnabled] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [canvasName, setCanvasName] = useState('Untitled Canvas');
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const stageRef = useRef<Konva.Stage>(null);

  const GRID_SIZE = 20; // Grid cell size in pixels

  // Fetch all items for this canvas
  const { data, isLoading, error } = useCanvasItems(canvasId);
  const allItems = data?.items || [];
  const { mutateAsync: deleteItem } = useDeleteCanvasItem();
  const { mutateAsync: createItem } = useCreateCanvasItem();

  // History manager for undo/redo
  const { addCommand, undo, redo, canUndo, canRedo } = useCanvasHistory();

  // Thumbnail update
  const updateThumbnail = useUpdateCanvasThumbnail();

  // Selection box for multi-select
  const {
    isSelecting,
    selectionBox,
    startSelection,
    updateSelection,
    endSelection,
    cancelSelection,
    isItemInSelection,
  } = useSelectionBox();

  // Extract unique tags and counts from all items
  const { allTags, tagCounts } = React.useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((item) => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach((tag) => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      }
    });
    return {
      allTags: Object.keys(counts).sort(),
      tagCounts: counts,
    };
  }, [allItems]);

  // Filter items based on search query and tags
  const items = React.useMemo(() => {
    let filtered = allItems;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        if (item.type === ItemType.NOTE) {
          const noteContent = item.content as { text: string };
          // Strip HTML tags before searching
          const plainText = stripHtmlTags(noteContent.text || '');
          return plainText.toLowerCase().includes(query);
        } else if (item.type === ItemType.BOOKMARK) {
          const bookmarkContent = item.content as any;
          return (
            bookmarkContent.url?.toLowerCase().includes(query) ||
            bookmarkContent.title?.toLowerCase().includes(query) ||
            bookmarkContent.description?.toLowerCase().includes(query) ||
            bookmarkContent.siteName?.toLowerCase().includes(query)
          );
        } else if (item.type === ItemType.IMAGE) {
          const imageContent = item.content as any;
          return (
            imageContent.filename?.toLowerCase().includes(query) ||
            imageContent.alt?.toLowerCase().includes(query)
          );
        }
        return false;
      });
    }

    // Filter by selected tags (items must have ALL selected tags)
    if (selectedTags.length > 0) {
      filtered = filtered.filter((item) => {
        if (!item.tags || !Array.isArray(item.tags)) return false;
        return selectedTags.every((tag) => item.tags.includes(tag));
      });
    }

    return filtered;
  }, [allItems, searchQuery, selectedTags]);

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
      // Undo (Ctrl+Z / Cmd+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo (Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        redo();
        return;
      }

      // Delete key - delete selected item(s)
      if (e.key === 'Delete') {
        // Bulk delete if multiple items selected
        if (selectedItemIds.size > 0) {
          try {
            const itemsToDelete = allItems.filter((item) => selectedItemIds.has(item.id));

            // Create batch delete command
            const deleteCommand: Command = {
              type: 'batch',
              description: `Delete ${itemsToDelete.length} items`,
              execute: async () => {
                await Promise.all(
                  itemsToDelete.map((item) =>
                    deleteItem({
                      itemId: item.id,
                      version: item.version,
                    })
                  )
                );
              },
              undo: async () => {
                // Recreate all items
                await Promise.all(
                  itemsToDelete.map((item) =>
                    createItem({
                      canvasId,
                      type: item.type,
                      positionX: item.positionX,
                      positionY: item.positionY,
                      width: item.width,
                      height: item.height,
                      zIndex: item.zIndex,
                      content: item.content,
                      tags: item.tags || [],
                    })
                  )
                );
              },
            };

            await deleteCommand.execute();
            addCommand(deleteCommand);
            setSelectedItemIds(new Set());
          } catch (err) {
            console.error('Failed to bulk delete items:', err);
          }
        }
        // Single delete
        else if (selectedItemId) {
          const selectedItem = allItems.find((item) => item.id === selectedItemId);
          if (selectedItem) {
            try {
              // Create delete command
              const deleteCommand: Command = {
                type: 'delete',
                description: `Delete ${selectedItem.type}`,
                execute: async () => {
                  await deleteItem({
                    itemId: selectedItem.id,
                    version: selectedItem.version,
                  });
                },
                undo: async () => {
                  // Recreate the item
                  await createItem({
                    canvasId,
                    type: selectedItem.type,
                    positionX: selectedItem.positionX,
                    positionY: selectedItem.positionY,
                    width: selectedItem.width,
                    height: selectedItem.height,
                    zIndex: selectedItem.zIndex,
                    content: selectedItem.content,
                    tags: selectedItem.tags || [],
                  });
                },
              };

              await deleteCommand.execute();
              addCommand(deleteCommand);
              setSelectedItemId(null);
            } catch (err) {
              console.error('Failed to delete item:', err);
            }
          }
        }
      }
      // Escape key - deselect
      else if (e.key === 'Escape') {
        setSelectedItemId(null);
        setSelectedItemIds(new Set());
        setContextMenuPosition(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemId, allItems, deleteItem, createItem, canvasId, undo, redo, addCommand]);

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

  const handleStageMouseDown = (e: any) => {
    // Only start selection on empty canvas (not on items)
    if (e.target === e.target.getStage()) {
      const stage = e.target.getStage();
      const pointerPos = stage.getPointerPosition();
      if (pointerPos) {
        // Start selection box
        startSelection({
          x: (pointerPos.x - position.x) / zoom,
          y: (pointerPos.y - position.y) / zoom,
        });
      }
    }
  };

  const handleStageMouseMove = (e: any) => {
    if (isSelecting) {
      const stage = e.target.getStage();
      const pointerPos = stage.getPointerPosition();
      if (pointerPos) {
        updateSelection({
          x: (pointerPos.x - position.x) / zoom,
          y: (pointerPos.y - position.y) / zoom,
        });
      }
    }
  };

  const handleStageMouseUp = (e: any) => {
    if (isSelecting) {
      const finalBox = endSelection();
      if (finalBox && finalBox.width > 5 && finalBox.height > 5) {
        // Select all items in box
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
        setSelectedItemId(null); // Clear single selection
      } else {
        // Small box = click, deselect all
        setSelectedItemId(null);
        setSelectedItemIds(new Set());
      }
    }
  };

  const handleStageClick = (e: any) => {
    // Deselect if clicking on empty canvas
    if (e.target === e.target.getStage()) {
      setSelectedItemId(null);
      setSelectedItemIds(new Set());
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

  const handleNoteDoubleClick = (item: CanvasItem) => {
    if (item.type === ItemType.NOTE) {
      setEditingNoteItem(item);
      setEditNoteDialogOpen(true);
    }
  };

  const handleBookmarkDoubleClick = (item: CanvasItem) => {
    if (item.type === ItemType.BOOKMARK) {
      setEditingBookmarkItem(item);
      setEditBookmarkDialogOpen(true);
    }
  };

  const handleImageDoubleClick = (item: CanvasItem) => {
    if (item.type === ItemType.IMAGE) {
      setEditingImageItem(item);
      setEditImageDialogOpen(true);
    }
  };

  const handleDeleteFromMenu = async () => {
    if (!selectedItemId) return;
    const selectedItem = allItems.find((item) => item.id === selectedItemId);
    if (selectedItem) {
      try {
        // Create delete command
        const deleteCommand: Command = {
          type: 'delete',
          description: `Delete ${selectedItem.type}`,
          execute: async () => {
            await deleteItem({
              itemId: selectedItem.id,
              version: selectedItem.version,
            });
          },
          undo: async () => {
            // Recreate the item
            await createItem({
              canvasId,
              type: selectedItem.type,
              positionX: selectedItem.positionX,
              positionY: selectedItem.positionY,
              width: selectedItem.width,
              height: selectedItem.height,
              zIndex: selectedItem.zIndex,
              content: selectedItem.content,
              tags: selectedItem.tags || [],
            });
          },
        };

        await deleteCommand.execute();
        addCommand(deleteCommand);
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

  const handleOpenComments = () => {
    if (!selectedItemId) return;
    setCommentsItemId(selectedItemId);
    setCommentsPanelOpen(true);
  };

  const generateThumbnail = React.useCallback(() => {
    if (!stageRef.current) return;

    try {
      // Generate a small thumbnail (300x200)
      const thumbnail = stageRef.current.toDataURL({
        pixelRatio: 0.3, // Low resolution for smaller file size
        mimeType: 'image/jpeg',
        quality: 0.6,
      });

      // Save thumbnail to backend
      updateThumbnail.mutate({ canvasId, thumbnail });
    } catch (err) {
      console.error('Failed to generate thumbnail:', err);
    }
  }, [canvasId, updateThumbnail]);

  // Auto-generate thumbnail when items change (debounced)
  React.useEffect(() => {
    if (allItems.length === 0) return;

    const timeoutId = setTimeout(() => {
      generateThumbnail();
    }, 3000); // Wait 3 seconds after last change

    return () => clearTimeout(timeoutId);
  }, [allItems, generateThumbnail]);

  const handleExport = (format: ExportFormat, options: ExportOptions) => {
    switch (format) {
      case 'png':
        handleExportPNG(options);
        break;
      case 'pdf':
        handleExportPDF(options);
        break;
      case 'json':
        handleExportJSON(options);
        break;
      default:
        alert(`${format.toUpperCase()} export is not yet implemented`);
    }
  };

  const handleExportPNG = (options: ExportOptions) => {
    if (!stageRef.current) return;

    const pixelRatio = options.quality === 'low' ? 1 : options.quality === 'medium' ? 2 : 3;

    const uri = stageRef.current.toDataURL({
      pixelRatio,
    });

    // Create download link
    const link = document.createElement('a');
    link.download = `${options.filename || canvasName.replace(/\s+/g, '_')}.png`;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = (options: ExportOptions) => {
    if (!stageRef.current) return;

    try {
      // Get canvas as image
      const uri = stageRef.current.toDataURL({
        pixelRatio: 2,
      });

      // Get stage dimensions
      const width = stageRef.current.width();
      const height = stageRef.current.height();

      // Create PDF with appropriate dimensions
      const pdf = new jsPDF({
        orientation: width > height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [width, height],
      });

      // Add image to PDF
      pdf.addImage(uri, 'PNG', 0, 0, width, height);

      // Download
      pdf.save(`${options.filename || canvasName.replace(/\s+/g, '_')}.pdf`);
    } catch (err) {
      console.error('Failed to export PDF:', err);
      alert('Failed to export PDF. Please try again.');
    }
  };

  const handleExportJSON = (options: ExportOptions) => {
    try {
      // Prepare export data
      const exportData = {
        canvas: {
          id: canvasId,
          name: canvasName,
          zoomLevel: zoom,
          panX: position.x,
          panY: position.y,
          exportedAt: new Date().toISOString(),
        },
        items: allItems.map((item) => ({
          type: item.type,
          positionX: item.positionX,
          positionY: item.positionY,
          width: item.width,
          height: item.height,
          zIndex: item.zIndex,
          content: item.content,
          tags: item.tags || [],
        })),
      };

      // Convert to JSON string
      const jsonString = JSON.stringify(exportData, null, 2);

      // Create blob and download
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${options.filename || canvasName.replace(/\s+/g, '_')}.json`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export JSON:', err);
      alert('Failed to export JSON. Please try again.');
    }
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
        canvasId={canvasId}
        canvasName={canvasName}
        onCanvasNameChange={handleCanvasNameChange}
        zoom={zoom}
        onZoomChange={handleZoomChange}
        onFitToScreen={handleFitToScreen}
        onExport={() => setExportDialogOpen(true)}
        onSaveAsTemplate={() => setTemplateDialogOpen(true)}
        onVersionHistory={() => setVersionHistoryOpen(true)}
        onTagFilter={() => setTagFilterOpen(true)}
        activeTagCount={selectedTags.length}
        gridVisible={gridVisible}
        onGridToggle={() => setGridVisible(!gridVisible)}
        snapEnabled={snapToGridEnabled}
        onSnapToggle={() => setSnapToGridEnabled(!snapToGridEnabled)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      {/* Canvas */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          scaleX={zoom}
          scaleY={zoom}
          x={position.x}
          y={position.y}
          draggable={!isSelecting}
          onDragEnd={(e) => {
            setPosition({
              x: e.target.x(),
              y: e.target.y(),
            });
          }}
        >
          {/* Grid Overlay */}
          <GridOverlay
            width={stageSize.width}
            height={stageSize.height}
            gridSize={GRID_SIZE}
            visible={gridVisible}
            offset={position}
            zoom={zoom}
          />

          <Layer>
            {items.map((item) => {
              const isItemSelected = selectedItemId === item.id || selectedItemIds.has(item.id);

              if (item.type === ItemType.BOOKMARK) {
                return (
                  <BookmarkItem
                    key={item.id}
                    item={item}
                    isSelected={isItemSelected}
                    onSelect={() => setSelectedItemId(item.id)}
                    onDeselect={() => setSelectedItemId(null)}
                    onDoubleClick={() => handleBookmarkDoubleClick(item)}
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
                    isSelected={isItemSelected}
                    onSelect={() => setSelectedItemId(item.id)}
                    onDoubleClick={() => handleNoteDoubleClick(item)}
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
              } else if (item.type === ItemType.IMAGE) {
                return (
                  <ImageItem
                    key={item.id}
                    item={item}
                    isSelected={isItemSelected}
                    onSelect={() => setSelectedItemId(item.id)}
                    onDoubleClick={() => handleImageDoubleClick(item)}
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

            {/* Selection Box */}
            {selectionBox && (
              <SelectionBox
                x={selectionBox.x}
                y={selectionBox.y}
                width={selectionBox.width}
                height={selectionBox.height}
              />
            )}
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
        <SpeedDialAction
          icon={<Image />}
          tooltipTitle="Add Image"
          onClick={() => setImageDialogOpen(true)}
          data-testid="add-image-button"
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

      {/* Create Image Dialog */}
      <CreateImageDialog
        open={imageDialogOpen}
        onClose={() => setImageDialogOpen(false)}
        canvasId={canvasId}
        initialPosition={{ x: 300, y: 300 }}
      />

      {/* Edit Note Dialog */}
      <EditNoteDialog
        open={editNoteDialogOpen}
        onClose={() => {
          setEditNoteDialogOpen(false);
          setEditingNoteItem(null);
        }}
        item={editingNoteItem}
      />

      {/* Edit Bookmark Dialog */}
      <EditBookmarkDialog
        open={editBookmarkDialogOpen}
        onClose={() => {
          setEditBookmarkDialogOpen(false);
          setEditingBookmarkItem(null);
        }}
        item={editingBookmarkItem}
      />

      {/* Edit Image Dialog */}
      <EditImageDialog
        open={editImageDialogOpen}
        onClose={() => {
          setEditImageDialogOpen(false);
          setEditingImageItem(null);
        }}
        item={editingImageItem}
      />

      {/* Context Menu */}
      <CanvasContextMenu
        position={contextMenuPosition}
        onClose={() => setContextMenuPosition(null)}
        onDelete={handleDeleteFromMenu}
        onDuplicate={handleDuplicate}
        onCopy={handleCopy}
        onComments={handleOpenComments}
      />

      {/* Comments Panel */}
      {commentsItemId && (
        <CommentsPanel
          open={commentsPanelOpen}
          onClose={() => {
            setCommentsPanelOpen(false);
            setCommentsItemId(null);
          }}
          itemId={commentsItemId}
          itemType={allItems.find((item) => item.id === commentsItemId)?.type || 'NOTE'}
        />
      )}

      {/* Save as Template Dialog */}
      <SaveAsTemplateDialog
        open={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        canvasId={canvasId}
        canvasName={canvasName}
      />

      {/* Version History Dialog */}
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
        canvasId={canvasId}
      />

      {/* Export Dialog */}
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onExport={handleExport}
        canvasName={canvasName}
      />

      {/* Tag Filter Panel */}
      <TagFilterPanel
        open={tagFilterOpen}
        onClose={() => setTagFilterOpen(false)}
        allTags={allTags}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
        tagCounts={tagCounts}
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
