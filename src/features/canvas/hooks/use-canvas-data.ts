import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useCanvasItems } from "@/lib/hooks/use-canvas-items";
import {
  useCanvasVersions,
  useCanvasVersion,
  type CanvasVersionSnapshot,
} from "@/lib/hooks/use-canvas-versions";
import { useCanvas, useUpdateCanvas } from "@/lib/hooks/use-canvases";
import { type CanvasItem, ItemType } from "@/types/canvas";
import { stripHtmlTags } from "@/lib/utils/html";

interface UseCanvasDataProps {
  canvasId: string;
}

function hydrateSnapshotItems(
  canvasId: string,
  snapshot: CanvasVersionSnapshot | null | undefined,
  liveItems: CanvasItem[],
): CanvasItem[] {
  const snapshotItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const liveItemsById = new Map(
    liveItems.map((item) => [item.id, item] as const),
  );

  return snapshotItems.map((item, index) => {
    const liveItem = item.id ? liveItemsById.get(item.id) : undefined;
    const createdAt = liveItem?.createdAt ?? new Date(0);
    const updatedAt = liveItem?.updatedAt ?? createdAt;

    return {
      id: item.id ?? `snapshot-${index}`,
      canvasId: liveItem?.canvasId ?? canvasId,
      type: item.type,
      positionX: item.positionX,
      positionY: item.positionY,
      width: item.width,
      height: item.height,
      zIndex: item.zIndex,
      content: item.content as CanvasItem["content"],
      tags: item.tags ?? [],
      version: item.version ?? liveItem?.version ?? 1,
      deletedAt: null,
      createdById: item.createdById ?? liveItem?.createdById ?? "",
      updatedById: item.updatedById ?? liveItem?.updatedById ?? null,
      deletedById: null,
      createdAt,
      updatedAt,
    };
  });
}

