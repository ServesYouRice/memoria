/**
 * TanStack Query hooks for Canvases
 * Following ADR-0005: State Management Policy
 * Server state is managed via TanStack Query
 * Phase 3: Includes shared canvas support
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface Canvas {
  id: string;
  name: string;
  userId: string;
  zoomLevel: number;
  panX: number;
  panY: number;
  thumbnail?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SharedCanvas {
  id: string;
  name: string;
  thumbnail?: string | null;
  itemCount: number;
  owner: {
    name: string | null;
    email: string;
  };
  role: 'VIEW' | 'COMMENT' | 'EDIT';
  sharedAt: string;
  updatedAt: string;
}

export interface CreateCanvasInput {
  name?: string;
}

export interface CanvasesListResponse {
  canvases: Canvas[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * API client functions
 */
const api = {
  async listCanvases() {
    const response = await fetch('/api/v1/canvases');
    if (!response.ok) throw new Error('Failed to fetch canvases');
    return response.json() as Promise<CanvasesListResponse>;
  },

  async listSharedCanvases() {
    const response = await fetch('/api/v1/shared-canvases');
    if (!response.ok) throw new Error('Failed to fetch shared canvases');
    const data = await response.json();
    return data.canvases as SharedCanvas[];
  },

  async createCanvas(input: CreateCanvasInput) {
    const response = await fetch('/api/v1/canvases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create canvas');
    }

    return response.json() as Promise<Canvas>;
  },

  async duplicateCanvas(canvasId: string) {
    const response = await fetch(`/api/v1/canvases/${canvasId}/duplicate`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to duplicate canvas');
    }

    return response.json() as Promise<Canvas>;
  },
};

/**
 * Query keys factory
 */
export const canvasKeys = {
  all: ['canvases'] as const,
  lists: () => [...canvasKeys.all, 'list'] as const,
  list: () => [...canvasKeys.lists()] as const,
  sharedLists: () => [...canvasKeys.all, 'shared'] as const,
  sharedList: () => [...canvasKeys.sharedLists()] as const,
};

/**
 * List all canvases for the current user
 */
export function useCanvases() {
  return useQuery({
    queryKey: canvasKeys.list(),
    queryFn: api.listCanvases,
  });
}

/**
 * List canvases shared with the current user
 * Phase 3: Collaboration feature
 */
export function useSharedCanvases() {
  return useQuery({
    queryKey: canvasKeys.sharedList(),
    queryFn: api.listSharedCanvases,
  });
}

/**
 * Create a new canvas
 */
export function useCreateCanvas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createCanvas,
    onSuccess: () => {
      // Invalidate and refetch canvases list
      queryClient.invalidateQueries({
        queryKey: canvasKeys.list(),
      });
    },
  });
}

/**
 * Duplicate an existing canvas
 */
export function useDuplicateCanvas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.duplicateCanvas,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: canvasKeys.list(),
      });
    },
  });
}

/**
 * Update canvas thumbnail
 */
export function useUpdateCanvasThumbnail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ canvasId, thumbnail }: { canvasId: string; thumbnail: string }) => {
      const response = await fetch(`/api/v1/canvases/${canvasId}/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnail }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update thumbnail');
      }

      return response.json() as Promise<Canvas>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: canvasKeys.list(),
      });
    },
  });
}
