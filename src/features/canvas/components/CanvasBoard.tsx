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
  useTheme,
} from "@mui/material";
import { NoteAdd, Bookmark, Image as ImageIcon } from "@mui/icons-material";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import {
  useDeleteCanvasItem,
  useCreateCanvasItem,
  useUpdateCanvasItem,
  canvasItemKeys,
  mergeCommittedCanvasItemEvent,
  type CommittedCanvasItemEvent,
} from "@/lib/hooks/use-canvas-items";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectionBox } from "@/lib/hooks/use-selection-box";
import { useUpdateCanvasThumbnail } from "@/lib/hooks/use-canvases";
import { useCollaboration } from "@/lib/hooks/use-collaboration";
import { useVirtualItems } from "@/lib/hooks/use-virtual-items";
import { useRestoreVersion } from "@/lib/hooks/use-canvas-versions"; // Only restore needed
import { useCanvasData } from "@/features/canvas/hooks/use-canvas-data";
import { useCanvasInteraction } from "@/features/canvas/hooks/use-canvas-interaction";
import { useCanvasKeyboard } from "@/features/canvas/hooks/use-canvas-keyboard";
import { useItemGeometry } from "@/features/canvas/hooks/use-item-geometry";

import { TimeMachineControl } from "@/features/canvas/components/TimeMachineControl";
import { CanvasDialogs } from "@/features/canvas/components/CanvasDialogs";
import { calculateAutopilotLayout } from "@/lib/ai/autopilot-service";

import { useGesture } from "@use-gesture/react";
import type Konva from "konva";
import { toast } from "sonner";

import type {
  CanvasAccessLevel,
  CanvasItem,
  ItemGeometryCommit,
} from "@/types/canvas";
import {
  ItemType,
  isNoteContent,
  resolveCanvasCapabilities,
} from "@/types/canvas";

// Components
import { CanvasItemLayer } from "@/features/canvas/components/CanvasItemLayer";
import { CanvasAccessiblePanel } from "@/features/canvas/components/CanvasAccessiblePanel";
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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isArCanvasEnabled } from "@/lib/product-surfaces";
import { isVersionConflict } from "@/lib/api/fetch-client";

interface CanvasBoardProps {
  canvasId: string;
}

