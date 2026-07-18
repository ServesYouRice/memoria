/**
 * Workspaces Hook
 * TanStack Query hooks for managing workspaces
 */

import { apiFetch } from "@/lib/api/fetch-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface Workspace {
  id: string;
  name: string;
  canvasCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWithCanvases extends Workspace {
  canvases: {
    id: string;
    name: string;
    thumbnail: string | null;
    updatedAt: string;
  }[];
}

interface WorkspacesListResponse {
  workspaces: Workspace[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// Query keys
export const workspaceKeys = {
  all: ["workspaces"] as const,
  lists: () => [...workspaceKeys.all, "list"] as const,
  list: () => [...workspaceKeys.lists()] as const,
  details: () => [...workspaceKeys.all, "detail"] as const,
  detail: (id: string) => [...workspaceKeys.details(), id] as const,
};

/**
 * List all workspaces for the current user
 */
export function useWorkspaces() {
  return useQuery<WorkspacesListResponse>({
    queryKey: workspaceKeys.list(),
    queryFn: async () => {
      const response = await apiFetch("/api/v1/workspaces");
      if (!response.ok) throw new Error("Failed to fetch workspaces");
      return response.json();
    },
  });
}

/**
 * Get a single workspace with its canvases
 */
export function useWorkspace(workspaceId: string | undefined) {
  return useQuery<WorkspaceWithCanvases>({
    queryKey: workspaceKeys.detail(workspaceId || ""),
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/workspaces/${workspaceId}`);
      if (!response.ok) throw new Error("Failed to fetch workspace");
      return response.json();
    },
    enabled: !!workspaceId,
  });
}

/**
 * Create a new workspace
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      const response = await apiFetch("/api/v1/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to create workspace");
      }

      return response.json() as Promise<Workspace>;
    },
    onMutate: async ({ name }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKeys.list() });
      const previous = queryClient.getQueryData<WorkspacesListResponse>(
        workspaceKeys.list(),
      );

      if (previous) {
        queryClient.setQueryData<WorkspacesListResponse>(workspaceKeys.list(), {
          ...previous,
          workspaces: [
            {
              id: "temp-" + Date.now(),
              name,
              canvasCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...previous.workspaces,
          ],
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}

/**
 * Update a workspace
 */
export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workspaceId,
      name,
    }: {
      workspaceId: string;
      name: string;
    }) => {
      const response = await apiFetch(`/api/v1/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to update workspace");
      }

      return response.json() as Promise<Workspace>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}

/**
 * Delete a workspace
 */
export function useDeleteWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      const response = await apiFetch(`/api/v1/workspaces/${workspaceId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to delete workspace");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}

/**
 * Assign a canvas to a workspace
 */
export function useAssignCanvasToWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      workspaceId,
    }: {
      canvasId: string;
      workspaceId: string | null;
    }) => {
      const response = await apiFetch(`/api/v1/canvases/${canvasId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to assign canvas");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      queryClient.invalidateQueries({ queryKey: ["canvases"] });
    },
  });
}
