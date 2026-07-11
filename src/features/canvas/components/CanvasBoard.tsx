"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Stage } from "react-konva";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  Alert,
  Box,
  Button,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  NoteAdd,
  Bookmark,
  Image as ImageIcon,
  Poll,
} from "@mui/icons-material";
import { useSession } from "next-auth/react";
import {
  useDeleteCanvasItem,
  useCreateCanvasItem,
  useUpdateCanvasItem,
  canvasItemKeys,
} from "@/lib/hooks/use-canvas-items";
import { useQueryClient } from "@tanstack/react-query";
import { useCanvasHistory } from "@/lib/hooks/use-canvas-history";
import type { Command } from "@/lib/hooks/use-canvas-history";
import { useSelectionBox } from "@/lib/hooks/use-selection-box";
import { useUpdateCanvasThumbnail } from "@/lib/hooks/use-canvases";
import { useCollaboration } from "@/lib/hooks/use-collaboration";
import { useVirtualItems } from "@/lib/hooks/use-virtual-items";
import { useRestoreVersion } from "@/lib/hooks/use-canvas-versions"; // Only restore needed
import { useCanvasData } from "@/features/canvas/hooks/use-canvas-data";
import { useCanvasInteraction } from "@/features/canvas/hooks/use-canvas-interaction";
import { useCanvasKeyboard } from "@/features/canvas/hooks/use-canvas-keyboard";

import { TimeMachineControl } from "@/features/canvas/components/TimeMachineControl";
import { CanvasDialogs } from "@/features/canvas/components/CanvasDialogs";
import { calculateAutopilotLayout } from "@/lib/ai/autopilot-service";
import { confirmDialog } from "@/stores/confirmStore";

import { useGesture } from "@use-gesture/react";
import type Konva from "konva";

import type { CanvasItem } from "@/types/canvas";
import { ItemType, isNoteContent } from "@/types/canvas";

// Components
import { CanvasItemLayer } from "@/features/canvas/components/CanvasItemLayer";
import type { ContextMenuPosition } from "@/features/canvas/components/CanvasContextMenu";
import { DrawingToolbar } from "@/features/canvas/components/DrawingToolbar";
import { CanvasHeader } from "@/features/canvas/components/CanvasHeader";
import { GridOverlay } from "@/features/canvas/components/GridOverlay";
import { CursorChat } from "@/features/canvas/components/CursorChat";
import { ReactionSelector } from "@/features/canvas/components/ReactionSelector";
import { RemoteCursorChat } from "@/features/canvas/components/RemoteCursorChat";
import { RemoteReaction } from "@/features/canvas/components/RemoteReaction";
import { AlignmentToolbar } from "@/features/canvas/components/AlignmentToolbar";
import { MainToolbar } from "@/features/canvas/components/MainToolbar";
import { CanvasOrganizerView } from "@/features/canvas/components/CanvasOrganizerView";

interface CanvasBoardProps {
  canvasId: string;
}

/** Marker so paste only acts on our own copied canvas items, not arbitrary clipboard text */
const CANVAS_CLIPBOARD_SOURCE = "memoria-canvas-item";

