import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useDeferredValue,
} from "react";
import { useCanvasItems } from "@/lib/hooks/use-canvas-items";
import {
  useCanvasVersions,
  useCanvasVersion,
  type CanvasVersionSnapshot,
} from "@/lib/hooks/use-canvas-versions";
import { useCanvas, useUpdateCanvas } from "@/lib/hooks/use-canvases";
import { type CanvasItem } from "@/types/canvas";
import { canvasItemMatchesSearch } from "@/features/canvas/search";
import {
  useCanvasGeometry,
  useCanvasIndexSummary,
  useCanvasSearch,
} from "@/lib/hooks/use-canvas-index";
import {
  calculateViewportWindow,
  readCanvasViewport,
  writeCanvasViewport,
} from "@/features/canvas/viewport-budget";

interface UseCanvasDataProps {
  canvasId: string;
  viewportSize: { width: number; height: number };
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

export function useCanvasData({ canvasId, viewportSize }: UseCanvasDataProps) {
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

  const { x: positionX, y: positionY } = position;
  const { width: viewportWidth, height: viewportHeight } = viewportSize;
  const viewport = useMemo(() => {
    return calculateViewportWindow({
      zoom,
      position: { x: positionX, y: positionY },
      size: { width: viewportWidth, height: viewportHeight },
      tags: selectedTags,
    });
  }, [positionX, positionY, selectedTags, viewportHeight, viewportWidth, zoom]);

  // React Query. Full item payloads follow the padded, tile-stable viewport;
  // the small geometry index remains available for whole-canvas navigation.
  const {
    data: canvas,
    error: canvasError,
    refetch: refetchCanvas,
  } = useCanvas(canvasId);
  const {
    data,
    error: itemsError,
    refetch: refetchItems,
  } = useCanvasItems(canvasId, undefined, viewport);
  const allItems = useMemo(() => data?.items ?? [], [data?.items]);
  const { data: geometryData, refetch: refetchGeometry } =
    useCanvasGeometry(canvasId);
  const { data: summaryData, refetch: refetchSummary } =
    useCanvasIndexSummary(canvasId);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchQueryResult = useCanvasSearch(canvasId, deferredSearchQuery);

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
  const { mutateAsync: updateCanvas } = useUpdateCanvas();

  useEffect(() => {
    viewportInitializedRef.current = false;
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setSearchQuery("");
    setSelectedTags([]);
  }, [canvasId]);

  useEffect(() => {
    if (!canvas) {
      return;
    }

    setCanvasLoadError(null);
    setCanvasName(canvas.name);
    if (!viewportInitializedRef.current) {
      const viewport = readCanvasViewport(window.localStorage, canvasId, {
        zoom: canvas.zoomLevel || 1,
        x: canvas.panX || 0,
        y: canvas.panY || 0,
      });
      setZoom(viewport.zoom);
      setPosition({ x: viewport.x, y: viewport.y });
      viewportInitializedRef.current = true;
    }
  }, [canvas, canvasId]);

  useEffect(() => {
    if (!viewportInitializedRef.current) return;
    let idleId: number | undefined;
    const persist = () => {
      writeCanvasViewport(window.localStorage, canvasId, {
        zoom,
        x: position.x,
        y: position.y,
      });
      if (canvas?.accessLevel === "OWNER") {
        updateCanvas({
          canvasId,
          data: {
            defaultViewport: {
              zoomLevel: zoom,
              panX: position.x,
              panY: position.y,
            },
          },
        }).catch((error) => {
          setCanvasLoadError(
            error instanceof Error
              ? error.message
              : "Failed to save canvas viewport",
          );
        });
      }
    };
    const timeoutId = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(persist, { timeout: 1_000 });
      } else {
        persist();
      }
    }, 750);

    return () => {
      window.clearTimeout(timeoutId);
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [
    canvas?.accessLevel,
    canvasId,
    position.x,
    position.y,
    updateCanvas,
    zoom,
  ]);

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
      await updateCanvas({
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

  const { allTags, tagCounts } = useMemo(() => {
    const tags = summaryData?.tags ?? [];
    return {
      allTags: tags.map((entry) => entry.value).sort(),
      tagCounts: Object.fromEntries(
        tags.map((entry) => [entry.value, entry.count]),
      ),
    };
  }, [summaryData?.tags]);

  // Tag filters intentionally narrow the working set. Text search does not:
  // every item stays mounted so frames, arrows, and nearby content continue to
  // communicate structure rather than appearing to have been deleted.
  const filteredItems = useMemo(() => {
    let filtered = displayedItems;
    if (selectedTags.length > 0) {
      filtered = filtered.filter((item) => {
        if (!item.tags || !Array.isArray(item.tags)) return false;
        return selectedTags.every((tag) => item.tags.includes(tag));
      });
    }
    return filtered;
  }, [displayedItems, selectedTags]);

  const searchMatchIds = useMemo(() => {
    if (deferredSearchQuery.trim()) {
      return new Set(searchQueryResult.data?.itemIds ?? []);
    }
    return new Set(
      filteredItems
        .filter((item) => canvasItemMatchesSearch(item, deferredSearchQuery))
        .map((item) => item.id),
    );
  }, [deferredSearchQuery, filteredItems, searchQueryResult.data?.itemIds]);

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
    searchMatchIds,
    allItems,
    versions,
    allTags,
    tagCounts,
    geometry: geometryData?.items ?? [],
    canvasBounds: summaryData?.bounds ?? null,
    totalItemCount: summaryData?.count ?? data?.total ?? allItems.length,
    canvasRevision: summaryData?.revision ?? "0",
    accessLevel: canvas?.accessLevel || "VIEW",

    // Actions
    updateCanvasName,
    // Retry refetches both canvas metadata and items — either can be the
    // source of the load error surfaced in the UI.
    refreshMetadata: useCallback(async () => {
      await Promise.all([
        refetchCanvas(),
        refetchItems(),
        refetchGeometry(),
        refetchSummary(),
      ]);
    }, [refetchCanvas, refetchGeometry, refetchItems, refetchSummary]),
  };
}
