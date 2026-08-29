"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/fetch-client";
import type { ItemType } from "@/types/canvas";

export interface CanvasGeometryItem {
  id: string;
  type: ItemType;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  version: number;
}

export interface CanvasIndexSummary {
  count: number;
  bounds: {
    minX: number | null;
    minY: number | null;
    maxX: number | null;
    maxY: number | null;
  } | null;
  types: Record<string, number>;
  tags: Array<{ value: string; count: number }>;
  revision: string;
}

export const canvasIndexKeys = {
  all: (canvasId: string) => ["canvas-index", canvasId] as const,
  geometry: (canvasId: string) =>
    [...canvasIndexKeys.all(canvasId), "geometry"] as const,
  summary: (canvasId: string) =>
    [...canvasIndexKeys.all(canvasId), "summary"] as const,
  search: (canvasId: string, query: string) =>
    [...canvasIndexKeys.all(canvasId), "search", query] as const,
};

async function readJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error("Failed to load the canvas index");
  return response.json() as Promise<T>;
}

export function useCanvasGeometry(canvasId: string) {
  return useQuery({
    queryKey: canvasIndexKeys.geometry(canvasId),
    queryFn: () =>
      readJson<{ items: CanvasGeometryItem[] }>(
        `/api/v1/canvas-items/geometry?canvasId=${encodeURIComponent(canvasId)}`,
      ),
    staleTime: 30_000,
  });
}

export function useCanvasIndexSummary(canvasId: string) {
  return useQuery({
    queryKey: canvasIndexKeys.summary(canvasId),
    queryFn: () =>
      readJson<CanvasIndexSummary>(
        `/api/v1/canvas-items/summary?canvasId=${encodeURIComponent(canvasId)}`,
      ),
    staleTime: 15_000,
  });
}

export function useCanvasSearch(canvasId: string, query: string) {
  const normalized = query.trim();
  return useQuery({
    queryKey: canvasIndexKeys.search(canvasId, normalized),
    queryFn: () =>
      readJson<{ itemIds: string[] }>(
        `/api/v1/canvas-items/search?canvasId=${encodeURIComponent(canvasId)}&q=${encodeURIComponent(normalized)}`,
      ),
    enabled: normalized.length > 0,
    staleTime: 10_000,
  });
}
