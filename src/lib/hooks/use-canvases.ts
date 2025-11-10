/**
 * TanStack Query hooks for Canvases
 * Following ADR-0005: State Management Policy
 * Server state is managed via TanStack Query
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface Canvas {
  id: string;
  name: string;
  userId: string;
  zoomLevel: number;
  panX: number;
  panY: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCanvasInput {
  name?: string;
}

/**
 * API client functions
 */
const api = {
  async listCanvases() {
    const response = await fetch('/api/v1/canvases');
    if (!response.ok) throw new Error('Failed to fetch canvases');
    return response.json() as Promise<Canvas[]>;
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
