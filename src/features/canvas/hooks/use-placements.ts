"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/fetch-client";
import type { ItemPlacementSummary, PlacedItem } from "@/lib/placements/shared";

/**
 * IMP-109: items shown on several canvases. A canvas reads the items placed
 * on it; a "placement-changed" notice on the live connection makes it read
 * them again, so an edit on the home canvas shows here within seconds.
 */

export const placementKeys = {
  canvas: (canvasId: string) => ["placements", "canvas", canvasId] as const,
  item: (itemId: string) => ["placements", "item", itemId] as const,
};

const JSON_HEADERS = { "Content-Type": "application/json" };

export function useCanvasPlacements(canvasId: string) {
  return useQuery({
    queryKey: placementKeys.canvas(canvasId),
    queryFn: async () => {
      const response = await apiFetch(
        `/api/v1/canvases/${encodeURIComponent(canvasId)}/placements`,
        { cache: "no-store" },
      );
      return ((await response.json()) as { placements: PlacedItem[] })
        .placements;
    },
    enabled: Boolean(canvasId),
    staleTime: 30_000,
  });
}

export function useItemPlacements(itemId: string | null) {
  return useQuery({
    queryKey: placementKeys.item(itemId ?? ""),
    queryFn: async () => {
      const response = await apiFetch(
        `/api/v1/canvas-items/${encodeURIComponent(itemId!)}/placements`,
        { cache: "no-store" },
      );
      return (await response.json()) as {
        homeCanvasId: string;
        placements: ItemPlacementSummary[];
      };
    },
    enabled: Boolean(itemId),
  });
}

export function useAddPlacement(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (canvasId: string) => {
      const response = await apiFetch(
        `/api/v1/canvas-items/${encodeURIComponent(itemId)}/placements`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ canvasId }),
        },
      );
      return (await response.json()) as ItemPlacementSummary;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: placementKeys.item(itemId) }),
  });
}

/** Take a shown item off a canvas (by the placement on that canvas). */
export function useRemovePlacement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      canvasId: string;
      placementId: string;
      itemId: string;
    }) => {
      await apiFetch(
        `/api/v1/canvases/${encodeURIComponent(input.canvasId)}/placements/${encodeURIComponent(input.placementId)}`,
        { method: "DELETE" },
      );
    },
    onSettled: (_data, _error, input) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: placementKeys.canvas(input.canvasId),
        }),
        queryClient.invalidateQueries({
          queryKey: placementKeys.item(input.itemId),
        }),
      ]),
  });
}

/** Move a shown item on this canvas; the home canvas is not touched. */
export function useMovePlacement(canvasId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      placementId: string;
      positionX: number;
      positionY: number;
    }) => {
      await apiFetch(
        `/api/v1/canvases/${encodeURIComponent(canvasId)}/placements/${encodeURIComponent(input.placementId)}`,
        {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            positionX: input.positionX,
            positionY: input.positionY,
          }),
        },
      );
    },
    onMutate: (input) => {
      queryClient.setQueryData<PlacedItem[]>(
        placementKeys.canvas(canvasId),
        (placed) =>
          placed?.map((entry) =>
            entry.placementId === input.placementId
              ? {
                  ...entry,
                  item: {
                    ...entry.item,
                    positionX: input.positionX,
                    positionY: input.positionY,
                  },
                }
              : entry,
          ),
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: placementKeys.canvas(canvasId),
      }),
  });
}

/** Before deleting items: where else each will disappear. */
export async function fetchPlacementsElsewhere(
  canvasId: string,
  itemIds: string[],
): Promise<Record<string, { count: number; canvasNames: string[] }>> {
  if (itemIds.length === 0) return {};
  const response = await apiFetch(
    `/api/v1/canvases/${encodeURIComponent(canvasId)}/placements/elsewhere?itemIds=${itemIds.map(encodeURIComponent).join(",")}`,
    { cache: "no-store" },
  );
  return (
    (await response.json()) as {
      items: Record<string, { count: number; canvasNames: string[] }>;
    }
  ).items;
}
