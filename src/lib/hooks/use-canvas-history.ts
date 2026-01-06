/**
 * Canvas History Hook
 *
 * Implements undo/redo functionality using the Command pattern.
 * Tracks canvas operations in command stacks and allows time-travel debugging.
 *
 * @module lib/hooks/use-canvas-history
 *
 * ## Architecture
 * Implements the Command pattern with:
 * - Undo/redo stacks with configurable size limits
 * - Atomic command execution with error handling
 * - Batch command support for grouped operations
 * - Automatic redo stack clearing on new commands
 *
 * ## Command Types
 * - `create`: Add new item to canvas
 * - `delete`: Remove item from canvas
 * - `update`: Modify existing item
 * - `batch`: Group multiple commands
 *
 * ## Future Enhancements
 * - Command serialization for session restore
 * - Network sync for collaborative editing
 * - Command merging for similar operations
 *
 * @example
 * ```typescript
 * function CanvasEditor({ canvasId }: { canvasId: string }) {
 *   const { addCommand, undo, redo, canUndo, canRedo } = useCanvasHistory({
 *     maxHistorySize: 50
 *   });
 *
 *   const handleCreateItem = async (item: CanvasItem) => {
 *     // Add command for undo/redo
 *     addCommand({
 *       type: 'create',
 *       description: `Create ${item.type}`,
 *       execute: async () => {
 *         await createItem(item);
 *       },
 *       undo: async () => {
 *         await deleteItem(item.id);
 *       }
 *     });
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={undo} disabled={!canUndo}>Undo</button>
 *       <button onClick={redo} disabled={!canRedo}>Redo</button>
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useRef } from 'react';
import { type CanvasItem } from '@/types/canvas';
import { logger } from '@/lib/logger';

export interface Command {
  type: 'create' | 'delete' | 'update' | 'batch';
  execute: () => Promise<void>;
  undo: () => Promise<void>;
  description: string;
}

export interface CreateCommand extends Command {
  type: 'create';
  itemId: string;
}

export interface DeleteCommand extends Command {
  type: 'delete';
  item: CanvasItem;
}

export interface UpdateCommand extends Command {
  type: 'update';
  itemId: string;
  oldData: Partial<CanvasItem>;
  newData: Partial<CanvasItem>;
}

export interface BatchCommand extends Command {
  type: 'batch';
  commands: Command[];
}

interface UseCanvasHistoryOptions {
  maxHistorySize?: number;
}

export function useCanvasHistory(options: UseCanvasHistoryOptions = {}) {
  const { maxHistorySize = 50 } = options;

  const [undoStack, setUndoStack] = useState<Command[]>([]);
  const [redoStack, setRedoStack] = useState<Command[]>([]);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isRedoing, setIsRedoing] = useState(false);

  // Track if we're currently executing a command
  const isExecutingRef = useRef(false);

  /**
   * Add a command to history
   */
  const addCommand = useCallback((command: Command) => {
    if (isExecutingRef.current) {
      // Don't add commands that are part of undo/redo
      return;
    }

    setUndoStack((prev) => {
      const newStack = [...prev, command];
      // Limit stack size
      if (newStack.length > maxHistorySize) {
        return newStack.slice(newStack.length - maxHistorySize);
      }
      return newStack;
    });

    // Clear redo stack when new command is added
    setRedoStack([]);
  }, [maxHistorySize]);

  /**
   * Undo last command
   */
  const undo = useCallback(async () => {
    if (undoStack.length === 0 || isExecutingRef.current) {
      return;
    }

    const command = undoStack[undoStack.length - 1];

    try {
      isExecutingRef.current = true;
      setIsUndoing(true);

      await command.undo();

      setUndoStack((prev) => prev.slice(0, -1));
      setRedoStack((prev) => [...prev, command]);
    } catch (error) {
      logger.error({ error, command: command.description }, 'Undo operation failed');
      throw error;
    } finally {
      isExecutingRef.current = false;
      setIsUndoing(false);
    }
  }, [undoStack]);

  /**
   * Redo last undone command
   */
  const redo = useCallback(async () => {
    if (redoStack.length === 0 || isExecutingRef.current) {
      return;
    }

    const command = redoStack[redoStack.length - 1];

    try {
      isExecutingRef.current = true;
      setIsRedoing(true);

      await command.execute();

      setRedoStack((prev) => prev.slice(0, -1));
      setUndoStack((prev) => [...prev, command]);
    } catch (error) {
      logger.error({ error, command: command.description }, 'Redo operation failed');
      throw error;
    } finally {
      isExecutingRef.current = false;
      setIsRedoing(false);
    }
  }, [redoStack]);

  /**
   * Clear history
   */
  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const canUndo = undoStack.length > 0 && !isExecutingRef.current;
  const canRedo = redoStack.length > 0 && !isExecutingRef.current;

  return {
    addCommand,
    undo,
    redo,
    clearHistory,
    canUndo,
    canRedo,
    isUndoing,
    isRedoing,
    undoStack,
    redoStack,
  };
}
