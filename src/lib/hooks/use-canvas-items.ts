/**
 * Canvas Items Data Hooks
 *
 * TanStack Query hooks for managing canvas items (notes, bookmarks, etc.).
 * Provides CRUD operations with optimistic updates and cache management.
 *
 * @module lib/hooks/use-canvas-items
 *
 * ## Architecture
 * Per ADR-0005 (State Management Policy):
 * - Server-persisted item data is managed here with TanStack Query
 * - Ephemeral UI state (selection, drag) is in Zustand store
 *
 * Per ADR-0009 (Autosave Delta Updates):
 * - Optimistic concurrency control with version numbers
 * - Automatic cache invalidation on mutations
 * - Version mismatch handling with data refetch
 *
 * ## Viewport-Based Loading
 * Supports efficient pagination for large canvases by loading only visible items:
 * ```typescript
 * useCanvasItems(canvasId, undefined, {
 *   minX: viewportX,
 *   maxX: viewportX + viewportWidth,
 *   minY: viewportY,
 *   maxY: viewportY + viewportHeight,
 *   limit: 100
 * });
 * ```
 *
 * ## Real-Time Updates (Issue #31)
 * ENHANCED with polling-based real-time updates for collaboration:
 * - Adaptive polling: 5s (active tab) / 30s (inactive tab)
 * - Page Visibility API for automatic frequency adjustment
 * - Zero overhead when disabled for private canvases
 *
 * @see {@link useAutosave} for debounced autosave implementation
 * @see {@link useCanvasHistory} for undo/redo with items
 * @see {@link useCanvasItemsWithPolling} for collaborative real-time updates
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ItemType, CanvasItem } from '@/types/canvas';
import {
  CreateCanvasItemInput,
  UpdateCanvasItemInput,
  DeleteCanvasItemInput,
} from '@/lib/validation/canvas-item';
import {
  POLLING_INTERVAL_ACTIVE_MS,
  POLLING_INTERVAL_INACTIVE_MS,
  ENABLE_COLLABORATIVE_POLLING,
} from '@/lib/constants';

/**
 * Viewport parameters for viewport-based loading
 */
export interface ViewportParams {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  limit?: number;
  offset?: number;
}

/**
 * API client functions
 */
const api = {
  async listItems(canvasId: string, type?: ItemType, viewport?: ViewportParams) {
    const params = new URLSearchParams({ canvasId });
    if (type) params.set('type', type);

    // Add viewport parameters if provided
    if (viewport) {
      params.set('minX', viewport.minX.toString());
      params.set('maxX', viewport.maxX.toString());
      params.set('minY', viewport.minY.toString());
      params.set('maxY', viewport.maxY.toString());
      if (viewport.limit !== undefined) params.set('limit', viewport.limit.toString());
      if (viewport.offset !== undefined) params.set('offset', viewport.offset.toString());
    }

    const response = await fetch(`/api/v1/canvas-items?${params}`);
    if (!response.ok) throw new Error('Failed to fetch items');

    const data = await response.json();
    return {
      items: data.items as CanvasItem[],
      total: data.total,
      offset: data.offset,
      limit: data.limit,
    };
  },

  async getItem(itemId: string) {
    const response = await fetch(`/api/v1/canvas-items/${itemId}`);
    if (!response.ok) throw new Error('Failed to fetch item');

    return response.json() as Promise<CanvasItem>;
  },

  async createItem(input: CreateCanvasItemInput) {
    const response = await fetch('/api/v1/canvas-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create item');
    }

    return response.json() as Promise<CanvasItem>;
  },

  async updateItem(itemId: string, input: UpdateCanvasItemInput) {
    const response = await fetch(`/api/v1/canvas-items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to update item');
    }

    return response.json() as Promise<CanvasItem>;
  },

  async deleteItem(itemId: string, input: DeleteCanvasItemInput) {
    const response = await fetch(`/api/v1/canvas-items/${itemId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to delete item');
    }

    return response.json();
  },
};

/**
 * Query keys factory
 */
export const canvasItemKeys = {
  all: ['canvas-items'] as const,
  lists: () => [...canvasItemKeys.all, 'list'] as const,
  list: (canvasId: string, type?: ItemType, viewport?: ViewportParams) =>
    [...canvasItemKeys.lists(), { canvasId, type, viewport }] as const,
  detail: (itemId: string) => [...canvasItemKeys.all, 'detail', itemId] as const,
};

/**
 * Fetch all items for a canvas with optional type filtering and viewport pagination
 *
 * Retrieves canvas items with optional viewport-based pagination for efficient
 * rendering of large canvases. Supports filtering by item type (note, bookmark, etc.).
 *
 * @param canvasId - The canvas to fetch items from
 * @param type - Optional filter by item type (note, bookmark, etc.)
 * @param viewport - Optional viewport bounds for spatial pagination
 * @returns TanStack Query result with items array and pagination metadata
 *
 * @example
 * ```typescript
 * // Load all items
 * const { data, isLoading } = useCanvasItems('canvas-123');
 *
 * // Load only notes
 * const { data } = useCanvasItems('canvas-123', 'note');
 *
 * // Load items in viewport (efficient for large canvases)
 * const { data } = useCanvasItems('canvas-123', undefined, {
 *   minX: viewportX,
 *   maxX: viewportX + viewportWidth,
 *   minY: viewportY,
 *   maxY: viewportY + viewportHeight,
 *   limit: 100
 * });
 * ```
 */
