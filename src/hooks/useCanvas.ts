/**
 * Canvas Data Hooks
 *
 * TanStack Query hooks for fetching and mutating canvas data.
 * Manages server state caching, optimistic updates, and data synchronization.
 *
 * @module hooks/useCanvas
 *
 * ## Architecture
 * Per ADR-0005 (State Management Policy):
 * - Server-persisted data (canvases, items) is managed here with TanStack Query
 * - Ephemeral UI state (selection, drag state) is managed in Zustand store
 *
 * ## Query Keys
 * Uses hierarchical query keys following TanStack Query best practices:
 * - `['canvases']` - All canvas-related queries
 * - `['canvases', 'list']` - Canvas list queries
 * - `['canvases', 'detail', id]` - Individual canvas queries
 *
 * ## Caching Strategy
 * - Canvas data: 5 minute stale time
 * - Automatic cache invalidation on mutations
 * - Optimistic updates for better UX
 *
 * @example
 * ```typescript
 * // Fetch a single canvas
 * const { data: canvas, isLoading } = useCanvas('canvas-123');
 *
 * // Update canvas viewport
 * const updateCanvas = useUpdateCanvas('canvas-123');
 * await updateCanvas.mutateAsync({
 *   viewportX: 100,
 *   viewportY: 200,
 *   zoom: 1.5
 * });
 *
 * // List all canvases
 * const { data: canvases } = useCanvases();
 * ```
 *
 * @see {@link useCanvasStore} for ephemeral UI state
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Canvas, CanvasUpdatePayload } from '@/types/canvas';

/**
 * Hierarchical query keys for canvas data
 *
 * Follows TanStack Query best practices for key organization.
 * Allows for precise cache invalidation and query filtering.
 */
export const canvasKeys = {
  all: ['canvases'] as const,
  lists: () => [...canvasKeys.all, 'list'] as const,
  list: (filters: string) => [...canvasKeys.lists(), { filters }] as const,
  details: () => [...canvasKeys.all, 'detail'] as const,
  detail: (id: string) => [...canvasKeys.details(), id] as const,
};

/**
 * Fetch a single canvas by ID
 *
 * Retrieves canvas data including metadata, viewport state, and associated items.
 * Data is cached for 5 minutes and retries up to 2 times on failure.
 *
 * @param canvasId - The unique canvas identifier
 * @returns TanStack Query result with canvas data
 *
 * @example
 * ```typescript
 * function CanvasView({ canvasId }: { canvasId: string }) {
 *   const { data: canvas, isLoading, error } = useCanvas(canvasId);
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return <div>{canvas.name}</div>;
 * }
 * ```
 */
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

/**
 * Update canvas properties
 *
 * Mutates canvas data such as name, viewport position, and zoom level.
 * Automatically updates the query cache on success for instant UI updates.
 *
 * @param canvasId - The canvas to update
 * @returns TanStack Query mutation result
 *
 * @example
 * ```typescript
 * function CanvasControls({ canvasId }: { canvasId: string }) {
 *   const updateCanvas = useUpdateCanvas(canvasId);
 *
 *   const handleZoomIn = async () => {
 *     await updateCanvas.mutateAsync({
 *       zoom: currentZoom * 1.2
 *     });
 *   };
 *
 *   return <button onClick={handleZoomIn}>Zoom In</button>;
 * }
 * ```
 */
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

/**
 * Fetch all canvases for the current user
 *
 * Retrieves a list of all canvases owned by or shared with the authenticated user.
 * Results are sorted by update time (most recent first) on the server.
 *
 * @returns TanStack Query result with array of canvases
 *
 * @example
 * ```typescript
 * function CanvasList() {
 *   const { data: canvases, isLoading } = useCanvases();
 *
 *   if (isLoading) return <div>Loading canvases...</div>;
 *
 *   return (
 *     <ul>
 *       {canvases?.map(canvas => (
 *         <li key={canvas.id}>{canvas.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
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
