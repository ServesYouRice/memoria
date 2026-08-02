import { useEffect } from "react";
import type Konva from "konva";
import { type CanvasItem } from "@/types/canvas";
import { shouldIgnoreGlobalShortcut } from "@/lib/keyboard/shortcuts";

interface UseCanvasKeyboardProps {
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onDuplicate: () => void;
  onEscape: () => void;
  enabled?: boolean;
  canEdit?: boolean;

  // New Props for Shortcuts & Navigation
  isDrawing: boolean;
  stageRef: React.RefObject<Konva.Stage>;
  onChatOpen: (pos: { x: number; y: number }) => void;
  onReactionOpen: (pos: { x: number; y: number }) => void;

  // Arrow Key Navigation
  selectedItemIds: Set<string>;
  selectedItemId: string | null;
  allItems: CanvasItem[];
  updateItem: (params: { itemId: string; data: any }) => void;
}

/**
 * Hook to handle global keyboard shortcuts for the canvas
 */
export function useCanvasKeyboard({
  onDelete,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onSelectAll,
  onDuplicate,
  onEscape,
  enabled = true,
  canEdit = true,

  isDrawing,
  stageRef,
  onChatOpen,
  onReactionOpen,

  selectedItemIds,
  selectedItemId,
  allItems,
  updateItem,
}: UseCanvasKeyboardProps) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Never intercept keystrokes owned by an editor, form control, or an open
      // dialog — those surfaces handle their own keys, including Escape.
      if (shouldIgnoreGlobalShortcut(e)) {
        return;
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Chat (/)
      if (e.key === "/" && !isDrawing) {
        e.preventDefault();
        const stage = stageRef.current;
        if (stage) {
          const ptr = stage.getPointerPosition();
          if (ptr) {
            onChatOpen({ x: ptr.x, y: ptr.y + 64 });
          }
        }
        return;
      }

      // Reaction (e)
      if (e.key === "e" && !isDrawing && !isCtrlOrCmd) {
        e.preventDefault();
        const stage = stageRef.current;
        if (stage) {
          const ptr = stage.getPointerPosition();
          if (ptr) {
            onReactionOpen({ x: ptr.x, y: ptr.y + 64 });
          }
        }
        return;
      }

      // Navigation (Arrows)
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        if (canEdit && (selectedItemId || selectedItemIds.size > 0)) {
          e.preventDefault();
          const MOVE_STEP = e.shiftKey ? 10 : 1;
          const dx =
            e.key === "ArrowLeft"
              ? -MOVE_STEP
              : e.key === "ArrowRight"
                ? MOVE_STEP
                : 0;
          const dy =
            e.key === "ArrowUp"
              ? -MOVE_STEP
              : e.key === "ArrowDown"
                ? MOVE_STEP
                : 0;

          if (selectedItemId) {
            const item = allItems.find((i) => i.id === selectedItemId);
            if (item) {
              updateItem({
                itemId: selectedItemId,
                data: {
                  positionX: item.positionX + dx,
                  positionY: item.positionY + dy,
                  version: item.version,
                },
              });
            }
          } else if (selectedItemIds.size > 0) {
            selectedItemIds.forEach((id) => {
              const item = allItems.find((i) => i.id === id);
              if (item) {
                updateItem({
                  itemId: id,
                  data: {
                    positionX: item.positionX + dx,
                    positionY: item.positionY + dy,
                    version: item.version,
                  },
                });
              }
            });
          }
          return;
        }
      }

      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!canEdit) return;
        e.preventDefault();
        onDelete();
        return;
      }

      // Escape
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
        return;
      }

      // Undo (Ctrl+Z)
      if (isCtrlOrCmd && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        onUndo();
        return;
      }

      // Redo (Ctrl+Shift+Z or Ctrl+Y)
      if (
        (isCtrlOrCmd && e.key === "z" && e.shiftKey) ||
        (isCtrlOrCmd && e.key === "y")
      ) {
        e.preventDefault();
        onRedo();
        return;
      }

      // Copy (Ctrl+C)
      if (isCtrlOrCmd && e.key === "c") {
        e.preventDefault();
        onCopy();
        return;
      }

      // Paste (Ctrl+V)
      if (isCtrlOrCmd && e.key === "v") {
        if (!canEdit) return;
        e.preventDefault();
        onPaste();
        return;
      }

      // Select All (Ctrl+A)
      if (isCtrlOrCmd && e.key === "a") {
        e.preventDefault();
        onSelectAll();
        return;
      }

      // Duplicate (Ctrl+D)
      if (isCtrlOrCmd && e.key === "d") {
        if (!canEdit) return;
        e.preventDefault();
        onDuplicate();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    canEdit,
    onDelete,
    onUndo,
    onRedo,
    onCopy,
    onPaste,
    onSelectAll,
    onDuplicate,
    onEscape,
    // Dependencies for new features
    isDrawing,
    stageRef,
    onChatOpen,
    onReactionOpen,
    selectedItemId,
    selectedItemIds,
    allItems,
    updateItem,
  ]);
}
