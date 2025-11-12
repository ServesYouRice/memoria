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
 * @see {@link useAutosave} for debounced autosave implementation
 * @see {@link useCanvasHistory} for undo/redo with items
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ItemType, CanvasItem } from '@/types/canvas';
import {
  CreateCanvasItemInput,
  UpdateCanvasItemInput,
  DeleteCanvasItemInput,
} from '@/lib/validation/canvas-item';

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
 * Create a new canvas item
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
    onSuccess: (newItem) => {
      // Invalidate list queries for this canvas
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.list(newItem.canvasId),
      });
    },
  });
}

/**
 * Update an existing canvas item
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
    onSuccess: (updatedItem) => {
      // Update cache with new version
      queryClient.setQueryData(canvasItemKeys.detail(updatedItem.id), updatedItem);

      // Invalidate list queries
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.list(updatedItem.canvasId),
      });
    },
    onError: (error: Error) => {
      // Handle version mismatch - refetch data
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
    onSuccess: (_, variables) => {
      // Invalidate queries
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.all,
      });
    },
  });
}