export function CanvasBoard({ canvasId }: CanvasBoardProps) {
  // Refs
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const focusedItemRef = useRef<string | null>(null);
  const theme = useTheme();
  const gridStroke = theme.palette.mode === "light" ? "#e0e0e0" : "#1e293b";

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
    clearCanvasLoadError,
    isTimeMachineActive,
    setTimeMachineActive,
    timeMachineIndex,
    setTimeMachineIndex,
    updateCanvasName,
    refreshMetadata,
    accessLevel,
  } = useCanvasData({ canvasId });
  // IMP-008: one capability contract, derived once and passed down. Every
  // surface reads these flags instead of re-deriving a role comparison.
  const capabilities = React.useMemo(
    () => resolveCanvasCapabilities(accessLevel as CanvasAccessLevel),
    [accessLevel],
  );
  const canEdit = capabilities.canEditItems;
  const isOwner = capabilities.canManageCanvas;

  const {
    commitGeometry,
    status: geometrySaveStatus,
    error: geometrySaveError,
  } = useItemGeometry({
    capabilities,
    onError: (error) =>
      toast.error(`Canvas item could not be saved: ${error.message}`),
  });

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
  const updateItemMutation = useUpdateCanvasItem();
  const { mutate: updateItem } = updateItemMutation;
  const updateThumbnail = useUpdateCanvasThumbnail();
  const { mutateAsync: restoreVersion } = useRestoreVersion();

  // History

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
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [serendipityOpen, setSerendipityOpen] = useState(false);
  const [whisperOpen, setWhisperOpen] = useState(false);
  const [pendingAutopilotActions, setPendingAutopilotActions] = useState<
    Awaited<ReturnType<typeof calculateAutopilotLayout>>
  >([]);
  const [pendingRestoreVersionId, setPendingRestoreVersionId] = useState<
    string | null
  >(null);
  const [arOpen, setAROpen] = useState(false);

  // Item Dialogs
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);

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
      if (!canEdit) return;
      if (selectedItemIds.size > 0) {
        try {
          const itemsToDelete = allItems.filter((item) =>
            selectedItemIds.has(item.id),
          );
          await Promise.all(
            itemsToDelete.map((item) =>
              deleteItem({ itemId: item.id, version: item.version }),
            ),
          );
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
            await deleteItem({
              itemId: selectedItem.id,
              version: selectedItem.version,
            });
            setSelectedItemId(null);
          } catch (err) {
            console.error("Failed to delete item:", err);
          }
        }
      }
    },
    onCopy: () => {
      if (!selectedItemId) return;
      const selectedItem = allItems.find((item) => item.id === selectedItemId);
      if (selectedItem) {
        const copyData = {
          memoriaClipboard: 1,
          type: selectedItem.type,
          content: selectedItem.content,
          width: selectedItem.width,
          height: selectedItem.height,
        };
        void navigator.clipboard
          .writeText(JSON.stringify(copyData))
          .catch(() => toast.error("Clipboard access was denied"));
      }
    },
    onPaste: async () => {
      if (!canEdit) return;
      try {
        const clipboardText = await navigator.clipboard.readText();
        const data: unknown = JSON.parse(clipboardText);
        if (
          !data ||
          typeof data !== "object" ||
          !("memoriaClipboard" in data) ||
          data.memoriaClipboard !== 1 ||
          !("type" in data) ||
          typeof data.type !== "string" ||
          !Object.values(ItemType).includes(data.type as ItemType) ||
          !("content" in data) ||
          typeof data.content !== "object" ||
          data.content === null
        ) {
          return;
        }

        const width =
          "width" in data && typeof data.width === "number"
            ? Math.min(2000, Math.max(40, data.width))
            : 200;
        const height =
          "height" in data && typeof data.height === "number"
            ? Math.min(2000, Math.max(40, data.height))
            : 150;
        const pointer = stageRef.current?.getPointerPosition();
        const positionX = pointer ? (pointer.x - position.x) / zoom + 20 : 120;
        const positionY = pointer ? (pointer.y - position.y) / zoom + 20 : 120;

        await createItem({
          canvasId,
          type: data.type as ItemType,
          positionX,
          positionY,
          width,
          height,
          zIndex: Math.max(0, ...allItems.map((item) => item.zIndex)) + 1,
          content: data.content as CanvasItem["content"],
          tags: [],
        });
      } catch {
        toast.error("Clipboard content could not be pasted");
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
    canEdit,
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
    const itemId = searchParams.get("item");
    if (!itemId || focusedItemRef.current === itemId) return;
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item) return;

    focusedItemRef.current = itemId;
    setSelectedItemId(itemId);
    setSelectedItemIds(new Set([itemId]));
    setPosition({
      x: stageSize.width / 2 - (item.positionX + item.width / 2) * zoom,
      y: stageSize.height / 2 - (item.positionY + item.height / 2) * zoom,
    });
  }, [
    allItems,
    searchParams,
    setPosition,
    stageSize.height,
    stageSize.width,
    zoom,
  ]);
  useEffect(() => {
    const target = stageContainerRef.current;
    if (!target) return;
    const updateSize = () => {
      const bounds = target.getBoundingClientRect();
      setStageSize({
        width: Math.max(1, Math.floor(bounds.width)),
        height: Math.max(1, Math.floor(bounds.height)),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(target);
    return () => observer.disconnect();
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

  const handleCommittedEvent = useCallback(
    async (event: CommittedCanvasItemEvent) => {
      await mergeCommittedCanvasItemEvent(queryClient, event);
    },
    [queryClient],
  );

  const handleCommittedSnapshotRequired = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: canvasItemKeys.list(canvasId),
    });
  }, [canvasId, queryClient]);

  const {
    users: collaborators,
    cursors,
    connected: collaborationConnected,
    status: collaborationStatus,
    broadcastMessage,
    updateCursor,
  } = useCollaboration({
    canvasId,
    name: session?.user?.name || "Anonymous",
    userId: session?.user?.id || "anon",
    email: session?.user?.email || "anon@example.com",
    onMessage: handleRemoteMessage,
    onCommittedEvent: handleCommittedEvent,
    onSnapshotRequired: handleCommittedSnapshotRequired,
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
        const newX = stageSize.width / 2 - targetCursor.position.x * zoom;
        const newY = stageSize.height / 2 - targetCursor.position.y * zoom;
        setPosition({ x: newX, y: newY });
      }
    }
  }, [
    cursors,
    followingUserId,
    setPosition,
    stageSize.height,
    stageSize.width,
    zoom,
  ]);

  // Space Key
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      );
    };

    const handleKey = (e: KeyboardEvent) => {
      // Don't hijack Space while the user is typing in a field, dialog, or
      // the cursor-chat input — otherwise a space toggles canvas pan mode.
      if (e.code === "Space" && !isEditableTarget(e.target)) {
        setIsSpacePressed(e.type === "keydown");
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

  /**
   * IMP-008: the one durable geometry write. Every item type routes its move
   * and resize here, the capability contract decides whether it is permitted,
   * and the serialized queue guarantees one write per gesture.
   */
  const handleCommitGeometry = (
    item: CanvasItem,
    geometry: ItemGeometryCommit,
  ) => {
    commitGeometry(item, geometry);
  };

  /** Double-click / Enter activation, gated by the same contract. */
  const handleActivateItem = (item: CanvasItem) => {
    if (!capabilities.canEditItems) return;
    if (item.type === ItemType.NOTE || item.type === ItemType.TEXT) {
      handleNoteDoubleClick(item);
      return;
    }
    if (item.type === ItemType.BOOKMARK) {
      handleBookmarkDoubleClick(item);
      return;
    }
    if (item.type === ItemType.IMAGE) {
      handleImageDoubleClick(item);
    }
  };

  /** Keyboard nudge from the accessible item list, on the same commit path. */
  const handleNudgeItem = (
    item: CanvasItem,
    deltaX: number,
    deltaY: number,
  ) => {
    commitGeometry(item, {
      positionX: item.positionX + deltaX,
      positionY: item.positionY + deltaY,
    });
  };

  const handleDeleteItem = (item: CanvasItem) => {
    if (!capabilities.canDeleteItems) return;
    deleteItem({ itemId: item.id, version: item.version });
  };

  const generateThumbnail = useCallback(() => {
    if (!stageRef.current || !isOwner) return;
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
  }, [canvasId, isOwner, updateThumbnail]);

  const thumbnailRevision = React.useMemo(
    () => allItems.map((item) => `${item.id}:${item.version}`).join("|"),
    [allItems],
  );

  useEffect(() => {
    if (!isOwner || allItems.length === 0) return;
    const timeoutId = setTimeout(() => {
      generateThumbnail();
    }, 3000);
    return () => clearTimeout(timeoutId);
  }, [allItems.length, generateThumbnail, isOwner, thumbnailRevision]);

  const handleContextMenu = (
    e: React.MouseEvent | Konva.KonvaEventObject<MouseEvent>,
    itemId: string,
  ) => {
    if (!capabilities.canCopyItems && !capabilities.canComment) return;
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
    if (!capabilities.canEditItems) return;
    if (item.type === ItemType.NOTE || item.type === ItemType.TEXT) {
      setEditingNoteItem(item);
      setEditNoteDialogOpen(true);
    }
  };
  const handleBookmarkDoubleClick = (item: CanvasItem) => {
    if (!canEdit) return;
    if (item.type === ItemType.BOOKMARK) {
      setEditingBookmarkItem(item);
      setEditBookmarkDialogOpen(true);
    }
  };
  const handleImageDoubleClick = (item: CanvasItem) => {
    if (!canEdit) return;
    if (item.type === ItemType.IMAGE) {
      setEditingImageItem(item);
      setEditImageDialogOpen(true);
    }
  };
  const handleOpenComments = () => {
    if (!capabilities.canComment) return;
    if (!selectedItemId) return;
    setCommentsItemId(selectedItemId);
    setCommentsPanelOpen(true);
  };

  const handleDeleteFromMenu = () => {
    if (!canEdit) return;
    if (!selectedItemId) return;
    const selectedItem = allItems.find((item) => item.id === selectedItemId);
    if (selectedItem) {
      deleteItem({ itemId: selectedItemId, version: selectedItem.version });
    }
  };

  const handleDuplicateFromMenu = () => {
    if (!canEdit) return;
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
      memoriaClipboard: 1,
      type: selectedItem.type,
      content: selectedItem.content,
      width: selectedItem.width,
      height: selectedItem.height,
    };
    void navigator.clipboard
      .writeText(JSON.stringify(copyData))
      .catch(() => toast.error("Clipboard access was denied"));
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

  const [isPresentationMode, setPresentationMode] = useState(false);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: "100%",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <CanvasHeader
        canvasId={canvasId}
        canvasName={canvasName}
        onCanvasNameChange={isOwner ? updateCanvasName : () => {}}
        zoom={zoom}
        onZoomChange={setZoom}
        onFitToScreen={() => {
          setZoom(1);
          setPosition({ x: 0, y: 0 });
        }}
        onExport={() => setExportDialogOpen(true)}
        onVersionHistory={
          isOwner ? () => setVersionHistoryOpen(true) : undefined
        }
        onTagFilter={() => setTagFilterOpen(true)}
        onAI={canEdit ? () => setAiDialogOpen(true) : undefined}
        activeTagCount={selectedTags.length}
        gridVisible={gridVisible}
        onGridToggle={() => setGridVisible(!gridVisible)}
        snapEnabled={snapToGridEnabled}
        onSnapToggle={() => setSnapToGridEnabled(!snapToGridEnabled)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        collaborators={collaborators}
        collaborationConnected={collaborationConnected}
        collaborationStatus={collaborationStatus}
        onFollowUser={(userId: string) =>
          setFollowingUserId(userId === followingUserId ? null : userId)
        }
        followingUserId={followingUserId}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onPresentationMode={() => setPresentationMode((active) => !active)}
        isPresentationMode={isPresentationMode}
        canManageCanvas={isOwner}
        saveStatus={
          updateItemMutation.isPending
            ? "saving"
            : updateItemMutation.isError
              ? updateItemMutation.error instanceof TypeError
                ? "offline/retrying"
                : isVersionConflict(updateItemMutation.error)
                  ? "conflict"
                  : "failed"
              : geometrySaveStatus !== "saved"
                ? geometrySaveStatus
                : updateItemMutation.isSuccess
                  ? "saved"
                  : undefined
        }
        saveError={
          updateItemMutation.isError &&
          updateItemMutation.error instanceof Error
            ? updateItemMutation.error.message
            : geometrySaveError?.message || null
        }
        onTimeMachine={() => {
          setTimeMachineActive(!isTimeMachineActive);
          if (!isTimeMachineActive && versions.length > 0) {
            setTimeMachineIndex(versions.length - 1);
          }
        }}
        onSerendipity={() => setSerendipityOpen(true)}
        onAutopilot={
          canEdit
            ? async () => {
                const actions = await calculateAutopilotLayout(allItems);
                if (actions.length > 0) setPendingAutopilotActions(actions);
              }
            : undefined
        }
        onWhisper={() => setWhisperOpen(true)}
        onAR={isArCanvasEnabled() ? () => setAROpen(true) : undefined}
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
            onClose={clearCanvasLoadError}
          >
            {canvasLoadError}
          </Alert>
        </Box>
      )}

      <CanvasAccessiblePanel
        items={allItems}
        capabilities={capabilities}
        selectedItemIds={selectedItemIds}
        onSelectItem={(itemId) => handleSelectItem(itemId, false)}
        onActivateItem={(item) => {
          if (item.type === ItemType.NOTE || item.type === ItemType.TEXT) {
            handleNoteDoubleClick(item);
          } else if (item.type === ItemType.BOOKMARK) {
            handleBookmarkDoubleClick(item);
          } else if (item.type === ItemType.IMAGE) {
            handleImageDoubleClick(item);
          }
        }}
        onNudgeItem={(item, deltaX, deltaY) => {
          commitGeometry(item, {
            positionX: item.positionX + deltaX,
            positionY: item.positionY + deltaY,
          });
        }}
        onDeleteItem={(item) => {
          void deleteItem({ itemId: item.id, version: item.version });
        }}
        onCreateItem={() => setNoteDialogOpen(true)}
        canvasName={canvasName}
      />

      {viewMode === "manual" && !isPresentationMode && canEdit && (
        <MainToolbar />
      )}
      {viewMode === "manual" &&
        !isPresentationMode &&
        canEdit &&
        activeTool === "draw" && <DrawingToolbar />}

      {viewMode === "organizer" ? (
        <CanvasOrganizerView canvasId={canvasId} items={allItems} />
      ) : (
        <Box
          ref={stageContainerRef}
          role="region"
          aria-label="Infinite canvas. An equivalent keyboard- and screen-reader-accessible item list follows."
          sx={{
            flexGrow: 1,
            position: "relative",
            overflow: "hidden",
            cursor: isDrawing ? "crosshair" : "default",
            bgcolor: (theme) =>
              theme.palette.mode === "light" ? "#f0f2f5" : "#0d1526",
          }}
        >
          {/* IMP-022 / DEC-009: the canvas content as real DOM, always present
              in the accessibility tree and operable without pointer or pixels. */}
          <CanvasAccessiblePanel
            items={allItems}
            capabilities={capabilities}
            canvasName={canvasName}
            selectedItemIds={selectedItemIds}
            onSelectItem={(id) => handleSelectItem(id, false)}
            onActivateItem={handleActivateItem}
            onNudgeItem={handleNudgeItem}
            onDeleteItem={handleDeleteItem}
            onCreateItem={() => setNoteDialogOpen(true)}
          />

          {!isDrawing && !isPresentationMode && canEdit && (
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
            </SpeedDial>
          )}

          <Stage
            width={stageSize.width}
            height={stageSize.height}
            scaleX={zoom}
            scaleY={zoom}
            x={position.x}
            y={position.y}
            draggable={!isDrawing && isSpacePressed && !isTimeMachineActive}
            onDragMove={(event) =>
              setPosition({ x: event.target.x(), y: event.target.y() })
            }
            onDragEnd={(event) =>
              setPosition({ x: event.target.x(), y: event.target.y() })
            }
            onWheel={(event) => {
              event.evt.preventDefault();
              const stage = event.target.getStage();
              const pointer = stage?.getPointerPosition();
              if (!pointer) return;
              const factor = event.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
              const nextZoom = Math.min(5, Math.max(0.1, zoom * factor));
              const worldX = (pointer.x - position.x) / zoom;
              const worldY = (pointer.y - position.y) / zoom;
              setZoom(nextZoom);
              setPosition({
                x: pointer.x - worldX * nextZoom,
                y: pointer.y - worldY * nextZoom,
              });
            }}
            onMouseDown={isSpacePressed ? undefined : handleStageMouseDown}
            onMouseMove={(event) => {
              if (!isSpacePressed) handleStageMouseMove(event);
              const pointer = event.target.getStage()?.getPointerPosition();
              if (pointer) {
                updateCursor(
                  (pointer.x - position.x) / zoom,
                  (pointer.y - position.y) / zoom,
                );
              }
            }}
            onMouseUp={isSpacePressed ? undefined : handleStageMouseUp}
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
              stroke={gridStroke}
            />
            <CanvasItemLayer
              items={renderedItems}
              selectedItemIds={selectedItemIds}
              isSelecting={isSelecting}
              selectionBox={selectionBox}
              capabilities={capabilities}
              onSelectItem={(id) => handleSelectItem(id, false)}
              onContextMenu={handleContextMenu}
              onActivateItem={handleActivateItem}
              onCommitGeometry={handleCommitGeometry}
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
        capabilities={capabilities}
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
            setPendingRestoreVersionId(version.id);
          }}
        />
      )}
      <ConfirmDialog
        open={pendingAutopilotActions.length > 0}
        title="Apply automatic layout?"
        message={`Autopilot will reorganize ${pendingAutopilotActions.length} items in one atomic update.`}
        confirmLabel="Apply layout"
        onClose={() => setPendingAutopilotActions([])}
        onConfirm={async () => {
          const itemsToUpdate = pendingAutopilotActions.flatMap((action) => {
            const item = allItems.find(
              (candidate) => candidate.id === action.itemId,
            );
            return item
              ? [
                  {
                    id: item.id,
                    version: item.version,
                    positionX: action.newPosition.x,
                    positionY: action.newPosition.y,
                  },
                ]
              : [];
          });
          const response = await fetch("/api/v1/canvas-items", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canvasId, items: itemsToUpdate }),
          });
          if (!response.ok) {
            toast.error(
              "The layout could not be applied. Refresh and try again.",
            );
            return;
          }
          setPendingAutopilotActions([]);
          await queryClient.invalidateQueries({
            queryKey: canvasItemKeys.list(canvasId),
          });
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingRestoreVersionId)}
        title="Restore canvas version?"
        message="The current canvas state will be replaced by this saved version."
        confirmLabel="Restore"
        destructive
        onClose={() => setPendingRestoreVersionId(null)}
        onConfirm={async () => {
          if (!pendingRestoreVersionId) return;
          await restoreVersion({
            canvasId,
            versionId: pendingRestoreVersionId,
          });
          setPendingRestoreVersionId(null);
          setTimeMachineActive(false);
          await queryClient.invalidateQueries({
            queryKey: canvasItemKeys.list(canvasId),
          });
        }}
      />
    </Box>
  );
}
