import { useState, useMemo, useCallback, useEffect } from 'react';
import { useCanvasItems } from '@/lib/hooks/use-canvas-items';
import { useCanvasVersions } from '@/lib/hooks/use-canvas-versions';
import { type CanvasItem, ItemType } from '@/types/canvas';
import { stripHtmlTags } from '@/lib/utils/html';

interface UseCanvasDataProps {
    canvasId: string;
}

export function useCanvasData({ canvasId }: UseCanvasDataProps) {
    // Local UI State
    const [canvasName, setCanvasName] = useState('Untitled Canvas');
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [canvasLoadError, setCanvasLoadError] = useState<string | null>(null);

    // Time Machine State
    const [isTimeMachineActive, setTimeMachineActive] = useState(false);
    const [timeMachineIndex, setTimeMachineIndex] = useState(0);

    // React Query
    const { data } = useCanvasItems(canvasId);
    const allItems = useMemo(() => data?.items ?? [], [data?.items]);

    const { data: versionsData } = useCanvasVersions(canvasId);
    const versions = useMemo(() => versionsData?.versions ?? [], [versionsData?.versions]);

    // Fetch basic canvas metadata
    const fetchCanvasMetadata = useCallback(async () => {
        try {
            setCanvasLoadError(null);
            const response = await fetch(`/api/v1/canvases/${canvasId}`);
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                throw new Error(errorBody?.detail || 'Failed to load canvas');
            }
            const canvas = await response.json();
            setCanvasName(canvas.name);
            setZoom(canvas.zoomLevel || 1);
            setPosition({ x: canvas.panX || 0, y: canvas.panY || 0 });
        } catch (err) {
            setCanvasLoadError(err instanceof Error ? err.message : 'Failed to load canvas');
        }
    }, [canvasId]);

    // Initial fetch
    useEffect(() => {
        fetchCanvasMetadata();
    }, [fetchCanvasMetadata]);

    // Update canvas name
    const updateCanvasName = async (name: string) => {
        const previousName = canvasName;
        setCanvasName(name);
        try {
            const response = await fetch(`/api/v1/canvases/${canvasId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                throw new Error(errorBody?.detail || 'Failed to update canvas name');
            }
        } catch (err) {
            setCanvasName(previousName);
            setCanvasLoadError(err instanceof Error ? err.message : 'Failed to update canvas name');
        }
    };

    // Calculate displayed items (Time Machine logic)
    const displayedItems = useMemo(() => {
        if (isTimeMachineActive && versions[timeMachineIndex]?.snapshot) {
            return versions[timeMachineIndex].snapshot as CanvasItem[];
        }
        return allItems;
    }, [isTimeMachineActive, versions, timeMachineIndex, allItems]);

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
                    const plainText = stripHtmlTags(noteContent.text || '');
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

        // Actions
        updateCanvasName,
        refreshMetadata: fetchCanvasMetadata
    };
}