export function useCanvasData({ canvasId }: UseCanvasDataProps) {
  const viewportInitializedRef = useRef(false);
  // Local UI State
  const [canvasName, setCanvasName] = useState("Untitled Canvas");
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [canvasLoadError, setCanvasLoadError] = useState<string | null>(null);

  // Time Machine State
  const [isTimeMachineActive, setTimeMachineActive] = useState(false);
  const [timeMachineIndex, setTimeMachineIndex] = useState(0);

  // React Query
  const {
    data: canvas,
    error: canvasError,
    refetch: refetchCanvas,
  } = useCanvas(canvasId);
  const {
    data,
    error: itemsError,
    refetch: refetchItems,
  } = useCanvasItems(canvasId);
  const allItems = useMemo(() => data?.items ?? [], [data?.items]);

  const { data: versionsData } = useCanvasVersions(canvasId);
  const versions = useMemo(
    () => versionsData?.versions ?? [],
    [versionsData?.versions],
  );
  const selectedVersionId = versions[timeMachineIndex]?.id;
  const { data: selectedVersion } = useCanvasVersion(
    canvasId,
    selectedVersionId,
    isTimeMachineActive,
  );
  const updateCanvasMutation = useUpdateCanvas();

  useEffect(() => {
    if (!canvas) {
      return;
    }

    setCanvasLoadError(null);
    setCanvasName(canvas.name);
    if (!viewportInitializedRef.current) {
      const stored = window.localStorage.getItem(`canvas:${canvasId}:viewport`);
      if (stored) {
        try {
          const viewport = JSON.parse(stored) as {
            zoom?: number;
            x?: number;
            y?: number;
          };
          setZoom(
            typeof viewport.zoom === "number"
              ? viewport.zoom
              : canvas.zoomLevel || 1,
          );
          setPosition({
            x: typeof viewport.x === "number" ? viewport.x : canvas.panX || 0,
            y: typeof viewport.y === "number" ? viewport.y : canvas.panY || 0,
          });
        } catch {
          window.localStorage.removeItem(`canvas:${canvasId}:viewport`);
        }
      } else {
        setZoom(canvas.zoomLevel || 1);
        setPosition({ x: canvas.panX || 0, y: canvas.panY || 0 });
      }
      viewportInitializedRef.current = true;
    }
  }, [canvas, canvasId]);

  useEffect(() => {
    if (!viewportInitializedRef.current) return;
    window.localStorage.setItem(
      `canvas:${canvasId}:viewport`,
      JSON.stringify({ zoom, x: position.x, y: position.y }),
    );
  }, [canvasId, position.x, position.y, zoom]);

  useEffect(() => {
    if (!canvasError) {
      return;
    }

    setCanvasLoadError(
      canvasError instanceof Error
        ? canvasError.message
        : "Failed to load canvas",
    );
  }, [canvasError]);

  useEffect(() => {
    if (!itemsError) return;
    setCanvasLoadError(
      itemsError instanceof Error
        ? itemsError.message
        : "Failed to load canvas items",
    );
  }, [itemsError]);

  // Update canvas name
  const updateCanvasName = async (name: string) => {
    const previousName = canvasName;
    setCanvasName(name);
    try {
      await updateCanvasMutation.mutateAsync({
        canvasId,
        data: { name },
      });
    } catch (err) {
      setCanvasName(previousName);
      setCanvasLoadError(
        err instanceof Error ? err.message : "Failed to update canvas name",
      );
    }
  };

  // Calculate displayed items (Time Machine logic)
  const displayedItems = useMemo(() => {
    const snapshot = selectedVersion?.snapshot;
    if (isTimeMachineActive && snapshot) {
      return hydrateSnapshotItems(canvasId, snapshot, allItems);
    }
    return allItems;
  }, [allItems, canvasId, isTimeMachineActive, selectedVersion?.snapshot]);

  // Extract tags
  const { allTags, tagCounts } = useMemo(() => {
    const counts: Record<string, number> = {};
    allItems.forEach((item: CanvasItem) => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach((tag) => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      }
    });
    return {
      allTags: Object.keys(counts).sort(),
      tagCounts: counts,
    };
  }, [allItems]);

  // Filter items
  const filteredItems = useMemo(() => {
    let filtered = displayedItems;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        if (item.type === ItemType.NOTE) {
          const noteContent = item.content as { text: string };
          const plainText = stripHtmlTags(noteContent.text || "");
          return plainText.toLowerCase().includes(query);
        } else if (item.type === ItemType.BOOKMARK) {
          const bookmarkContent = item.content as any;
          return (
            bookmarkContent.url?.toLowerCase().includes(query) ||
            bookmarkContent.title?.toLowerCase().includes(query) ||
            bookmarkContent.description?.toLowerCase().includes(query) ||
            bookmarkContent.siteName?.toLowerCase().includes(query)
          );
        } else if (item.type === ItemType.IMAGE) {
          const imageContent = item.content as any;
          return (
            imageContent.filename?.toLowerCase().includes(query) ||
            imageContent.alt?.toLowerCase().includes(query)
          );
        }
        return false;
      });
    }

    if (selectedTags.length > 0) {
      filtered = filtered.filter((item) => {
        if (!item.tags || !Array.isArray(item.tags)) return false;
        return selectedTags.every((tag) => item.tags.includes(tag));
      });
    }
    return filtered;
  }, [displayedItems, searchQuery, selectedTags]);

  return {
    // State
    canvasName,
    zoom,
    setZoom,
    position,
    setPosition,
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    canvasLoadError,
    clearCanvasLoadError: useCallback(() => setCanvasLoadError(null), []),
    isTimeMachineActive,
    setTimeMachineActive,
    timeMachineIndex,
    setTimeMachineIndex,

    // Data
    items: filteredItems,
    allItems,
    versions,
    allTags,
    tagCounts,
    accessLevel: canvas?.accessLevel || "VIEW",

    // Actions
    updateCanvasName,
    // Retry refetches both canvas metadata and items — either can be the
    // source of the load error surfaced in the UI.
    refreshMetadata: useCallback(async () => {
      await Promise.all([refetchCanvas(), refetchItems()]);
    }, [refetchCanvas, refetchItems]),
  };
}