export function useCanvasItems(canvasId: string, type?: ItemType, viewport?: ViewportParams) {
  return useQuery({
    queryKey: canvasItemKeys.list(canvasId, type, viewport),
    queryFn: () => api.listItems(canvasId, type, viewport),
    enabled: !!canvasId,
  });
}

/**
 * Fetch a single canvas item by ID
 *
 * Retrieves detailed information about a specific canvas item.
 * Data is cached and automatically updated when mutations occur.
 *
 * @param itemId - The unique item identifier
 * @returns TanStack Query result with item data
 *
 * @example
 * ```typescript
 * function ItemDetail({ itemId }: { itemId: string }) {
 *   const { data: item, isLoading } = useCanvasItem(itemId);
 *   if (isLoading) return <div>Loading...</div>;
 *   return <div>{item.type}: {JSON.stringify(item.content)}</div>;
 * }
 * ```
 */
export function useCanvasItem(itemId: string) {
  return useQuery({
    queryKey: canvasItemKeys.detail(itemId),
    queryFn: () => api.getItem(itemId),
    enabled: !!itemId,
  });
}

/**
 * Custom hook to track page visibility for adaptive polling
 * Uses the Page Visibility API to detect when tab is active/inactive
 *
 * FEATURE: Issue #31 - Real-time updates with adaptive polling
 */
function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    // Set initial visibility
    setIsVisible(!document.hidden);

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

/**
 * List canvas items with polling-based real-time updates
 *
 * FEATURE: Issue #31 - Real-time updates for collaboration
 *
 * This hook extends useCanvasItems with adaptive polling that:
 * - Polls every 5 seconds when tab is active
 * - Polls every 30 seconds when tab is inactive (battery/resource saving)
 * - Automatically pauses when polling is disabled
 * - Provides near real-time collaboration without WebSocket infrastructure
 *
 * Usage for shared canvases:
 * ```
 * const { data, isLoading } = useCanvasItemsWithPolling(canvasId, {
 *   enablePolling: canvas.isShared, // Only poll for shared canvases
 *   viewport: { minX, maxX, minY, maxY },
 * });
 * ```
 *
 * @param canvasId - The canvas ID to fetch items for
 * @param options - Configuration options
 * @param options.type - Optional item type filter
 * @param options.viewport - Optional viewport parameters for efficient loading
 * @param options.enablePolling - Enable/disable polling (default: true for shared canvases)
 */
export function useCanvasItemsWithPolling(
  canvasId: string,
  options?: {
    type?: ItemType;
    viewport?: ViewportParams;
    enablePolling?: boolean;
  }
) {
  const isPageVisible = usePageVisibility();
  const { type, viewport, enablePolling = ENABLE_COLLABORATIVE_POLLING } = options || {};

  // Determine refetch interval based on visibility and polling config
  const refetchInterval =
    enablePolling && isPageVisible
      ? POLLING_INTERVAL_ACTIVE_MS // 5s when active
      : enablePolling && !isPageVisible
      ? POLLING_INTERVAL_INACTIVE_MS // 30s when inactive
      : false; // No polling if disabled

  return useQuery({
    queryKey: canvasItemKeys.list(canvasId, type, viewport),
    queryFn: () => api.listItems(canvasId, type, viewport),
    enabled: !!canvasId,
    refetchInterval,
    // Keep previous data while refetching to prevent UI flicker
    placeholderData: (previousData) => previousData,
    // Refetch on window focus for immediate updates when user returns
    refetchOnWindowFocus: enablePolling,
    // Stale time matches polling interval to prevent redundant fetches
    staleTime: enablePolling ? POLLING_INTERVAL_ACTIVE_MS : Infinity,
  });
}

/**
 * Create a new canvas item
 *
 * OPTIMIZED: Issue #29 - Optimistic updates for better UX
 * Creates item in cache immediately, rolls back on error
 *
 * Mutates server state to create a new item (note, bookmark, etc.).
 * Automatically invalidates canvas item list queries on success.
 *
 * @returns TanStack Query mutation result
 *
 * @example
 * ```typescript
 * function AddNoteButton({ canvasId }: { canvasId: string }) {
 *   const createItem = useCreateCanvasItem();
 *
 *   const handleClick = async () => {
 *     await createItem.mutateAsync({
 *       canvasId,
 *       type: 'note',
 *       positionX: 100,
 *       positionY: 100,
 *       width: 300,
 *       height: 200,
 *       content: { text: '', backgroundColor: '#FFFACD' }
 *     });
 *   };
 *
 *   return <button onClick={handleClick}>Add Note</button>;
 * }
 * ```
 */
