import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Canvas, CanvasUpdatePayload } from '@/types/canvas';

/**
 * TanStack Query hooks for Canvas data
 *
 * Per ADR-0005 (State Management Policy):
 * - Server-persisted data (canvases, items) is managed here
 * - Ephemeral UI state is in Zustand store
 */

// Query Keys
export const canvasKeys = {
  all: ['canvases'] as const,
  lists: () => [...canvasKeys.all, 'list'] as const,
  list: (filters: string) => [...canvasKeys.lists(), { filters }] as const,
  details: () => [...canvasKeys.all, 'detail'] as const,
  detail: (id: string) => [...canvasKeys.details(), id] as const,
};

// Fetch canvas by ID
export function useCanvas(canvasId: string) {
  return useQuery({
    queryKey: canvasKeys.detail(canvasId),
    queryFn: async (): Promise<Canvas> => {
      const response = await fetch(`/api/v1/canvases/${canvasId}`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch canvas');
      }

      return response.json();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  });
}

// Update canvas (for persisting zoom/pan)
export function useUpdateCanvas(canvasId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CanvasUpdatePayload): Promise<Canvas> => {
      const response = await fetch(`/api/v1/canvases/${canvasId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to update canvas');
      }

      return response.json();
    },
    onSuccess: (data) => {
      // Update the cached canvas data
      queryClient.setQueryData(canvasKeys.detail(canvasId), data);
    },
  });
}

// Fetch all canvases for the current user
export function useCanvases() {
  return useQuery({
    queryKey: canvasKeys.lists(),
    queryFn: async (): Promise<Canvas[]> => {
      const response = await fetch('/api/v1/canvases');

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch canvases');
      }

      return response.json();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
