"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import { Stage } from "react-konva";
import { useCanvasStore } from "@/stores/canvasStore";
import { Alert, Box, Button } from "@mui/material";
import { useSession } from "@/lib/auth-client";
import { useSearchParams } from "next/navigation";
import {
  useDeleteCanvasItem,
  useCreateCanvasItem,
  useUpdateCanvasItem,
  canvasItemKeys,
  mergeCommittedCanvasItemEvents,
  getCanvasEventSeed,
  type CommittedCanvasItemEvent,
} from "@/lib/hooks/use-canvas-items";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectionBox } from "@/lib/hooks/use-selection-box";
import { canvasKeys, useUpdateCanvasThumbnail } from "@/lib/hooks/use-canvases";
import { canvasIndexKeys } from "@/lib/hooks/use-canvas-index";
import {
  CanvasDocumentContext,
  useCanvasDocument,
  useCanvasDocumentSnapshot,
} from "@/lib/hooks/use-canvas-document";
import { useCanvasDocumentSession } from "@/features/canvas/hooks/use-canvas-document-session";
import { documentSaveStatus as documentSaveStatusOf } from "@/features/canvas/save-status";
import { useCollaboration } from "@/lib/hooks/use-collaboration";
import { useVirtualItems } from "@/lib/hooks/use-virtual-items";
import { useRestoreVersion } from "@/lib/hooks/use-canvas-versions"; // Only restore needed
import { useCanvasData } from "@/features/canvas/hooks/use-canvas-data";
import { useCanvasInteraction } from "@/features/canvas/hooks/use-canvas-interaction";
import { useCanvasKeyboard } from "@/features/canvas/hooks/use-canvas-keyboard";
import { useItemGeometry } from "@/features/canvas/hooks/use-item-geometry";

import { TimeMachineControl } from "@/features/canvas/components/TimeMachineControl";
import { CanvasDialogs } from "@/features/canvas/components/CanvasDialogs";
import {
  AutopilotTooLargeError,
  prepareAutopilot,
  type AutopilotAction,
  type AutopilotItem,
} from "@/lib/ai/autopilot-service";
import { useObservedStageSize } from "@/features/canvas/components/use-observed-stage-size";
import { viewportCenterWorld } from "@/features/canvas/components/viewport-center";
import { resolveBoardCapabilities } from "@/features/canvas/hooks/time-machine-capabilities";
import { SortIntoPilesDialog } from "./SortIntoPilesDialog";
import { UploadNoteOffer } from "./UploadNoteOffer";
import { HomeBoardSuggestions, isInboxBoardName } from "./HomeBoardSuggestions";

import { useGesture } from "@use-gesture/react";
import type Konva from "konva";
import { toast } from "sonner";
import { isPollChangedMessage } from "@/lib/polls/shared";
import { pollKeys } from "@/features/canvas/hooks/use-poll-results";
import {
  BoardExportCaptureContext,
  type BoardExportCapture,
  fetchAllCanvasItems,
  preloadItemImages,
} from "@/lib/export/export-utils";

import type {
  ArrowContent,
  CanvasAccessLevel,
  CanvasItem,
  ItemGeometryCommit,
} from "@/types/canvas";
import type { UpdateCanvasItemInput } from "@/lib/validation/canvas-item";
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
import {
  DotOverlay,
  GridOverlay,
} from "@/features/canvas/components/GridOverlay";
import { DrawingPreview } from "@/features/canvas/components/DrawingPreview";
import { CursorChat } from "@/features/canvas/components/CursorChat";
import { ReactionSelector } from "@/features/canvas/components/ReactionSelector";
import { RemoteCursorChat } from "@/features/canvas/components/RemoteCursorChat";
import { RemoteCursor } from "@/features/canvas/components/RemoteCursor";
import { RemoteReaction } from "@/features/canvas/components/RemoteReaction";
import { AlignmentToolbar } from "@/features/canvas/components/AlignmentToolbar";
import { CanvasAddBar } from "@/features/canvas/components/CanvasAddBar";
import { CanvasViewControls } from "@/features/canvas/components/CanvasViewControls";
import { CanvasOrganizerView } from "@/features/canvas/components/CanvasOrganizerView";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  isArCanvasEnabled,
  isLaunchCapabilityEnabled,
} from "@/lib/product-surfaces";
import { isVersionConflict } from "@/lib/api/fetch-client";
import { stageDragPosition } from "@/features/canvas/lib/stage-drag";
import { appColor, appColorTokens } from "@/lib/theme";
import { useThemeMode } from "@/lib/theme-context";
import { CANVAS_PALETTE } from "@/features/canvas/lib/canvas-palette";
import { thumbnailDataUrl } from "@/features/canvas/lib/thumbnail";
import {
  isLinkArrow,
  moveArrowEnd,
} from "@/features/canvas/lib/arrow-attachment";
import { ArrowLabelDialog } from "@/features/canvas/components/ArrowLabelDialog";
import { LinkedItemsPanel } from "@/features/canvas/components/LinkedItemsPanel";

