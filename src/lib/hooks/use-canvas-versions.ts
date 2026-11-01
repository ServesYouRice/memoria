/**
 * Canvas Versions Hook
 * React Query hooks for canvas version history
 */

import { apiFetch } from "@/lib/api/fetch-client";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { canvasItemKeys } from "@/lib/hooks/use-canvas-items";
import { canvasKeys } from "@/lib/hooks/use-canvases";
import { type ItemType } from "@/types/canvas";

export interface CanvasVersionSnapshotItem {
  id?: string;
  type: ItemType;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  content: unknown;
  tags?: string[];
  version?: number;
  createdById?: string;
  updatedById?: string | null;
}

export interface CanvasVersionSnapshot {
  name?: string;
  zoomLevel?: number;
  panX?: number;
  panY?: number;
  items?: CanvasVersionSnapshotItem[];
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const details = payload as Record<string, unknown>;
    if (typeof details.detail === "string") {
      return details.detail;
    }
    if (typeof details.error === "string") {
      return details.error;
    }
    if (typeof details.message === "string") {
      return details.message;
    }
  }

  return fallback;
}

async function parseJson<T>(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, fallback));
  }
  return payload as T;
}

export type CanvasVersionKind = "MANUAL" | "AUTO";

export interface CanvasVersion {
  id: string;
  name: string;
  /** Saved by a person (`MANUAL`) or taken by the auto-snapshot job (`AUTO`). */
  kind: CanvasVersionKind;
  createdAt: string;
  /** Who saved or restored a manual version; null for automatic ones. */
  createdBy?: { id: string; name: string | null } | null;
  snapshot?: CanvasVersionSnapshot | null;
}

interface VersionsResponse {
  versions: CanvasVersion[];
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface UseCanvasVersionsOptions {
  includeSnapshot?: boolean;
}

export const canvasVersionKeys = {
  all: ["canvas-versions"] as const,
  canvas: (canvasId: string) => [...canvasVersionKeys.all, canvasId] as const,
  history: (canvasId: string, kind: CanvasVersionKind | "ALL") =>
    [...canvasVersionKeys.canvas(canvasId), "history", kind] as const,
  list: (canvasId: string, includeSnapshot: boolean) =>
    [...canvasVersionKeys.canvas(canvasId), { includeSnapshot }] as const,
};

/**
 * Fetch versions for a canvas
 */
export function useCanvasVersions(
  canvasId: string,
  options?: UseCanvasVersionsOptions,
) {
  const includeSnapshot = options?.includeSnapshot ?? false;

  return useQuery<VersionsResponse>({
    queryKey: canvasVersionKeys.list(canvasId, includeSnapshot),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeSnapshot) {
        params.set("includeSnapshot", "true");
      }
      params.set("limit", "100");

      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/versions?${params.toString()}`,
      );
      return parseJson<VersionsResponse>(response, "Failed to fetch versions");
    },
    enabled: !!canvasId,
  });
}

const HISTORY_PAGE_SIZE = 50;

/**
 * Page through a canvas's version history, newest first, optionally limited
 * to manual or automatic versions.
 */
export function useCanvasVersionHistory(
  canvasId: string,
  kind: CanvasVersionKind | "ALL" = "ALL",
  enabled = true,
) {
  return useInfiniteQuery<VersionsResponse>({
    queryKey: canvasVersionKeys.history(canvasId, kind),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: String(HISTORY_PAGE_SIZE),
        offset: String(pageParam),
      });
      if (kind !== "ALL") params.set("kind", kind);
      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/versions?${params.toString()}`,
      );
      return parseJson<VersionsResponse>(response, "Failed to fetch versions");
    },
    getNextPageParam: (lastPage) =>
      lastPage.pagination?.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
    enabled: enabled && !!canvasId,
  });
}

export function useCanvasVersion(
  canvasId: string,
  versionId: string | undefined,
  enabled = true,
) {
  return useQuery<CanvasVersion>({
    queryKey: [...canvasVersionKeys.canvas(canvasId), "detail", versionId],
    queryFn: async () => {
      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/versions/${versionId}`,
      );
      return parseJson<CanvasVersion>(response, "Failed to fetch version");
    },
    enabled: enabled && Boolean(canvasId && versionId),
  });
}

/**
 * Create a new version snapshot
 */
export function useCreateVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      name,
    }: {
      canvasId: string;
      name?: string;
    }) => {
      const response = await apiFetch(`/api/v1/canvases/${canvasId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      return parseJson<CanvasVersion>(response, "Failed to create version");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: canvasVersionKeys.canvas(variables.canvasId),
      });
    },
  });
}

/**
 * Restore canvas to a version
 */
export function useRestoreVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      canvasId,
      versionId,
    }: {
      canvasId: string;
      versionId: string;
    }) => {
      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/versions/${versionId}/restore`,
        {
          method: "POST",
        },
      );

      return parseJson<Record<string, unknown>>(
        response,
        "Failed to restore version",
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: canvasItemKeys.all });
      queryClient.invalidateQueries({ queryKey: canvasKeys.list() });
      queryClient.invalidateQueries({
        queryKey: canvasKeys.detail(variables.canvasId),
      });
      queryClient.invalidateQueries({
        queryKey: canvasVersionKeys.canvas(variables.canvasId),
      });
    },
  });
}