export function CanvasBoard({ canvasId }: CanvasBoardProps) {
  // Refs
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const theme = useTheme();

  // Data Hook (Single source of truth for display)
  const {
    items,
    allItems,
    versions,
    allTags,
    tagCounts,
    canvasName,
    zoom,
    setZoom,
    position,
    setPosition,
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    canvasLoadError,
    isTimeMachineActive,
    setTimeMachineActive,
    timeMachineIndex,
    setTimeMachineIndex,
    updateCanvasName,
    refreshMetadata,
    dismissLoadError,
  } = useCanvasData({ canvasId });

  // Store state
  const {
    gridVisible,
    setGridVisible,
    snapToGrid: snapToGridEnabled,
    setSnapToGrid: setSnapToGridEnabled,
    activeTool,
  } = useCanvasStore();

  // Mutations
  const { mutateAsync: deleteItem } = useDeleteCanvasItem();
  const { mutateAsync: createItem } = useCreateCanvasItem();
  const { mutate: updateItem } = useUpdateCanvasItem();
  const updateThumbnail = useUpdateCanvasThumbnail();
  const { mutateAsync: restoreVersion } = useRestoreVersion();

  // History
  const { addCommand, undo, redo, canUndo, canRedo } = useCanvasHistory();

  // Selection Hook
  const {
    isSelecting,
    selectionBox,
    startSelection,
    updateSelection,
    endSelection,
    isItemInSelection,
  } = useSelectionBox();

  // UI Dialog & Interaction State
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [serendipityOpen, setSerendipityOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [whisperOpen, setWhisperOpen] = useState(false);
  const [arOpen, setAROpen] = useState(false);

  // Item Dialogs
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);

  // Edit Dialogs
  const [editNoteDialogOpen, setEditNoteDialogOpen] = useState(false);
  const [editingNoteItem, setEditingNoteItem] = useState<CanvasItem | null>(
    null,
  );
  const [editBookmarkDialogOpen, setEditBookmarkDialogOpen] = useState(false);
  const [editingBookmarkItem, setEditingBookmarkItem] =
    useState<CanvasItem | null>(null);
  const [editImageDialogOpen, setEditImageDialogOpen] = useState(false);
  const [editingImageItem, setEditingImageItem] = useState<CanvasItem | null>(
    null,
  );

  // Selection & Context Menu
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    new Set(),
  );
  const [contextMenuPosition, setContextMenuPosition] =
    useState<ContextMenuPosition | null>(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [commentsItemId, setCommentsItemId] = useState<string | null>(null);

  // Chat / Reactions Logic
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPosition, setChatPosition] = useState({ x: 0, y: 0 });
  const [reactionOpen, setReactionOpen] = useState(false);
  const [reactionPosition, setReactionPosition] = useState({ x: 0, y: 0 });
  const [remoteMessages, setRemoteMessages] = useState<any[]>([]);
  const [remoteReactions, setRemoteReactions] = useState<any[]>([]);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"manual" | "organizer">("manual");

  // Interaction Hook (Stage Events)
  const {
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleStageClick,
    isDrawing,
  } = useCanvasInteraction({
    canvasId,
    stageRef: stageRef as React.RefObject<Konva.Stage>,
    activeTool,
    zoom,
    position,
    isSelecting,
    startSelection,
    updateSelection,
    endSelection,
    isItemInSelection,
    items, // Use filtered items for selection
    setSelectedItemIds,
    setSelectedItemId,
  });

  // Keyboard Hook
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  useCanvasKeyboard({
    onDelete: async () => {
      // Delete Logic
      if (selectedItemIds.size > 0) {
        try {
          const itemsToDelete = allItems.filter((item) =>
            selectedItemIds.has(item.id),
          );
          const deleteCommand: Command = {
            type: "delete",
            description: `Delete ${itemsToDelete.length} items`,
            execute: async () => {
              await Promise.all(
                itemsToDelete.map((item) =>
                  deleteItem({ itemId: item.id, version: item.version }),
                ),
              );
            },
            undo: async () => {
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
                  }),
                ),
              );
            },
          };
          await deleteCommand.execute();
          addCommand(deleteCommand);
          setSelectedItemIds(new Set());
        } catch (err) {
          console.error("Failed to bulk delete items:", err);
        }
      } else if (selectedItemId) {
        const selectedItem = allItems.find(
          (item) => item.id === selectedItemId,
        );
        if (selectedItem) {
          try {
            const deleteCommand: Command = {
              type: "delete",
              description: `Delete ${selectedItem.type}`,
              execute: async () => {
                await deleteItem({
                  itemId: selectedItem.id,
                  version: selectedItem.version,
                });
              },
              undo: async () => {
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
            console.error("Failed to delete item:", err);
          }
        }
      }
    },
    onUndo: undo,
    onRedo: redo,
    onCopy: () => {
      if (!selectedItemId) return;
      const selectedItem = allItems.find((item) => item.id === selectedItemId);
      if (selectedItem) {
        const copyData = {
          source: CANVAS_CLIPBOARD_SOURCE,
          type: selectedItem.type,
          content: selectedItem.content,
          width: selectedItem.width,
          height: selectedItem.height,
          tags: selectedItem.tags || [],
        };
        navigator.clipboard.writeText(JSON.stringify(copyData));
      }
    },
    onPaste: async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          return; // Not a copied canvas item
        }
        if (!data || data.source !== CANVAS_CLIPBOARD_SOURCE || !data.type) {
          return;
        }
        const width = typeof data.width === "number" ? data.width : 300;
        const height = typeof data.height === "number" ? data.height : 200;
        const centerX = (-position.x + stageSize.width / 2) / zoom;
        const centerY = (-position.y + stageSize.height / 2) / zoom;
        await createItem({
          canvasId,
          type: data.type,
          positionX: centerX - width / 2 + 20,
          positionY: centerY - height / 2 + 20,
          width,
          height,
          zIndex: allItems.length + 1,
          content: data.content,
          tags: Array.isArray(data.tags) ? data.tags : [],
        });
      } catch (err) {
        console.error("Failed to paste item:", err);
      }
    },
    onSelectAll: () => {
      const allIds = new Set(items.map((item) => item.id));
      setSelectedItemIds(allIds);
      setSelectedItemId(null);
    },
    onDuplicate: async () => {
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
            tags: selectedItem.tags || [],
          });
        } catch (err) {
          console.error("Failed to duplicate item:", err);
        }
      }
    },
    onEscape: () => {
      setSelectedItemId(null);
      setSelectedItemIds(new Set());
      setContextMenuPosition(null);
    },
    enabled: !isDrawing,
    isDrawing,
    stageRef: stageRef as React.RefObject<Konva.Stage>,
    onChatOpen: (pos) => {
      setChatPosition(pos);
      setChatOpen(true);
    },
    onReactionOpen: (pos) => {
      setReactionPosition(pos);
      setReactionOpen(true);
    },
    selectedItemIds,
    selectedItemId,
    allItems, // Use all items for finding targets
    updateItem,
  });

  // Screen Size
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const updateSize = () => {
      setStageSize({
        width: window.innerWidth,
        height: window.innerHeight - 64, // Header
      });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Gesture (Zoom)
  useGesture(
    {
      onPinch: ({ offset: [d] }) => {
        setZoom(d);
      },
    },
    {
      target: containerRef,
      pinch: { scaleBounds: { min: 0.1, max: 5 }, from: () => [zoom, 0] },
      drag: { enabled: false },
    },
  );

  // Collaboration
  const { data: session } = useSession();

  const handleRemoteMessage = useCallback((message: any) => {
    if (message.type === "chat") {
      const id = Date.now().toString() + Math.random().toString();
      setRemoteMessages((prev) => [...prev, { ...message, id }]);
      setTimeout(() => {
        setRemoteMessages((prev) => prev.filter((m) => m.id !== id));
      }, 5000);
    } else if (message.type === "reaction") {
      const id = Date.now().toString() + Math.random().toString();
      setRemoteReactions((prev) => [...prev, { ...message, id }]);
      setTimeout(() => {
        setRemoteReactions((prev) => prev.filter((r) => r.id !== id));
      }, 3000);
    }
  }, []);

  const {
    users: collaborators,
    cursors,
    connected: collaborationConnected,
    status: collaborationStatus,
    broadcastMessage,
  } = useCollaboration({
    canvasId,
    name: session?.user?.name || "Anonymous",
    userId: session?.user?.id || "anon",
    email: session?.user?.email || "anon@example.com",
    onMessage: handleRemoteMessage,
  });

  // Server-assigned presence color, so chat bubbles match the cursor color
  const ownPresenceColor =
    collaborators.find((user) => user.userId === session?.user?.id)?.color ||
    "#f00";

  // Follow Mode
  useEffect(() => {
    if (followingUserId) {
      const targetCursor = cursors.find((c) => c.userId === followingUserId);
      if (targetCursor) {
        const newX = window.innerWidth / 2 - targetCursor.position.x * zoom;
        const newY = window.innerHeight / 2 - targetCursor.position.y * zoom;
        setPosition({ x: newX, y: newY });
      }
    }
  }, [cursors, followingUserId, zoom, setPosition]);

  // Space Key
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      // Never hijack Space while typing, but always clear on keyup so pan
      // mode can't get stuck if focus moved into an input mid-press.
      if (e.type === "keyup") {
        setIsSpacePressed(false);
      } else if (!isTypingTarget(e.target)) {
        setIsSpacePressed(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
    };
  }, []);

  // Handlers
  const handleAddNoteFromAI = (text: string) => {
    const centerX = (-position.x + stageSize.width / 2) / zoom;
    const centerY = (-position.y + stageSize.height / 2) / zoom;

    createItem({
      canvasId,
      type: ItemType.NOTE,
      positionX: centerX - 150,
      positionY: centerY - 100,
      width: 300,
      height: 200,
      zIndex: 100,
      tags: ["ai-generated"],
      content: { text: text },
    });
  };

  const getAIContext = () => {
    return allItems
      .filter((item) => isNoteContent(item.content))
      .map((item) => (item.content as { text?: string }).text || "")
      .filter(Boolean)
      .join("\n\n");
  };

  const handleAddSerendipityItems = async (items: any[]) => {
    for (const item of items) {
      await createItem({
        content: item.content,
        type: item.type,
        positionX: -position.x + stageSize.width / 2 + Math.random() * 100,
        positionY: -position.y + stageSize.height / 2 + Math.random() * 100,
        width: 300,
        height: 200,
        canvasId: canvasId,
        zIndex: allItems.length + 1,
        tags: [],
      });
    }
  };

  const handleSelectTemplate = async (items: any[]) => {
    for (const item of items) {
      await createItem({
        content: item.content,
        type: item.type,
        positionX: item.positionX - position.x + stageSize.width / 2,
        positionY: item.positionY - position.y + stageSize.height / 2,
        width: item.width,
        height: item.height,
        canvasId: canvasId,
        zIndex: allItems.length + 1,
        tags: [],
      });
    }
  };

  const handleWhisperSend = async (text: string) => {
    await createItem({
      content: { text },
      type: ItemType.NOTE,
      positionX: -position.x + stageSize.width / 2,
      positionY: -position.y + stageSize.height / 2,
      width: 300,
      height: 200,
      canvasId: canvasId,
      zIndex: allItems.length + 1,
      tags: ["whisper"],
    });
    setWhisperOpen(false);
  };

  const handleDragEnd = (
    e: Konva.KonvaEventObject<DragEvent>,
    item: CanvasItem,
  ) => {
    updateItem({
      itemId: item.id,
      data: {
        positionX: e.target.x(),
        positionY: e.target.y(),
        version: item.version,
      },
    });
  };

  const generateThumbnail = useCallback(() => {
    if (!stageRef.current) return;
    try {
      const thumbnail = stageRef.current.toDataURL({
        pixelRatio: 0.3,
        mimeType: "image/jpeg",
        quality: 0.6,
      });
      updateThumbnail.mutate({ canvasId, thumbnail });
    } catch (err) {
      console.error("Failed to generate thumbnail:", err);
    }
  }, [canvasId, updateThumbnail]);

  useEffect(() => {
    if (allItems.length === 0) return;
    const timeoutId = setTimeout(() => {
      generateThumbnail();
    }, 3000);
    return () => clearTimeout(timeoutId);
  }, [allItems, generateThumbnail]);

  const handleContextMenu = (
    e: React.MouseEvent | Konva.KonvaEventObject<MouseEvent>,
    itemId: string,
  ) => {
    if ("evt" in e) {
      e.evt.preventDefault();
      setContextMenuPosition({ x: e.evt.clientX, y: e.evt.clientY });
    } else {
      e.preventDefault();
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
    }
    setSelectedItemId(itemId);
  };

  const handleNoteDoubleClick = (item: CanvasItem) => {
    if (item.type === ItemType.NOTE || item.type === ItemType.TEXT) {
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
  const handleOpenComments = () => {
    if (!selectedItemId) return;
    setCommentsItemId(selectedItemId);
    setCommentsPanelOpen(true);
  };

  const handleDeleteFromMenu = () => {
    if (!selectedItemId) return;
    const selectedItem = allItems.find((item) => item.id === selectedItemId);
    if (selectedItem) {
      deleteItem({ itemId: selectedItemId, version: selectedItem.version });
    }
  };

  const handleDuplicateFromMenu = () => {
    if (!selectedItemId) return;
    const selectedItem = allItems.find((item) => item.id === selectedItemId);
    if (!selectedItem) return;
    createItem({
      canvasId,
      type: selectedItem.type,
      positionX: selectedItem.positionX + 20,
      positionY: selectedItem.positionY + 20,
      width: selectedItem.width,
      height: selectedItem.height,
      zIndex: selectedItem.zIndex,
      content: selectedItem.content,
      tags: selectedItem.tags || [],
    });
  };

  const handleCopyFromMenu = () => {
    if (!selectedItemId) return;
    const selectedItem = allItems.find((item) => item.id === selectedItemId);
    if (!selectedItem) return;
    const copyData = {
      source: CANVAS_CLIPBOARD_SOURCE,
      type: selectedItem.type,
      content: selectedItem.content,
      width: selectedItem.width,
      height: selectedItem.height,
      tags: selectedItem.tags || [],
    };
    navigator.clipboard.writeText(JSON.stringify(copyData));
  };

  const handleSelectItem = (id: string, multi: boolean = false) => {
    if (multi) {
      const newSet = new Set(selectedItemIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      setSelectedItemIds(newSet);
      setSelectedItemId(null);
    } else {
      setSelectedItemId(id);
      setSelectedItemIds(new Set([id]));
    }
  };

  const handleItemChange = (
    id: string,
    data: Partial<
      Pick<
        CanvasItem,
        "positionX" | "positionY" | "width" | "height" | "content" | "zIndex"
      >
    >,
  ) => {
    const item = allItems.find((i) => i.id === id);
    if (item) {
      updateItem({
        itemId: id,
        data: {
          ...data,
          version: item.version,
        },
      });
    }
  };

  // Alignment Handlers (Copy/Paste from original)
  const handleAlign = (
    type: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) => {
    if (selectedItemIds.size < 2) return;
    const selectedItems = allItems.filter((item) =>
      selectedItemIds.has(item.id),
    );
    if (selectedItems.length === 0) return;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    selectedItems.forEach((item) => {
      minX = Math.min(minX, item.positionX);
      maxX = Math.max(maxX, item.positionX + item.width);
      minY = Math.min(minY, item.positionY);
      maxY = Math.max(maxY, item.positionY + item.height);
    });
    const centerX = minX + (maxX - minX) / 2;
    const centerY = minY + (maxY - minY) / 2;
    selectedItems.forEach((item) => {
      let newX = item.positionX;
      let newY = item.positionY;
      switch (type) {
        case "left":
          newX = minX;
          break;
        case "center":
          newX = centerX - item.width / 2;
          break;
        case "right":
          newX = maxX - item.width;
          break;
        case "top":
          newY = minY;
          break;
        case "middle":
          newY = centerY - item.height / 2;
          break;
        case "bottom":
          newY = maxY - item.height;
          break;
      }
      if (newX !== item.positionX || newY !== item.positionY) {
        updateItem({
          itemId: item.id,
          data: { positionX: newX, positionY: newY, version: item.version },
        });
      }
    });
  };
  const handleDistribute = (type: "horizontal" | "vertical") => {
    if (selectedItemIds.size < 3) return;
    const selectedItems = allItems.filter((item) =>
      selectedItemIds.has(item.id),
    );
    if (type === "horizontal") {
      selectedItems.sort((a, b) => a.positionX - b.positionX);
      const first = selectedItems[0];
      const last = selectedItems[selectedItems.length - 1];
      if (!first || !last) return;
      const totalWidth = last.positionX + last.width - first.positionX;
      const itemsWidth = selectedItems.reduce(
        (acc, item) => acc + item.width,
        0,
      );
      const gap = (totalWidth - itemsWidth) / (selectedItems.length - 1);
      let currentX = first.positionX;
      selectedItems.forEach((item, index) => {
        if (index > 0 && index < selectedItems.length) {
          updateItem({
            itemId: item.id,
            data: { positionX: currentX, version: item.version },
          });
        }
        currentX += item.width + gap;
      });
    } else {
      selectedItems.sort((a, b) => a.positionY - b.positionY);
      const first = selectedItems[0];
      const last = selectedItems[selectedItems.length - 1];
      if (!first || !last) return;
      const totalHeight = last.positionY + last.height - first.positionY;
      const itemsHeight = selectedItems.reduce(
        (acc, item) => acc + item.height,
        0,
      );
      const gap = (totalHeight - itemsHeight) / (selectedItems.length - 1);
      let currentY = first.positionY;
      selectedItems.forEach((item, index) => {
        if (index > 0 && index < selectedItems.length) {
          updateItem({
            itemId: item.id,
            data: { positionY: currentY, version: item.version },
          });
        }
        currentY += item.height + gap;
      });
    }
  };

  // Virtualization
  const renderedItems = useVirtualItems(
    items.map((item) => ({
      ...item,
      x: item.positionX,
      y: item.positionY,
    })),
    {
      viewport: {
        x: position.x,
        y: position.y,
        width: stageSize.width,
        height: stageSize.height,
      },
      zoom,
      padding: 500,
    },
  );

  return (
    <Box
      ref={containerRef}
      sx={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <CanvasHeader
        canvasId={canvasId}
        canvasName={canvasName}
        onCanvasNameChange={updateCanvasName}
        zoom={zoom}
        onZoomChange={setZoom}
        onFitToScreen={() => {
          setZoom(1);
          setPosition({ x: 0, y: 0 });
        }}
        onExport={() => setExportDialogOpen(true)}
        onSaveAsTemplate={() => setTemplateDialogOpen(true)}
        onVersionHistory={() => setVersionHistoryOpen(true)}
        onTagFilter={() => setTagFilterOpen(true)}
        onAI={() => setAiDialogOpen(true)}
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
        collaborators={collaborators}
        collaborationConnected={collaborationConnected}
        collaborationStatus={collaborationStatus}
        onFollowUser={(userId: string) =>
          setFollowingUserId(userId === followingUserId ? null : userId)
        }
        followingUserId={followingUserId}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onTimeMachine={() => {
          setTimeMachineActive(!isTimeMachineActive);
          if (!isTimeMachineActive && versions.length > 0) {
            setTimeMachineIndex(versions.length - 1);
          }
        }}
        onSerendipity={() => setSerendipityOpen(true)}
        onTemplates={() => setTemplatesOpen(true)}
        onAutopilot={async () => {
          const actions = await calculateAutopilotLayout(allItems);
          if (
            actions.length > 0 &&
            (await confirmDialog({
              title: "Autopilot",
              message: `Autopilot will reorganize ${actions.length} items. Continue?`,
              confirmText: "Reorganize",
            }))
          ) {
            for (const action of actions) {
              const item = allItems.find((i) => i.id === action.itemId);
              if (item) {
                await updateItem({
                  itemId: action.itemId,
                  data: {
                    version: item.version,
                    positionX: action.newPosition.x,
                    positionY: action.newPosition.y,
                  },
                });
              }
            }
          }
        }}
        onWhisper={() => setWhisperOpen(true)}
        onAR={() => setAROpen(true)}
      />

      {canvasLoadError && (
        <Box sx={{ px: 2, py: 1 }}>
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => refreshMetadata()}
              >
                Retry
              </Button>
            }
            onClose={dismissLoadError}
          >
            {canvasLoadError}
          </Alert>
        </Box>
      )}

      {viewMode === "manual" && <MainToolbar />}
      {viewMode === "manual" && activeTool === "draw" && <DrawingToolbar />}

      {viewMode === "organizer" ? (
        <CanvasOrganizerView canvasId={canvasId} items={allItems} />
      ) : (
        <Box
          sx={{
            flexGrow: 1,
            position: "relative",
            overflow: "hidden",
            cursor: isDrawing ? "crosshair" : "default",
            bgcolor: "background.default",
          }}
        >
          {!isDrawing && (
            <SpeedDial
              ariaLabel="Add Item"
              sx={{ position: "absolute", bottom: 16, right: 16 }}
              icon={<SpeedDialIcon />}
            >
              <SpeedDialAction
                icon={<NoteAdd />}
                tooltipTitle="Note"
                onClick={() => setNoteDialogOpen(true)}
              />
              <SpeedDialAction
                icon={<Bookmark />}
                tooltipTitle="Bookmark"
                onClick={() => setBookmarkDialogOpen(true)}
              />
              <SpeedDialAction
                icon={<ImageIcon />}
                tooltipTitle="Image"
                onClick={() => setImageDialogOpen(true)}
              />
              <SpeedDialAction
                icon={<Poll />}
                tooltipTitle="Poll"
                onClick={() => setPollDialogOpen(true)}
              />
            </SpeedDial>
          )}

          <Stage
            width={stageSize.width}
            height={stageSize.height}
            scaleX={zoom}
            scaleY={zoom}
            x={position.x}
            y={position.y}
            draggable={!isDrawing && !isSpacePressed && !isTimeMachineActive}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onClick={handleStageClick}
            ref={stageRef}
            onContextMenu={(e) => e.evt.preventDefault()}
          >
            <GridOverlay
              width={stageSize.width}
              height={stageSize.height}
              zoom={zoom}
              gridSize={20}
              offset={{ x: -position.x / zoom, y: -position.y / zoom }}
              visible={gridVisible}
              stroke={theme.palette.divider}
            />
            <CanvasItemLayer
              items={renderedItems}
              selectedItemIds={selectedItemIds}
              isSelecting={isSelecting}
              selectionBox={selectionBox}
              onSelectItem={(id) => handleSelectItem(id, false)}
              onContextMenu={handleContextMenu}
              onNoteDoubleClick={handleNoteDoubleClick}
              onBookmarkDoubleClick={handleBookmarkDoubleClick}
              onImageDoubleClick={handleImageDoubleClick}
              onDragEnd={handleDragEnd}
              onItemChange={handleItemChange}
            />
          </Stage>

          {chatOpen && (
            <CursorChat
              x={chatPosition.x}
              y={chatPosition.y}
              onSendMessage={(msg) => {
                const stage = stageRef.current;
                if (stage) {
                  const ptr = stage.getPointerPosition();
                  if (ptr) {
                    const canvasX = (ptr.x - position.x) / zoom;
                    const canvasY = (ptr.y - position.y) / zoom;
                    broadcastMessage({
                      type: "chat",
                      content: msg,
                      x: canvasX,
                      y: canvasY,
                      userName: session?.user?.name || "Anonymous",
                      userColor: ownPresenceColor,
                    });
                  }
                }
                setChatOpen(false);
              }}
              onClose={() => setChatOpen(false)}
            />
          )}

          {reactionOpen && (
            <ReactionSelector
              x={reactionPosition.x}
              y={reactionPosition.y}
              onSelect={(emoji) => {
                const stage = stageRef.current;
                if (stage) {
                  const ptr = stage.getPointerPosition();
                  if (ptr) {
                    const canvasX = (ptr.x - position.x) / zoom;
                    const canvasY = (ptr.y - position.y) / zoom;
                    broadcastMessage({
                      type: "reaction",
                      emoji: emoji,
                      x: canvasX,
                      y: canvasY,
                      userName: session?.user?.name || "Anonymous",
                    });
                  }
                }
                setReactionOpen(false);
              }}
              onClose={() => setReactionOpen(false)}
            />
          )}

          {remoteMessages.map((msg) => {
            const screenX = msg.x * zoom + position.x;
            const screenY = msg.y * zoom + position.y;
            return (
              <RemoteCursorChat
                key={msg.id}
                x={screenX}
                y={screenY}
                message={msg.content}
                senderName={msg.userName}
                color={msg.userColor}
              />
            );
          })}

          {remoteReactions.map((reaction) => {
            const screenX = reaction.x * zoom + position.x;
            const screenY = reaction.y * zoom + position.y;
            return (
              <RemoteReaction
                key={reaction.id}
                x={screenX}
                y={screenY}
                emoji={reaction.emoji}
                senderName={reaction.userName}
              />
            );
          })}

          {selectedItemIds.size > 1 && (
            <Box
              sx={{
                position: "absolute",
                top: 80,
                display: "flex",
                justifyContent: "center",
                width: "100%",
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              <Box sx={{ pointerEvents: "auto" }}>
                <AlignmentToolbar
                  onAlign={handleAlign}
                  onDistribute={handleDistribute}
                />
              </Box>
            </Box>
          )}

          {isDrawing && (
            <Box
              sx={{
                position: "absolute",
                top: 140,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 10,
              }}
            >
              <DrawingToolbar />
            </Box>
          )}
        </Box>
      )}

      <CanvasDialogs
        canvasId={canvasId}
        canvasName={canvasName}
        items={allItems}
        stageRef={stageRef as React.RefObject<Konva.Stage>}
        collaborators={collaborators}
        noteDialogOpen={noteDialogOpen}
        setNoteDialogOpen={setNoteDialogOpen}
        bookmarkDialogOpen={bookmarkDialogOpen}
        setBookmarkDialogOpen={setBookmarkDialogOpen}
        imageDialogOpen={imageDialogOpen}
        setImageDialogOpen={setImageDialogOpen}
        pollDialogOpen={pollDialogOpen}
        setPollDialogOpen={setPollDialogOpen}
        editNoteDialogOpen={editNoteDialogOpen}
        setEditNoteDialogOpen={setEditNoteDialogOpen}
        editingNoteItem={editingNoteItem}
        setEditingNoteItem={setEditingNoteItem}
        editBookmarkDialogOpen={editBookmarkDialogOpen}
        setEditBookmarkDialogOpen={setEditBookmarkDialogOpen}
        editingBookmarkItem={editingBookmarkItem}
        setEditingBookmarkItem={setEditingBookmarkItem}
        editImageDialogOpen={editImageDialogOpen}
        setEditImageDialogOpen={setEditImageDialogOpen}
        editingImageItem={editingImageItem}
        setEditingImageItem={setEditingImageItem}
        templateDialogOpen={templateDialogOpen}
        setTemplateDialogOpen={setTemplateDialogOpen}
        versionHistoryOpen={versionHistoryOpen}
        setVersionHistoryOpen={setVersionHistoryOpen}
        exportDialogOpen={exportDialogOpen}
        setExportDialogOpen={setExportDialogOpen}
        tagFilterOpen={tagFilterOpen}
        setTagFilterOpen={setTagFilterOpen}
        allTags={allTags || []}
        selectedTags={selectedTags}
        setSelectedTags={setSelectedTags}
        tagCounts={tagCounts || {}}
        contextMenuPosition={contextMenuPosition}
        setContextMenuPosition={setContextMenuPosition}
        onDeleteFromMenu={handleDeleteFromMenu}
        onDuplicate={handleDuplicateFromMenu}
        onCopy={handleCopyFromMenu}
        onOpenComments={handleOpenComments}
        commentsPanelOpen={commentsPanelOpen}
        setCommentsPanelOpen={setCommentsPanelOpen}
        commentsItemId={commentsItemId}
        setCommentsItemId={setCommentsItemId}
        aiDialogOpen={aiDialogOpen}
        setAiDialogOpen={setAiDialogOpen}
        onAddNoteFromAI={handleAddNoteFromAI}
        getAIContext={getAIContext}
        serendipityOpen={serendipityOpen}
        setSerendipityOpen={setSerendipityOpen}
        onAddSerendipityItems={handleAddSerendipityItems}
        templatesOpen={templatesOpen}
        setTemplatesOpen={setTemplatesOpen}
        onSelectTemplate={handleSelectTemplate}
        whisperOpen={whisperOpen}
        setWhisperOpen={setWhisperOpen}
        onWhisperSend={handleWhisperSend}
        arOpen={arOpen}
        setAROpen={setAROpen}
      />

      {isTimeMachineActive && (
        <TimeMachineControl
          versions={versions}
          currentIndex={timeMachineIndex}
          onChange={setTimeMachineIndex}
          onExit={() => setTimeMachineActive(false)}
          onRestore={async (version) => {
            const confirmed = await confirmDialog({
              title: "Restore version",
              message:
                "Restore the canvas to this version? The current state will be replaced.",
              confirmText: "Restore",
              destructive: true,
            });
            if (confirmed) {
              await restoreVersion({ canvasId, versionId: version.id });
              setTimeMachineActive(false);
              queryClient.invalidateQueries({
                queryKey: canvasItemKeys.list(canvasId),
              });
            }
          }}
        />
      )}
    </Box>
  );
}