interface CanvasBoardProps {
  canvasId: string;
}

interface RemoteChatMessage {
  id: string;
  userId: string;
  content: string;
  x: number;
  y: number;
  userName: string;
  userColor: string;
}

interface RemoteReactionMessage {
  id: string;
  userId: string;
  emoji: string;
  x: number;
  y: number;
  userName: string;
}

/**
 * Runs a confirm-dialog action and reports a failure as an error toast.
 * Resolves true when the action succeeded; never rejects.
 */
export async function runConfirmAction(
  action: () => Promise<void>,
  failureMessage: string,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    toast.error(failureMessage);
    return false;
  }
}

/** Pan distance, in screen pixels, before the drawn item set is recomputed. */
const VIEWPORT_STEP_PX = 256;

/**
 * IMP-042: the board opens the canvas's collaborative document and edits it
 * live while it is available; item writes fall back to the HTTP API
 * otherwise (see `lib/collaboration/sync/client-session`).
 */

export function CanvasBoard({ canvasId }: CanvasBoardProps) {
  const documentSession = useCanvasDocumentSession(canvasId, {
    onRejectedChange: () =>
      toast.error(
        "A change could not be saved and was undone. The canvas now shows the latest saved state.",
      ),
  });
  const exportCaptureRef = useRef<BoardExportCapture | null>(null);
  return (
    <CanvasDocumentContext.Provider value={documentSession}>
      <BoardExportCaptureContext.Provider value={exportCaptureRef}>
        <CanvasBoardContent canvasId={canvasId} />
      </BoardExportCaptureContext.Provider>
    </CanvasDocumentContext.Provider>
  );
}

// Never mutated: the export render shows nothing selected.
const NO_SELECTION = new Set<string>();

