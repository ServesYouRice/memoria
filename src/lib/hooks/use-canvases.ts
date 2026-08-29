/**
 * TanStack Query hooks for Canvases
 * Following ADR-0005: State Management Policy
 * Server state is managed via TanStack Query
 * Phase 3: Includes shared canvas support
 */

import { apiFetch } from "@/lib/api/fetch-client";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  canvasListResponseSchema,
  sharedCanvasResponseSchema,
} from "@/lib/api/response-schemas";

export interface Canvas {
  id: string;
  name: string;
  userId: string;
  workspaceId?: string | null;
  zoomLevel: number;
  panX: number;
  panY: number;
  thumbnailKey?: string | null;
  thumbnailRevision?: string;
  isPublic?: boolean;
  createdAt: string;
  updatedAt: string;
  shares?: Array<{
    id: string;
    role: "VIEW" | "COMMENT" | "EDIT";
    createdAt: string;
  }>;
  accessLevel?: "OWNER" | "EDIT" | "COMMENT" | "VIEW";
}

export interface SharedCanvas {
  id: string;
  name: string;
  thumbnailKey?: string | null;
  thumbnailRevision?: string;
  itemCount: number;
  owner: {
    name: string | null;
  };
  role: "VIEW" | "COMMENT" | "EDIT";
  sharedAt: string;
  updatedAt: string;
}

export interface CreateCanvasInput {
  name?: string;
  workspaceId?: string;
}

export interface UpdateCanvasInput {
  name?: string;
  defaultViewport?: {
    zoomLevel: number;
    panX: number;
    panY: number;
  };
  workspaceId?: string | null;
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
  async listCanvases(offset = 0, workspaceId?: string) {
    const params = new URLSearchParams({ limit: "24", offset: String(offset) });
    if (workspaceId) params.set("workspaceId", workspaceId);
    const response = await apiFetch(`/api/v1/canvases?${params}`);
    if (!response.ok) throw new Error("Failed to fetch canvases");
    const raw = await response.json();
    const parsed = canvasListResponseSchema.parse(raw);
    return {
      canvases: parsed.canvases.map((c) => ({
        ...c,
        createdAt:
          c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
        updatedAt:
          c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
      })),
      pagination: parsed.pagination,
    } as CanvasesListResponse;
  },

  async listSharedCanvases() {
    const response = await apiFetch("/api/v1/shared-canvases");
    if (!response.ok) throw new Error("Failed to fetch shared canvases");
    const raw = await response.json();
    const parsed = sharedCanvasResponseSchema.parse(raw);
    return parsed.canvases.map((c) => ({
      ...c,
      sharedAt:
        c.sharedAt instanceof Date ? c.sharedAt.toISOString() : c.sharedAt,
      updatedAt:
        c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
    })) as SharedCanvas[];
  },

  async createCanvas(input: CreateCanvasInput) {
    const response = await apiFetch("/api/v1/canvases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to create canvas");
    }

