/**
 * Autosave hook with debouncing
 * Following ADR-0009: Autosave Delta Updates
 *
 * Debounces updates in 250-500ms windows to reduce write amplification
 */

import { useEffect, useRef, useCallback } from 'react';
import { useUpdateCanvasItem } from './use-canvas-items';
import { UpdateCanvasItemInput } from '@/lib/validation/canvas-item';

interface UseAutosaveOptions {
  itemId: string;
  version: number;
  debounceMs?: number;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Autosave hook that debounces updates
 *
 * Usage:
 * ```
 * const { saveChanges, isSaving } = useAutosave({
 *   itemId: item.id,
 *   version: item.version,
 *   debounceMs: 500,
 * });
 *
 * // In drag handler:
 * saveChanges({ positionX: newX, positionY: newY });
 * ```
 */
export function useAutosave({
  itemId,
  version,
  debounceMs = 500,
  onSuccess,
  onError,
}: UseAutosaveOptions) {
  const updateItem = useUpdateCanvasItem();
  const pendingChangesRef = useRef<Partial<UpdateCanvasItemInput>>({});
  const timerRef = useRef<NodeJS.Timeout>();
  const currentVersionRef = useRef(version);

  // Update version ref when it changes
  useEffect(() => {
    currentVersionRef.current = version;
  }, [version]);

  /**
   * Flush pending changes immediately
   */
  const flush = useCallback(() => {
    if (Object.keys(pendingChangesRef.current).length === 0) {
      return;
    }

    const changes = { ...pendingChangesRef.current };
    pendingChangesRef.current = {};

    updateItem.mutate(
      {
        itemId,
        data: {
          ...changes,
          version: currentVersionRef.current,
        },
      },
      {
        onSuccess: () => {
          onSuccess?.();
        },
        onError: (error) => {
          onError?.(error as Error);
        },
      }
    );
  }, [itemId, updateItem, onSuccess, onError]);

  /**
   * Save changes with debouncing
   */
  const saveChanges = useCallback(
    (changes: Partial<UpdateCanvasItemInput>) => {
      // Merge with pending changes
      Object.assign(pendingChangesRef.current, changes);

      // Clear existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Set new timer
      timerRef.current = setTimeout(() => {
        flush();
      }, debounceMs);
    },
    [flush, debounceMs]
  );

  /**
   * Cleanup: flush on unmount
   */
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      flush();
    };
  }, [flush]);

  return {
    saveChanges,
    flush,
    isSaving: updateItem.isPending,
    error: updateItem.error,
  };
}