function CanvasBoardContent({ canvasId }: CanvasBoardProps) {
  // Refs
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const focusedItemRef = useRef<string | null>(null);
  const lastThumbnailRevisionRef = useRef<string | null>(null);
  // Konva needs a real colour; the mode comes from the theme context.
  const themeMode = useThemeMode().mode;
  const gridStroke = appColorTokens[themeMode].canvasGrid;
  const { ref: stageContainerRef, size: stageSize } = useObservedStageSize();

  // Data Hook (Single source of truth for display)
  const {
    items,
    searchMatchIds,
    allItems,
    versions,
    allTags,
    tagCounts,
    geometry,
    canvasBounds,
    totalItemCount,
    canvasRevision,
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
  } = useCanvasData({ canvasId, viewportSize: stageSize });
  // IMP-008: one capability contract, derived once and passed down. Every
  // surface reads these flags instead of re-deriving a role comparison.
  const baseCapabilities = React.useMemo(
    () => resolveCanvasCapabilities(accessLevel as CanvasAccessLevel),
    [accessLevel],
  );
  // A time-machine preview renders snapshot items under live ids: every
  // item write is off there, while restore stays with live-canvas editors.
  const { capabilities, canRestore } = React.useMemo(
    () => resolveBoardCapabilities(baseCapabilities, isTimeMachineActive),
    [baseCapabilities, isTimeMachineActive],
  );
  const canEdit = capabilities.canEditItems;
  const isOwner = capabilities.canManageCanvas;

  const {
    commitGeometry,
    nudgeGeometry,
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

  // IMP-042: the collaborative document's save and access state.
  const documentSession = useCanvasDocument();
  const documentState = useCanvasDocumentSnapshot(documentSession);
  // IMP-045: offline, edits are kept on this device; the header shows how
  // many the server has not stored yet, including any from an earlier visit.
  const documentSaveStatus = documentSaveStatusOf(documentState);
  const documentSavingRef = useRef({ saving: false, unsaved: false });
  useEffect(() => {
    // Rows (and so the canvas index) change once the sync server has stored
    // the document changes this client made, including edits kept on this
    // device from an earlier visit.
    const unsaved = documentState.unsavedChanges > 0;
    const saving = documentState.pendingChanges > 0 || unsaved;
    const previous = documentSavingRef.current;
    if (
      previous.saving &&
      !saving &&
      (documentState.localChanges || previous.unsaved)
    ) {
      void queryClient.invalidateQueries({
        queryKey: canvasIndexKeys.all(canvasId),
      });
    }
    documentSavingRef.current = { saving, unsaved };
  }, [
    canvasId,
    documentState.localChanges,
    documentState.pendingChanges,
    documentState.unsavedChanges,
    queryClient,
  ]);
  useEffect(() => {
    // The sync server reported a change in access: reload the canvas role
    // so every surface follows it.
    if (documentState.accessRevision === 0) return;
    void queryClient.invalidateQueries({
      queryKey: canvasKeys.detail(canvasId),
    });
  }, [canvasId, documentState.accessRevision, queryClient]);

  // Mutations
  const { mutateAsync: deleteItem } = useDeleteCanvasItem();
  const { mutateAsync: createItem } = useCreateCanvasItem();
  const updateItemMutation = useUpdateCanvasItem();
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
  const [sortPilesOpen, setSortPilesOpen] = useState(false);
  // After "Sort into piles" the board refetches; once the new bounds arrive,
  // zoom out so the piles (placed beside existing items) are in view.
  const [fitAfterSortFrom, setFitAfterSortFrom] = useState<string | null>(null);
  const [whisperOpen, setWhisperOpen] = useState(false);
  const [labelArrow, setLabelArrow] = useState<CanvasItem | null>(null);
  const [pendingAutopilotActions, setPendingAutopilotActions] = useState<
    AutopilotAction[]
  >([]);
  // The whole-canvas items the pending layout was computed over; the apply
  // reads versions from this set, not the viewport-loaded board items.
  const [pendingAutopilotItems, setPendingAutopilotItems] = useState<
    AutopilotItem[]
  >([]);
  const [pendingRestoreVersionId, setPendingRestoreVersionId] = useState<
    string | null
  >(null);
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
  const [remoteMessages, setRemoteMessages] = useState<RemoteChatMessage[]>([]);
  const [remoteReactions, setRemoteReactions] = useState<
    RemoteReactionMessage[]
  >([]);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"manual" | "organizer">("manual");

  // Interaction Hook (Stage Events)
  const {
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleStageClick,
    isDrawing,
    currentPath,
    currentCreation,
  } = useCanvasInteraction({
    canvasId,
    stageRef: stageRef as React.RefObject<Konva.Stage>,
    activeTool,
    canCreateItems: capabilities.canCreateItems,
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
              deleteItem({
                itemId: item.id,
                version: item.version,
                canvasId: item.canvasId,
              }),
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
              canvasId: selectedItem.canvasId,
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
      if (!capabilities.canCreateItems || !selectedItemId) return;
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
    nudgeItem: nudgeGeometry,
  });

  useEffect(() => {
    const itemId = searchParams.get("item");
    if (!itemId || focusedItemRef.current === itemId) return;
    const item = geometry.find((candidate) => candidate.id === itemId);
    if (!item) return;

    focusedItemRef.current = itemId;
    setSelectedItemId(itemId);
    setSelectedItemIds(new Set([itemId]));
    setPosition({
      x: stageSize.width / 2 - (item.positionX + item.width / 2) * zoom,
      y: stageSize.height / 2 - (item.positionY + item.height / 2) * zoom,
    });
  }, [
    geometry,
    searchParams,
    setPosition,
    stageSize.height,
    stageSize.width,
    zoom,
  ]);

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

  const handleRemoteMessage = useCallback(
    (message: unknown) => {
      if (!message || typeof message !== "object") return;
      // IMP-104: a vote changed a poll's counts; read them again.
      if (isPollChangedMessage(message)) {
        void queryClient.invalidateQueries({
          queryKey: pollKeys.canvas(canvasId),
        });
        return;
      }
      const payload = message as Record<string, unknown>;
      const position = payload.position as
        { x?: unknown; y?: unknown } | undefined;
      if (
        payload.kind === "cursor_chat" &&
        typeof payload.userId === "string" &&
        typeof payload.message === "string" &&
        typeof payload.userName === "string" &&
        typeof payload.userColor === "string" &&
        typeof position?.x === "number" &&
        typeof position.y === "number"
      ) {
        const id = Date.now().toString() + Math.random().toString();
        setRemoteMessages((prev) => [
          ...prev,
          {
            id,
            userId: payload.userId as string,
            content: payload.message as string,
            x: position.x as number,
            y: position.y as number,
            userName: payload.userName as string,
            userColor: payload.userColor as string,
          },
        ]);
        setTimeout(() => {
          setRemoteMessages((prev) => prev.filter((m) => m.id !== id));
        }, 5000);
      } else if (
        payload.kind === "reaction" &&
        typeof payload.userId === "string" &&
        typeof payload.emoji === "string" &&
        typeof payload.userName === "string" &&
        typeof position?.x === "number" &&
        typeof position.y === "number"
      ) {
        const id = Date.now().toString() + Math.random().toString();
        setRemoteReactions((prev) => [
          ...prev,
          {
            id,
            userId: payload.userId as string,
            emoji: payload.emoji as string,
            x: position.x as number,
            y: position.y as number,
            userName: payload.userName as string,
          },
        ]);
        setTimeout(() => {
          setRemoteReactions((prev) => prev.filter((r) => r.id !== id));
        }, 3000);
      }
    },
    [canvasId, queryClient],
  );

  const handleCommittedEvents = useCallback(
    async (events: CommittedCanvasItemEvent[]) => {
      await mergeCommittedCanvasItemEvents(queryClient, canvasId, events);
    },
    [canvasId, queryClient],
  );

  // Read before the item load this board rendered from.
  const getInitialEventSeed = useCallback(
    () => getCanvasEventSeed(queryClient, canvasId),
    [canvasId, queryClient],
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
    connectionMessage: collaborationConnectionMessage,
    broadcastMessage,
    updateCursor,
    timer: sharedTimer,
    sendTimerCommand,
  } = useCollaboration({
    canvasId,
    name: session?.user?.name || "Anonymous",
    userId: session?.user?.id || "anon",
    email: session?.user?.email || "anon@example.com",
    onMessage: handleRemoteMessage,
    onCommittedEvents: handleCommittedEvents,
    onSnapshotRequired: handleCommittedSnapshotRequired,
    getInitialEventSeed,
  });

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
  // Returns the create so AIDialog closes only once the note exists.
  const handleAddNoteFromAI = async (text: string): Promise<void> => {
    const { x: centerX, y: centerY } = viewportCenterWorld(
      position,
      stageSize,
      zoom,
    );

    await createItem({
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
    const center = viewportCenterWorld(position, stageSize, zoom);
    for (const item of items) {
      await createItem({
        content: item.content,
        type: item.type,
        positionX: center.x + Math.random() * 100,
        positionY: center.y + Math.random() * 100,
        width: 300,
        height: 200,
        canvasId: canvasId,
        zIndex: allItems.length + 1,
        tags: [],
      });
    }
  };

  const handleWhisperSend = async (text: string) => {
    const center = viewportCenterWorld(position, stageSize, zoom);
    await createItem({
      content: { text },
      type: ItemType.NOTE,
      positionX: center.x,
      positionY: center.y,
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
      return;
    }
    if (item.type === ItemType.ARROW) setLabelArrow(item);
  };

  /** Arrow content edits (IMP-095): ends, label and line. One write each. */
  const saveArrow = (
    arrow: CanvasItem,
    data: Omit<UpdateCanvasItemInput, "version">,
  ) => {
    if (!capabilities.canEditItems) return;
    updateItemMutation.mutate(
      { itemId: arrow.id, data: { ...data, version: arrow.version } },
      {
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : "Could not save the arrow",
          ),
      },
    );
  };

  const handleMoveArrowEnd = (
    arrow: CanvasItem,
    which: "start" | "end",
    point: { x: number; y: number },
  ) => {
    const next = moveArrowEnd(arrow, which, point, items);
    saveArrow(arrow, {
      ...next,
      content: next.content as CanvasItem["content"],
    });
  };

  /** Select an item and bring it to the middle of the screen. */
  const jumpToItem = (item: CanvasItem) => {
    setSelectedItemId(item.id);
    setSelectedItemIds(new Set([item.id]));
    setPosition({
      x: stageSize.width / 2 - (item.positionX + item.width / 2) * zoom,
      y: stageSize.height / 2 - (item.positionY + item.height / 2) * zoom,
    });
  };

  /** Keyboard nudge from the accessible item list, on the same commit path. */
  const handleNudgeItem = (
    item: CanvasItem,
    deltaX: number,
    deltaY: number,
  ) => {
    nudgeGeometry(item, deltaX, deltaY);
  };

  const handleDeleteItem = (item: CanvasItem) => {
    if (!capabilities.canDeleteItems) return;
    // The hook rolls back and shows the failure toast.
    deleteItem({
      itemId: item.id,
      version: item.version,
      canvasId: item.canvasId,
    }).catch(() => {});
  };

  const generateThumbnail = useCallback(
    (expectedRevision: string) => {
      if (!stageRef.current || !isOwner) return;
      try {
        const thumbnail = thumbnailDataUrl(
          stageRef.current,
          appColorTokens[themeMode].canvasBackground,
        );
        updateThumbnail.mutate({ canvasId, thumbnail, expectedRevision });
        lastThumbnailRevisionRef.current = expectedRevision;
      } catch {
        // A thumbnail is a best-effort derivative and must not interrupt editing.
      }
    },
    [canvasId, isOwner, themeMode, updateThumbnail],
  );

  useEffect(() => {
    lastThumbnailRevisionRef.current = null;
  }, [canvasId]);

  useEffect(() => {
    if (
      !isOwner ||
      totalItemCount === 0 ||
      // Revision "0" still needs a preview: seeded canvases have items but
      // no change history yet (IMP-083).
      lastThumbnailRevisionRef.current === canvasRevision
    ) {
      return;
    }
    let idleId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(
          () => generateThumbnail(canvasRevision),
          { timeout: 2_000 },
        );
      } else {
        generateThumbnail(canvasRevision);
      }
    }, 1_500);
    return () => {
      window.clearTimeout(timeoutId);
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [canvasRevision, generateThumbnail, isOwner, totalItemCount]);

  const handleContextMenu = (
    e: React.MouseEvent | Konva.KonvaEventObject<MouseEvent>,
    itemId: string,
  ) => {
    if (!capabilities.canCopyItems && !capabilities.canComment) return;
    if ("evt" in e) {
      e.evt.preventDefault();
      setContextMenuPosition({
        x: e.evt.clientX,
        y: e.evt.clientY,
        itemId,
      });
    } else {
      e.preventDefault();
      setContextMenuPosition({ x: e.clientX, y: e.clientY, itemId });
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
      deleteItem({
        itemId: selectedItemId,
        version: selectedItem.version,
        canvasId: selectedItem.canvasId,
      }).catch(() => {});
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
    if (!capabilities.canMoveItems || selectedItemIds.size < 2) return;
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
        commitGeometry(item, { positionX: newX, positionY: newY });
      }
    });
  };
  const handleDistribute = (type: "horizontal" | "vertical") => {
    if (!capabilities.canMoveItems || selectedItemIds.size < 3) return;
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
          commitGeometry(item, {
            positionX: currentX,
            positionY: item.positionY,
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
          commitGeometry(item, {
            positionX: item.positionX,
            positionY: currentY,
          });
        }
        currentY += item.height + gap;
      });
    }
  };

  // Virtualization
  const virtualSource = React.useMemo(
    () =>
      items.map((item) => ({
        ...item,
        x: item.positionX,
        y: item.positionY,
      })),
    [items],
  );
  // IMP-103: the shown set is recomputed only when the view crosses a
  // VIEWPORT_STEP_PX step, so a pan does not re-render every item on every
  // pointer move. The window is widened by one step on each side, so it
  // always covers what is on screen at any zoom.
  const quantizedX =
    Math.floor(position.x / VIEWPORT_STEP_PX) * VIEWPORT_STEP_PX +
    VIEWPORT_STEP_PX;
  const quantizedY =
    Math.floor(position.y / VIEWPORT_STEP_PX) * VIEWPORT_STEP_PX +
    VIEWPORT_STEP_PX;
  const renderedItems = useVirtualItems(virtualSource, {
    viewport: {
      x: quantizedX,
      y: quantizedY,
      width: stageSize.width + VIEWPORT_STEP_PX * 2,
      height: stageSize.height + VIEWPORT_STEP_PX * 2,
    },
    zoom,
    padding: 500,
  });

  // IMP-103: the item layer is memoized; these keep its callbacks the same
  // between renders while always calling the latest handler.
  const layerHandlers = useRef({
    select: handleSelectItem,
    contextMenu: handleContextMenu,
    activate: handleActivateItem,
    commit: handleCommitGeometry,
    moveArrowEnd: handleMoveArrowEnd,
  });
  layerHandlers.current = {
    select: handleSelectItem,
    contextMenu: handleContextMenu,
    activate: handleActivateItem,
    commit: handleCommitGeometry,
    moveArrowEnd: handleMoveArrowEnd,
  };
  const stableSelectItem = useCallback(
    (id: string) => layerHandlers.current.select(id, false),
    [],
  );
  const stableContextMenu = useCallback(
    (...args: Parameters<typeof handleContextMenu>) =>
      layerHandlers.current.contextMenu(...args),
    [],
  );
  const stableActivateItem = useCallback(
    (item: CanvasItem) => layerHandlers.current.activate(item),
    [],
  );
  const stableCommitGeometry = useCallback(
    (item: CanvasItem, geometry: ItemGeometryCommit) =>
      layerHandlers.current.commit(item, geometry),
    [],
  );
  const stableMoveArrowEnd = useCallback(
    (...args: Parameters<typeof handleMoveArrowEnd>) =>
      layerHandlers.current.moveArrowEnd(...args),
    [],
  );

  // IMP-103: while the stage is dragged, Konva moves it itself. React's
  // position follows only when the view crosses a VIEWPORT_STEP_PX step (and
  // on drag end), so the toolbar and panels do not re-render on every
  // pointer move; the HTML overlays are shifted to match in between.
  const panOverlayRef = useRef<HTMLDivElement>(null);
  const followStagePan = (next: { x: number; y: number }) => {
    const sameStep =
      Math.floor(next.x / VIEWPORT_STEP_PX) ===
        Math.floor(position.x / VIEWPORT_STEP_PX) &&
      Math.floor(next.y / VIEWPORT_STEP_PX) ===
        Math.floor(position.y / VIEWPORT_STEP_PX);
    if (!sameStep) {
      setPosition(next);
      return;
    }
    const overlay = panOverlayRef.current;
    if (overlay)
      overlay.style.transform = `translate(${next.x - position.x}px, ${next.y - position.y}px)`;
  };
  useLayoutEffect(() => {
    if (panOverlayRef.current) panOverlayRef.current.style.transform = "";
  }, [position]);
  // The grids cover the same padded window as the drawn items.
  const gridOffset = React.useMemo(
    () => ({ x: -quantizedX / zoom, y: -quantizedY / zoom }),
    [quantizedX, quantizedY, zoom],
  );

  // Linking arrows follow their items, so they are drawn wherever their
  // stored box is (IMP-095).
  const visibleItems = React.useMemo(() => {
    const shown = new Set(renderedItems.map((item) => item.id));
    const extra = items.filter(
      (item) => !shown.has(item.id) && isLinkArrow(item),
    );
    return extra.length === 0 ? renderedItems : [...renderedItems, ...extra];
  }, [items, renderedItems]);

  const [isPresentationMode, setPresentationMode] = useState(false);

  const fitToScreen = useCallback(() => {
    if (
      canvasBounds?.minX === null ||
      canvasBounds?.minY === null ||
      canvasBounds?.maxX === null ||
      canvasBounds?.maxY === null ||
      !canvasBounds
    ) {
      setZoom(1);
      setPosition({ x: 0, y: 0 });
      return;
    }
    const contentWidth = Math.max(1, canvasBounds.maxX - canvasBounds.minX);
    const contentHeight = Math.max(1, canvasBounds.maxY - canvasBounds.minY);
    const nextZoom = Math.max(
      0.1,
      Math.min(
        1,
        (stageSize.width - 96) / contentWidth,
        (stageSize.height - 96) / contentHeight,
      ),
    );
    setZoom(nextZoom);
    setPosition({
      x:
        stageSize.width / 2 -
        ((canvasBounds.minX + canvasBounds.maxX) / 2) * nextZoom,
      y:
        stageSize.height / 2 -
        ((canvasBounds.minY + canvasBounds.maxY) / 2) * nextZoom,
    });
  }, [canvasBounds, setPosition, setZoom, stageSize.height, stageSize.width]);

  const boundsKey = JSON.stringify(canvasBounds ?? null);
  useEffect(() => {
    if (fitAfterSortFrom !== null && fitAfterSortFrom !== boundsKey) {
      setFitAfterSortFrom(null);
      fitToScreen();
    }
  }, [boundsKey, fitAfterSortFrom, fitToScreen]);

  // Raster export (TASK-119): while set, the stage renders exactly these
  // items, unculled and unselected. Pan and zoom state are untouched.
  const [exportItems, setExportItems] = useState<CanvasItem[] | null>(null);
  const exportCommittedRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const committed = exportCommittedRef.current;
    if (!exportItems || !committed) return;
    exportCommittedRef.current = null;
    // Two frames after the commit, so Konva has the new nodes and the
    // preloaded pictures of newly mounted image items have been set.
    requestAnimationFrame(() => requestAnimationFrame(() => committed()));
  }, [exportItems]);
  const exportCaptureRef = React.useContext(BoardExportCaptureContext);
  useEffect(() => {
    const capture: BoardExportCapture = {
      prepare: async () => {
        // A time-machine preview exports the snapshot it shows; otherwise
        // every stored item, since the board only loads the viewport.
        const captured = isTimeMachineActive
          ? items
          : await fetchAllCanvasItems(canvasId, allItems);
        await preloadItemImages(captured);
        await new Promise<void>((resolve) => {
          exportCommittedRef.current = resolve;
          setExportItems(captured);
        });
        return {
          items: captured,
          restore: () => {
            exportCommittedRef.current = null;
            setExportItems(null);
          },
        };
      },
    };
    exportCaptureRef.current = capture;
    return () => {
      if (exportCaptureRef.current === capture) {
        exportCaptureRef.current = null;
      }
    };
  }, [allItems, canvasId, exportCaptureRef, isTimeMachineActive, items]);

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
        onFitToScreen={fitToScreen}
        onExport={() => setExportDialogOpen(true)}
        onVersionHistory={() => setVersionHistoryOpen(true)}
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
        timer={sharedTimer}
        onTimerCommand={sendTimerCommand}
        canControlTimer={canEdit}
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
                : (documentSaveStatus ??
                  (updateItemMutation.isSuccess ? "saved" : undefined))
        }
        offlineChanges={
          documentSaveStatus === "offline/retrying"
            ? documentState.unsavedChanges
            : undefined
        }
        deviceCopyFailed={documentState.deviceCopyFailed}
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
                try {
                  const { items, actions } = await prepareAutopilot(canvasId);
                  if (actions.length > 0) {
                    setPendingAutopilotItems(items);
                    setPendingAutopilotActions(actions);
                  }
                } catch (error) {
                  toast.error(
                    error instanceof AutopilotTooLargeError
                      ? error.message
                      : "Autopilot could not load this canvas. Try again.",
                  );
                }
              }
            : undefined
        }
        onSortIntoPiles={isOwner ? () => setSortPilesOpen(true) : undefined}
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

      {collaborationConnectionMessage && (
        <Box sx={{ px: 2, py: 1 }}>
          <Alert
            severity="warning"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => window.location.reload()}
              >
                Refresh
              </Button>
            }
          >
            {collaborationConnectionMessage}
          </Alert>
        </Box>
      )}

      <CanvasAccessiblePanel
        canvasId={canvasId}
        capabilities={capabilities}
        searchQuery={searchQuery}
        searchMatchIds={searchMatchIds}
        selectedItemIds={selectedItemIds}
        onSelectItem={(itemId) => handleSelectItem(itemId, false)}
        onActivateItem={handleActivateItem}
        onNudgeItem={handleNudgeItem}
        onDeleteItem={handleDeleteItem}
        onCreateItem={() => setNoteDialogOpen(true)}
        canvasName={canvasName}
      />

      {viewMode === "manual" &&
        !isPresentationMode &&
        canEdit &&
        activeTool === "draw" && <DrawingToolbar />}

      {viewMode === "organizer" ? (
        <CanvasOrganizerView
          canvasId={canvasId}
          items={allItems}
          itemCount={totalItemCount}
        />
      ) : (
        <Box
          ref={stageContainerRef}
          role="region"
          aria-label="Infinite canvas. An equivalent keyboard- and screen-reader-accessible item list is available from the skip control."
          sx={{
            flexGrow: 1,
            position: "relative",
            overflow: "hidden",
            cursor: isDrawing ? "crosshair" : "default",
            bgcolor: appColor("canvasBackground"),
          }}
        >
          {totalItemCount > allItems.length && (
            <Box
              role="status"
              sx={{
                position: "absolute",
                zIndex: 2,
                left: 12,
                bottom: 12,
                px: 1.25,
                py: 0.5,
                borderRadius: 1,
                bgcolor: "background.paper",
                color: "text.secondary",
                boxShadow: 1,
                pointerEvents: "none",
                fontSize: "0.75rem",
              }}
            >
              {allItems.length} detailed items in this viewport; all{" "}
              {totalItemCount} remain indexed for navigation and accessibility.
            </Box>
          )}
          {!isPresentationMode && canEdit && (
            <CanvasAddBar
              onAddNote={() => setNoteDialogOpen(true)}
              onAddLink={() => setBookmarkDialogOpen(true)}
              onAddImage={() => setImageDialogOpen(true)}
              onAddPoll={
                isLaunchCapabilityEnabled("polls")
                  ? () => setPollDialogOpen(true)
                  : undefined
              }
            />
          )}
          {!isPresentationMode && (
            <CanvasViewControls
              zoom={zoom}
              onZoomChange={setZoom}
              onFitToScreen={fitToScreen}
              gridVisible={gridVisible}
              onGridToggle={() => setGridVisible(!gridVisible)}
              snapEnabled={snapToGridEnabled}
              onSnapToggle={
                canEdit
                  ? () => setSnapToGridEnabled(!snapToGridEnabled)
                  : undefined
              }
            />
          )}
          {isOwner &&
            isInboxBoardName(canvasName) &&
            !isDrawing &&
            !isPresentationMode &&
            !isTimeMachineActive && (
              <HomeBoardSuggestions
                canvasId={canvasId}
                items={allItems}
                zoom={zoom}
                position={position}
                stageSize={stageSize}
              />
            )}
          {!isDrawing && !isPresentationMode && (
            <UploadNoteOffer
              canvasId={canvasId}
              canEdit={canEdit}
              selectedItem={
                selectedItemIds.size <= 1
                  ? (allItems.find((item) => item.id === selectedItemId) ??
                    null)
                  : null
              }
              getViewportCenter={() =>
                viewportCenterWorld(position, stageSize, zoom)
              }
            />
          )}

          <Stage
            width={stageSize.width}
            height={stageSize.height}
            scaleX={zoom}
            scaleY={zoom}
            x={position.x}
            y={position.y}
            draggable={!isDrawing && isSpacePressed && !isTimeMachineActive}
            onDragMove={(event) => {
              const next = stageDragPosition(event);
              if (next) followStagePan(next);
            }}
            onDragEnd={(event) => {
              const next = stageDragPosition(event);
              if (next) setPosition(next);
            }}
            onWheel={(event) => {
              event.evt.preventDefault();
              const stage = event.target.getStage();
              const pointer = stage?.getPointerPosition();
              if (!stage || !pointer) return;
              const factor = event.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
              const nextZoom = Math.min(5, Math.max(0.1, zoom * factor));
              // The stage's own offset: mid-pan, React's position may lag.
              const worldX = (pointer.x - stage.x()) / zoom;
              const worldY = (pointer.y - stage.y()) / zoom;
              setZoom(nextZoom);
              setPosition({
                x: pointer.x - worldX * nextZoom,
                y: pointer.y - worldY * nextZoom,
              });
            }}
            onMouseDown={isSpacePressed ? undefined : handleStageMouseDown}
            onMouseMove={(event) => {
              if (!isSpacePressed) handleStageMouseMove(event);
              const stage = event.target.getStage();
              const pointer = stage?.getPointerPosition();
              if (stage && pointer) {
                updateCursor(
                  (pointer.x - stage.x()) / zoom,
                  (pointer.y - stage.y()) / zoom,
                );
              }
            }}
            onMouseUp={isSpacePressed ? undefined : handleStageMouseUp}
            onClick={handleStageClick}
            ref={stageRef}
            onContextMenu={(e) => e.evt.preventDefault()}
          >
            <DotOverlay
              width={stageSize.width + VIEWPORT_STEP_PX * 2}
              height={stageSize.height + VIEWPORT_STEP_PX * 2}
              zoom={zoom}
              gridSize={20}
              offset={gridOffset}
              visible={!gridVisible}
              stroke={CANVAS_PALETTE[themeMode].dot}
            />
            <GridOverlay
              width={stageSize.width + VIEWPORT_STEP_PX * 2}
              height={stageSize.height + VIEWPORT_STEP_PX * 2}
              zoom={zoom}
              gridSize={20}
              offset={gridOffset}
              visible={gridVisible}
              stroke={gridStroke}
            />
            <CanvasItemLayer
              items={exportItems ?? visibleItems}
              allItems={exportItems ?? items}
              onMoveArrowEnd={exportItems ? undefined : stableMoveArrowEnd}
              selectedItemIds={exportItems ? NO_SELECTION : selectedItemIds}
              isSelecting={exportItems ? false : isSelecting}
              selectionBox={exportItems ? null : selectionBox}
              capabilities={capabilities}
              onSelectItem={stableSelectItem}
              onContextMenu={stableContextMenu}
              onActivateItem={stableActivateItem}
              onCommitGeometry={stableCommitGeometry}
              searchActive={!exportItems && Boolean(searchQuery.trim())}
              searchMatchIds={searchMatchIds}
            />
            <DrawingPreview
              currentPath={currentPath}
              currentCreation={currentCreation}
              zoom={zoom}
              previewStroke={CANVAS_PALETTE[themeMode].ink}
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
                      kind: "cursor_chat",
                      message: msg,
                      position: { x: canvasX, y: canvasY },
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
                      kind: "reaction",
                      emoji: emoji,
                      position: { x: canvasX, y: canvasY },
                    });
                  }
                }
                setReactionOpen(false);
              }}
              onClose={() => setReactionOpen(false)}
            />
          )}

          {/* IMP-103: shifted by followStagePan while a pan is in flight. */}
          <Box
            ref={panOverlayRef}
            sx={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            {cursors
              .filter((cursor) => cursor.userId !== session?.user?.id)
              .map((cursor) => {
                const collaborator = collaborators.find(
                  (candidate) => candidate.userId === cursor.userId,
                );
                const screenX = cursor.position.x * zoom + position.x;
                const screenY = cursor.position.y * zoom + position.y;
                return (
                  <RemoteCursor
                    key={cursor.userId}
                    userId={cursor.userId}
                    name={
                      collaborator?.name ||
                      collaborator?.email ||
                      "Collaborator"
                    }
                    color={cursor.color}
                    x={screenX}
                    y={screenY}
                  />
                );
              })}

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
          </Box>

          {selectedItemId &&
            selectedItemIds.size === 1 &&
            !isPresentationMode && (
              <Box
                sx={{ position: "absolute", top: 80, right: 16, zIndex: 10 }}
              >
                <LinkedItemsPanel
                  itemId={selectedItemId}
                  items={items}
                  onJump={jumpToItem}
                />
              </Box>
            )}

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

      <ArrowLabelDialog
        content={(labelArrow?.content as ArrowContent | undefined) ?? null}
        onClose={() => setLabelArrow(null)}
        onSave={(content) => {
          if (labelArrow) {
            saveArrow(labelArrow, {
              content: content as CanvasItem["content"],
            });
          }
          setLabelArrow(null);
        }}
      />

      <CanvasDialogs
        // Every opener of an item dialog reads the preview capabilities;
        // the base ones keep version restore available while previewing.
        capabilities={baseCapabilities}
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
          onRestore={
            canRestore
              ? async (version) => {
                  setPendingRestoreVersionId(version.id);
                }
              : undefined
          }
        />
      )}
      {isOwner && (
        <SortIntoPilesDialog
          canvasId={canvasId}
          open={sortPilesOpen}
          onClose={() => setSortPilesOpen(false)}
          onApplied={() => setFitAfterSortFrom(boundsKey)}
        />
      )}
      <ConfirmDialog
        open={pendingAutopilotActions.length > 0}
        title="Apply automatic layout?"
        message={`Autopilot will reorganize ${pendingAutopilotActions.length} items in one atomic update.`}
        confirmLabel="Apply layout"
        onClose={() => setPendingAutopilotActions([])}
        onConfirm={async () => {
          if (
            documentSession?.acceptsWrites &&
            pendingAutopilotActions.every((action) =>
              documentSession.hasItem(action.itemId),
            )
          ) {
            // One document change, stored by the sync server in one
            // transaction like the batch request below.
            try {
              documentSession.updateItems(
                pendingAutopilotActions.map((action) => ({
                  itemId: action.itemId,
                  changes: {
                    positionX: action.newPosition.x,
                    positionY: action.newPosition.y,
                  },
                })),
              );
            } catch {
              toast.error(
                "The layout could not be applied. Refresh and try again.",
              );
              return;
            }
            setPendingAutopilotActions([]);
            return;
          }
          const itemsToUpdate = pendingAutopilotActions.flatMap((action) => {
            const item = pendingAutopilotItems.find(
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
          const applied = await runConfirmAction(async () => {
            const response = await fetch("/api/v1/canvas-items", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ canvasId, items: itemsToUpdate }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
          }, "The layout could not be applied. Refresh and try again.");
          // A failure keeps the dialog open so the layout can be retried.
          if (!applied) return;
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
          const versionId = pendingRestoreVersionId;
          const restored = await runConfirmAction(
            () => restoreVersion({ canvasId, versionId }).then(() => undefined),
            "The version could not be restored. Try again.",
          );
          // A failure keeps the dialog open so the restore can be retried.
          if (!restored) return;
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
