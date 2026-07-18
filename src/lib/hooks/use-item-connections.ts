/**
 * Item Connections Hook
 * TanStack Query hooks for managing canvas item connections
 */

import { apiFetch } from "@/lib/api/fetch-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface ItemConnection {
  id: string;
  fromId: string;
  toId: string;
  label?: string | null;
  style: "SOLID" | "DASHED" | "DOTTED";
  createdAt: string;
}

interface ConnectionsResponse {
  connections: ItemConnection[];
}

// Query keys
export const connectionKeys = {
  all: ["connections"] as const,
  canvas: (canvasId: string) => [...connectionKeys.all, canvasId] as const,
};

/**
 * Get all connections for a canvas
 */
export function useItemConnections(canvasId: string | undefined) {
  return useQuery<ConnectionsResponse>({
    queryKey: connectionKeys.canvas(canvasId || ""),
    queryFn: async () => {
      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/connections`,
      );
      if (!response.ok) throw new Error("Failed to fetch connections");
      return response.json();
    },
    enabled: !!canvasId,
  });
}

/**
 * Create a new connection
 */
export function useCreateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      fromId,
      toId,
      label,
      style,
    }: {
      canvasId: string;
      fromId: string;
      toId: string;
      label?: string;
      style?: "SOLID" | "DASHED" | "DOTTED";
    }) => {
      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/connections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromId, toId, label, style }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create connection");
      }

      return response.json() as Promise<ItemConnection>;
    },
    onMutate: async ({ canvasId, fromId, toId, label, style }) => {
      await queryClient.cancelQueries({
        queryKey: connectionKeys.canvas(canvasId),
      });
      const previous = queryClient.getQueryData<ConnectionsResponse>(
        connectionKeys.canvas(canvasId),
      );

      if (previous) {
        queryClient.setQueryData<ConnectionsResponse>(
          connectionKeys.canvas(canvasId),
          {
            connections: [
              ...previous.connections,
              {
                id: "temp-" + Date.now(),
                fromId,
                toId,
                label: label || null,
                style: style || "SOLID",
                createdAt: new Date().toISOString(),
              },
            ],
          },
        );
      }

      return { previous };
    },
    onError: (_err, { canvasId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          connectionKeys.canvas(canvasId),
          context.previous,
        );
      }
    },
    onSettled: (_data, _error, { canvasId }) => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.canvas(canvasId),
      });
    },
  });
}

/**
 * Update a connection
 */
export function useUpdateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      connectionId,
      label,
      style,
    }: {
      canvasId: string;
      connectionId: string;
      label?: string;
      style?: "SOLID" | "DASHED" | "DOTTED";
    }) => {
      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/connections/${connectionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, style }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update connection");
      }

      return response.json() as Promise<ItemConnection>;
    },
    onSuccess: (_data, { canvasId }) => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.canvas(canvasId),
      });
    },
  });
}

/**
 * Delete a connection
 */
export function useDeleteConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      connectionId,
    }: {
      canvasId: string;
      connectionId: string;
    }) => {
      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/connections/${connectionId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete connection");
      }

      return response.json();
    },
    onMutate: async ({ canvasId, connectionId }) => {
      await queryClient.cancelQueries({
        queryKey: connectionKeys.canvas(canvasId),
      });
      const previous = queryClient.getQueryData<ConnectionsResponse>(
        connectionKeys.canvas(canvasId),
      );

      if (previous) {
        queryClient.setQueryData<ConnectionsResponse>(
          connectionKeys.canvas(canvasId),
          {
            connections: previous.connections.filter(
              (c) => c.id !== connectionId,
            ),
          },
        );
      }

      return { previous };
    },
    onError: (_err, { canvasId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          connectionKeys.canvas(canvasId),
          context.previous,
        );
      }
    },
    onSettled: (_data, _error, { canvasId }) => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.canvas(canvasId),
      });
    },
  });
}
