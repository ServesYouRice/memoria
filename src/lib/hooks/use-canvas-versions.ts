/**
 * Canvas Versions Hook
 * React Query hooks for canvas version history
 */

import { apiFetch } from "@/lib/api/fetch-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export interface CanvasVersion {
  id: string;
  name: string;
  createdAt: string;
  snapshot?: CanvasVersionSnapshot | null;
}

interface VersionsResponse {
  versions: CanvasVersion[];
}

interface UseCanvasVersionsOptions {
  includeSnapshot?: boolean;
}

export const canvasVersionKeys = {
  all: ["canvas-versions"] as const,
  canvas: (canvasId: string) => [...canvasVersionKeys.all, canvasId] as const,
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

      const response = await apiFetch(
        `/api/v1/canvases/${canvasId}/versions${params.size > 0 ? `?${params.toString()}` : ""}`,
      );
      return parseJson<VersionsResponse>(response, "Failed to fetch versions");
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
