/**
 * Autosave hook with debouncing
 * Following ADR-0009: Autosave Delta Updates
 *
 * Debounces updates in 250-500ms windows to reduce write amplification
 *
 * FIXED: Issue #9 - Memory leak from unstable cleanup effect
 * FIXED: Debugging audit - Race condition between flush() and timer
 */

import { useEffect, useRef, useCallback } from 'react';
import { useUpdateCanvasItem } from './use-canvas-items';
import { UpdateCanvasItemInput } from '@/lib/validation/canvas-item';
import { AUTOSAVE_DEBOUNCE_MS } from '@/lib/constants';

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
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
  onSuccess,
  onError,
}: UseAutosaveOptions) {
  const updateItem = useUpdateCanvasItem();
  const pendingChangesRef = useRef<Partial<UpdateCanvasItemInput>>({});
  const timerRef = useRef<NodeJS.Timeout>();
  const currentVersionRef = useRef(version);
  const isFlushingRef = useRef(false); // FIXED: Track flush state to prevent race condition

  // Store callbacks in refs to avoid recreating flush on every callback change
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  // Update refs when they change
  useEffect(() => {
    currentVersionRef.current = version;
  }, [version]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  /**
   * Flush pending changes immediately
   * Stable function that doesn't depend on callbacks
   *
   * FIXED: Added flag to prevent race condition when flush is called
   * while timer is still pending
   */
  const flush = useCallback(() => {
    // Prevent multiple simultaneous flushes
    if (isFlushingRef.current) {
      return;
    }

    if (Object.keys(pendingChangesRef.current).length === 0) {
      return;
    }

    isFlushingRef.current = true;
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
          isFlushingRef.current = false;
          onSuccessRef.current?.();
        },
        onError: (error) => {
          isFlushingRef.current = false;
          onErrorRef.current?.(error as Error);
        },
      }
    );
  }, [itemId, updateItem]);

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
        timerRef.current = undefined; // Clear ref after flush
      }, debounceMs);
    },
    [flush, debounceMs]
  );

  /**
   * Cleanup: flush on unmount
   *
   * FIXED: Now depends on stable flush function
   * This prevents the effect from re-running on every callback change,
   * which was causing potential memory leaks and duplicate timers
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