export function useCreateCanvasItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createItem,
    onMutate: async (newItem) => {
      // Cancel outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries({
        queryKey: canvasItemKeys.list(newItem.canvasId),
      });

      // Snapshot previous value for rollback
      const previousItems = queryClient.getQueryData(
        canvasItemKeys.list(newItem.canvasId)
      );

      // Optimistically update cache with temporary item
      const optimisticItem = {
        ...newItem,
        id: `temp-${Date.now()}`, // Temporary ID
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };

      queryClient.setQueryData(
        canvasItemKeys.list(newItem.canvasId),
        (old: any) => ({
          ...old,
          items: old ? [...old.items, optimisticItem] : [optimisticItem],
        })
      );

      return { previousItems };
    },
    onSuccess: (newItem) => {
      // Invalidate list queries for this canvas to get real server data
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.list(newItem.canvasId),
      });
    },
    onError: (err, newItem, context) => {
      // Rollback on error
      if (context?.previousItems) {
        queryClient.setQueryData(
          canvasItemKeys.list(newItem.canvasId),
          context.previousItems
        );
      }
    },
  });
}

/**
 * Update an existing canvas item
 *
 * OPTIMIZED: Issue #29 - Optimistic updates for better UX
 * Updates item in cache immediately, rolls back on error
 *
 * Mutates server state to update item properties (position, size, content).
 * Implements optimistic concurrency control with version numbers (ADR-0009).
 * Automatically handles version mismatches by refetching data.
 *
 * @returns TanStack Query mutation result
 *
 * @example
 * ```typescript
 * function DraggableItem({ item }: { item: CanvasItem }) {
 *   const updateItem = useUpdateCanvasItem();
 *
 *   const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
 *     updateItem.mutate({
 *       itemId: item.id,
 *       data: {
 *         version: item.version,
 *         positionX: e.target.x(),
 *         positionY: e.target.y()
 *       }
 *     });
 *   };
 *
 *   return <Group draggable onDragEnd={handleDragEnd}>...</Group>;
 * }
 * ```
 */
export function useUpdateCanvasItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: UpdateCanvasItemInput }) =>
      api.updateItem(itemId, data),
    onMutate: async ({ itemId, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: canvasItemKeys.detail(itemId),
      });

      // Snapshot previous value
      const previousItem = queryClient.getQueryData(canvasItemKeys.detail(itemId));

      // Optimistically update the item in detail cache
      queryClient.setQueryData(canvasItemKeys.detail(itemId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          ...data,
          updatedAt: new Date().toISOString(),
        };
      });

      // Also update in list caches
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.lists() },
        (old: any) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.map((item: any) =>
              item.id === itemId
                ? { ...item, ...data, updatedAt: new Date().toISOString() }
                : item
            ),
          };
        }
      );

      return { previousItem, itemId };
    },
    onSuccess: (updatedItem) => {
      // Update cache with real server data
      queryClient.setQueryData(canvasItemKeys.detail(updatedItem.id), updatedItem);

      // Invalidate list queries to ensure consistency
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.list(updatedItem.canvasId),
      });
    },
    onError: (error: Error, variables, context) => {
      // Rollback on error
      if (context?.previousItem) {
        queryClient.setQueryData(
          canvasItemKeys.detail(context.itemId),
          context.previousItem
        );
      }

      // Handle version mismatch - refetch all data
      if (error.message.includes('Version mismatch')) {
        queryClient.invalidateQueries({
          queryKey: canvasItemKeys.all,
        });
      }
    },
  });
}

/**
 * Delete a canvas item
 *
 * OPTIMIZED: Issue #29 - Optimistic updates for better UX
 * Removes item from cache immediately, rolls back on error
 *
 * Mutates server state to permanently delete an item.
 * Requires version number for optimistic concurrency control.
 * Automatically invalidates all item queries on success.
 *
 * @returns TanStack Query mutation result
 *
 * @example
 * ```typescript
 * function DeleteButton({ item }: { item: CanvasItem }) {
 *   const deleteItem = useDeleteCanvasItem();
 *
 *   const handleDelete = async () => {
 *     if (confirm('Delete this item?')) {
 *       await deleteItem.mutateAsync({
 *         itemId: item.id,
 *         version: item.version
 *       });
 *     }
 *   };
 *
 *   return <button onClick={handleDelete}>Delete</button>;
 * }
 * ```
 */
export function useDeleteCanvasItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, version }: { itemId: string; version: number }) =>
      api.deleteItem(itemId, { version }),
    onMutate: async ({ itemId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: canvasItemKeys.all,
      });

      // Snapshot all list caches that might contain this item
      const previousListQueries = queryClient.getQueriesData({
        queryKey: canvasItemKeys.lists(),
      });

      // Optimistically remove item from all list caches
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.lists() },
        (old: any) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.filter((item: any) => item.id !== itemId),
          };
        }
      );

      // Remove from detail cache
      queryClient.removeQueries({
        queryKey: canvasItemKeys.detail(itemId),
      });

      return { previousListQueries, itemId };
    },
    onSuccess: () => {
      // Invalidate queries to ensure consistency
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.all,
      });
    },
    onError: (err, variables, context) => {
      // Rollback all list caches on error
      if (context?.previousListQueries) {
        context.previousListQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }

      // Refetch to ensure we have latest data
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.all,
      });
    },
  });
}
