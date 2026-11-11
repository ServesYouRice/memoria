import { useEffect } from "react";
import type Konva from "konva";
import { type CanvasItem } from "@/types/canvas";
import { shouldIgnoreGlobalShortcut } from "@/lib/keyboard/shortcuts";

interface UseCanvasKeyboardProps {
  onDelete: () => void;
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
  /** Moves through the serialized geometry queue (useItemGeometry). */
  nudgeItem: (item: CanvasItem, deltaX: number, deltaY: number) => void;
}

/**
 * Hook to handle global keyboard shortcuts for the canvas
 */
export function useCanvasKeyboard({
  onDelete,
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
  nudgeItem,
}: UseCanvasKeyboardProps) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused surface (such as the accessible item list) already acted on
      // this key. Acting again would repeat the move or delete; with live
      // co-editing no version check rejects the repeat.
      if (e.defaultPrevented) return;

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

          const ids = selectedItemId ? [selectedItemId] : [...selectedItemIds];
          for (const id of ids) {
            const item = allItems.find((i) => i.id === id);
            if (item) nudgeItem(item, dx, dy);
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
    nudgeItem,
  ]);
}