    return response.json() as Promise<Canvas>;
  },

  async duplicateCanvas(canvasId: string) {
    const response = await apiFetch(`/api/v1/canvases/${canvasId}/duplicate`, {
      method: "POST",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to duplicate canvas");
    }

    return response.json() as Promise<Canvas>;
  },

  async getCanvas(canvasId: string) {
    const response = await apiFetch(`/api/v1/canvases/${canvasId}`);
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail || "Failed to fetch canvas");
    }
    return response.json() as Promise<Canvas>;
  },

  async updateCanvas(canvasId: string, input: UpdateCanvasInput) {
    const response = await apiFetch(`/api/v1/canvases/${canvasId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail || "Failed to update canvas");
    }

    return response.json() as Promise<Canvas>;
  },
};

/**
 * Query keys factory
 */
export const canvasKeys = {
  all: ["canvases"] as const,
  lists: () => [...canvasKeys.all, "list"] as const,
  list: () => [...canvasKeys.lists()] as const,
  details: () => [...canvasKeys.all, "detail"] as const,
  detail: (canvasId: string) => [...canvasKeys.details(), canvasId] as const,
  sharedLists: () => [...canvasKeys.all, "shared"] as const,
  sharedList: () => [...canvasKeys.sharedLists()] as const,
};

/**
 * List all canvases for the current user
 */
export function useCanvases(workspaceId?: string) {
  return useInfiniteQuery({
    queryKey: [...canvasKeys.list(), workspaceId || "all"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listCanvases(pageParam, workspaceId),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.canvases.length
        : undefined,
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

export function useCanvas(canvasId: string) {
  return useQuery({
    queryKey: canvasKeys.detail(canvasId),
    queryFn: () => api.getCanvas(canvasId),
    enabled: !!canvasId,
  });
}

/**
 * Create a new canvas
 */
export function useCreateCanvas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createCanvas,
    onMutate: async (newCanvas) => {
      await queryClient.cancelQueries({ queryKey: canvasKeys.list() });
      const previousCanvases = queryClient.getQueryData<CanvasesListResponse>(
        canvasKeys.list(),
      );

      if (previousCanvases) {
        queryClient.setQueryData<CanvasesListResponse>(canvasKeys.list(), {
          ...previousCanvases,
          canvases: [
            {
              id: "temp-id-" + Date.now(),
              name: newCanvas.name || "Untitled Canvas",
              userId: "current-user",
              workspaceId: newCanvas.workspaceId ?? null,
              zoomLevel: 1,
              panX: 0,
              panY: 0,
              thumbnailKey: null,
              thumbnailRevision: "0",
              isPublic: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...previousCanvases.canvases,
          ],
        });
      }

      return { previousCanvases };
    },
    onError: (err, newCanvas, context) => {
      if (context?.previousCanvases) {
        queryClient.setQueryData(canvasKeys.list(), context.previousCanvases);
      }
    },
    onSettled: () => {
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
    onMutate: async (canvasId) => {
      await queryClient.cancelQueries({ queryKey: canvasKeys.list() });
      const previousCanvases = queryClient.getQueryData<CanvasesListResponse>(
        canvasKeys.list(),
      );

      if (previousCanvases) {
        const originalCanvas = previousCanvases.canvases.find(
          (c) => c.id === canvasId,
        );
        if (originalCanvas) {
          queryClient.setQueryData<CanvasesListResponse>(canvasKeys.list(), {
            ...previousCanvases,
            canvases: [
              {
                ...originalCanvas,
                id: "temp-dup-" + Date.now(),
                name: `${originalCanvas.name} (Copy)`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              ...previousCanvases.canvases,
            ],
          });
        }
      }

      return { previousCanvases };
    },
    onError: (err, variables, context) => {
      if (context?.previousCanvases) {
        queryClient.setQueryData(canvasKeys.list(), context.previousCanvases);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: canvasKeys.list(),
      });
    },
  });
}

export function useUpdateCanvas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      data,
    }: {
      canvasId: string;
      data: UpdateCanvasInput;
    }) => api.updateCanvas(canvasId, data),
    onSuccess: (updatedCanvas) => {
      queryClient.setQueryData<Canvas>(
        canvasKeys.detail(updatedCanvas.id),
        (currentCanvas) => ({ ...currentCanvas, ...updatedCanvas }),
      );
      queryClient.invalidateQueries({ queryKey: canvasKeys.list() });
    },
  });
}

/**
 * Update canvas thumbnail
 */
export function useUpdateCanvasThumbnail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      thumbnail,
      expectedRevision,
    }: {
      canvasId: string;
      thumbnail: string;
      expectedRevision: string;
    }) => {
      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/thumbnail`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thumbnail, expectedRevision }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update thumbnail");
      }

      return response.json() as Promise<{
        queued: boolean;
        stale?: boolean;
        revision: string;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: canvasKeys.list(),
      });
    },
  });
}
