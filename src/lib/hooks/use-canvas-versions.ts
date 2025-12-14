/**
 * Canvas Versions Hook
 * React Query hooks for canvas version history
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface CanvasVersion {
  id: string;
  name: string;
  createdAt: string;
  snapshot?: any;
}

interface VersionsResponse {
  versions: CanvasVersion[];
}

/**
 * Fetch versions for a canvas
 */
export function useCanvasVersions(canvasId: string) {
  return useQuery<VersionsResponse>({
    queryKey: ['canvas-versions', canvasId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/canvases/${canvasId}/versions`);
      if (!response.ok) {
        throw new Error('Failed to fetch versions');
      }
      return response.json();
    },
    enabled: !!canvasId,
  });
}

/**
 * Create a new version snapshot
 */
export function useCreateVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ canvasId, name }: { canvasId: string; name?: string }) => {
      const response = await fetch(`/api/v1/canvases/${canvasId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create version');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['canvas-versions', variables.canvasId] });
    },
  });
}

/**
 * Restore canvas to a version
 */
export function useRestoreVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ canvasId, versionId }: { canvasId: string; versionId: string }) => {
      const response = await fetch(
        `/api/v1/canvases/${canvasId}/versions/${versionId}/restore`,
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to restore version');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['canvas-items', variables.canvasId] });
      queryClient.invalidateQueries({ queryKey: ['canvases'] });
    },
  });
}
