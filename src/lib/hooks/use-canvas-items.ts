/**
 * TanStack Query hooks for Canvas Items
 * Following ADR-0005: State Management Policy
 * Server state is managed via TanStack Query
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
 * List all items for a canvas with optional viewport-based pagination
 *
 * Usage without viewport (loads all items):
 * ```
 * useCanvasItems(canvasId)
 * ```
 *
 * Usage with viewport (efficient pagination for large canvases):
 * ```
 * useCanvasItems(canvasId, undefined, {
 *   minX: viewportX,
 *   maxX: viewportX + viewportWidth,
 *   minY: viewportY,
 *   maxY: viewportY + viewportHeight,
 *   limit: 100,
 * })
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
 * Get a specific item
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
 * Update a canvas item
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
