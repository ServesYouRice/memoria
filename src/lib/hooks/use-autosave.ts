/**
 * Autosave Hook with Debouncing
 *
 * Provides debounced autosave functionality for canvas items to reduce
 * write amplification while maintaining data consistency.
 *
 * @module lib/hooks/use-autosave
 *
 * ## Architecture
 * Per ADR-0009 (Autosave Delta Updates):
 * - Debounces updates in 250-500ms windows
 * - Merges pending changes to reduce API calls
 * - Flushes on unmount to prevent data loss
 * - Uses optimistic concurrency control with versions
 *
 * ## Typical Use Case
 * Ideal for high-frequency updates like dragging, resizing, or typing.
 * Changes are batched and sent as a single PATCH request after the
 * debounce period expires.
 *
 * @example
 * ```typescript
 * // In a draggable component
 * const { saveChanges, isSaving } = useAutosave({
 *   itemId: item.id,
 *   version: item.version,
 *   debounceMs: 500
 * });
 *
 * const handleDrag = (e: KonvaEventObject<DragEvent>) => {
 *   // This will be debounced - multiple calls merge into one request
 *   saveChanges({
 *     positionX: e.target.x(),
 *     positionY: e.target.y()
 *   });
 * };
 * ```
 *
 * @see {@link useUpdateCanvasItem} for the underlying mutation hook
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
 * Create an autosave hook for a canvas item
 *
 * Provides debounced save functionality that batches multiple changes
 * into a single API call. Automatically flushes pending changes on unmount.
 *
 * @param options - Configuration options
 * @param options.itemId - The item to autosave
 * @param options.version - Current item version (for OCC)
 * @param options.debounceMs - Debounce delay in milliseconds (default: 500)
 * @param options.onSuccess - Callback fired after successful save
 * @param options.onError - Callback fired on save error
 * @returns Hook utilities for saving and checking status
 *
 * @example
 * ```typescript
 * function DraggableNote({ item }: { item: CanvasItem }) {
 *   const { saveChanges, isSaving, flush } = useAutosave({
 *     itemId: item.id,
 *     version: item.version,
 *     debounceMs: 500,
 *     onError: (error) => toast.error(error.message)
 *   });
 *
 *   const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
 *     saveChanges({
 *       positionX: e.target.x(),
 *       positionY: e.target.y()
 *     });
 *   };
 *
 *   const handleDragEnd = () => {
 *     flush(); // Save immediately on drag end
 *   };
 *
 *   return (
 *     <Group
 *       draggable
 *       onDragMove={handleDragMove}
 *       onDragEnd={handleDragEnd}
 *     >
 *       {isSaving && <Text text="Saving..." />}
 *     </Group>
 *   );
 * }
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
