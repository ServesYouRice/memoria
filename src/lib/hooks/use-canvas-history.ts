/**
 * Canvas History Hook
 *
 * Implements undo/redo functionality using the Command pattern
 * Tracks canvas operations and allows users to undo/redo changes
 */

import { useState, useCallback, useRef } from 'react';
import { CanvasItem, ItemType } from '@/types/canvas';

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
      console.error('Undo failed:', error);
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
      console.error('Redo failed:', error);
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
