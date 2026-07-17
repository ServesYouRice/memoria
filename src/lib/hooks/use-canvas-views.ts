"use client";

import { apiFetch } from "@/lib/api/fetch-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanvasViewType } from "@prisma/client";

export interface CanvasViewRecord {
  id: string;
  userId: string;
  canvasId: string;
  viewType: CanvasViewType;
  name: string | null;
  filters: Record<string, unknown> | null;
  layout: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveCanvasViewInput {
  name?: string | null;
  filters?: Record<string, unknown> | null;
  layout?: Record<string, unknown> | null;
}

async function parseCanvasViewJson<T>(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>).detail === "string"
        ? String((payload as Record<string, unknown>).detail)
        : fallback;
    throw new Error(message);
  }

  return payload as T;
}

const api = {
  async getCanvasView(canvasId: string, viewType: CanvasViewType) {
    const response = await apiFetch(
      `/api/v1/canvases/${canvasId}/views?viewType=${viewType}`,
    );
    return parseCanvasViewJson<{ view: CanvasViewRecord | null }>(
      response,
      "Failed to load canvas view.",
    );
  },

  async saveCanvasView(
    canvasId: string,
    viewType: CanvasViewType,
    input: SaveCanvasViewInput,
  ) {
    const response = await apiFetch(`/api/v1/canvases/${canvasId}/views`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        viewType,
        ...input,
      }),
    });

    return parseCanvasViewJson<{ view: CanvasViewRecord }>(
      response,
      "Failed to save canvas view.",
    );
  },
};

export const canvasViewKeys = {
  all: ["canvas-views"] as const,
  detail: (canvasId: string, viewType: CanvasViewType) =>
    [...canvasViewKeys.all, canvasId, viewType] as const,
};

export function useCanvasView(canvasId: string, viewType: CanvasViewType) {
  return useQuery({
    queryKey: canvasViewKeys.detail(canvasId, viewType),
    queryFn: () => api.getCanvasView(canvasId, viewType),
    enabled: !!canvasId,
  });
}

export function useSaveCanvasView(canvasId: string, viewType: CanvasViewType) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SaveCanvasViewInput) =>
      api.saveCanvasView(canvasId, viewType, input),
    onSuccess: (data) => {
      queryClient.setQueryData(canvasViewKeys.detail(canvasId, viewType), {
        view: data.view,
      });
    },
  });
}
