/**
 * Canvas Items Data Hooks
 *
 * TanStack Query hooks for managing canvas items (notes, bookmarks, etc.).
 * Provides CRUD operations with optimistic updates and cache management.
 *
 * @module lib/hooks/use-canvas-items
 *
 * ## Architecture
 * Per ADR-0005 (State Management Policy):
 * - Server-persisted item data is managed here with TanStack Query
 * - Ephemeral UI state (selection, drag) is in Zustand store
 *
 * Per ADR-0009 (Autosave Delta Updates):
 * - Optimistic concurrency control with version numbers
 * - Automatic cache invalidation on mutations
 * - Version mismatch handling with data refetch
 *
 * ## Viewport-Based Loading
 * Supports efficient pagination for large canvases by loading only visible items:
 * ```typescript
 * useCanvasItems(canvasId, undefined, {
 *   minX: viewportX,
 *   maxX: viewportX + viewportWidth,
 *   minY: viewportY,
 *   maxY: viewportY + viewportHeight,
 *   limit: 100
 * });
 * ```
 *
 * ## Real-Time Updates (Issue #31)
 * ENHANCED with polling-based real-time updates for collaboration:
 * - Adaptive polling: 5s (active tab) / 30s (inactive tab)
 * - Page Visibility API for automatic frequency adjustment
 * - Zero overhead when disabled for private canvases
 *
 * @see {@link useAutosave} for debounced autosave implementation
 * @see {@link useCanvasHistory} for undo/redo with items
 * @see {@link useCanvasItemsWithPolling} for collaborative real-time updates
 */

import { apiFetch, ApiError, isVersionConflict } from "@/lib/api/fetch-client";
import {
  useMutation,
  useQuery,
  useSuspenseQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { nanoid } from "nanoid";
import { type ItemType, type CanvasItem } from "@/types/canvas";
import type { QueryClient } from "@tanstack/react-query";
import {
  type CreateCanvasItemInput,
  type UpdateCanvasItemInput,
  type DeleteCanvasItemInput,
} from "@/lib/validation/canvas-item";
import {
  POLLING_INTERVAL_ACTIVE_MS,
  POLLING_INTERVAL_INACTIVE_MS,
  ENABLE_COLLABORATIVE_POLLING,
} from "@/lib/constants";
import {
  canvasItemListResponseSchema,
  type CanvasItemListResponse,
} from "@/lib/api/response-schemas";

/**
 * Viewport parameters for viewport-based loading
 */
export interface ViewportParams {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  limit?: number;
  offset?: number;
}

/**
 * API client functions
 */
const api = {
  async listItems(
    canvasId: string,
    type?: ItemType,
    viewport?: ViewportParams,
  ) {
    const buildParams = (
      offset?: number,
      limit?: number,
      cursor?: string | null,
    ) => {
      const params = new URLSearchParams({ canvasId });
      if (type) params.set("type", type);

      if (viewport) {
        params.set("minX", viewport.minX.toString());
        params.set("maxX", viewport.maxX.toString());
        params.set("minY", viewport.minY.toString());
        params.set("maxY", viewport.maxY.toString());
      }

      if (cursor) {
        params.set("cursor", cursor);
      } else if (offset !== undefined) {
        params.set("offset", offset.toString());
      }
      if (limit !== undefined) params.set("limit", limit.toString());

      return params;
    };

    const fetchPage = async (
      offset?: number,
      limit?: number,
      cursor?: string | null,
    ): Promise<CanvasItemListResponse> => {
      const response = await apiFetch(
        `/api/v1/canvas-items?${buildParams(offset, limit, cursor)}`,
      );
      if (!response.ok) throw new Error("Failed to fetch items");
      const raw = await response.json();
      return canvasItemListResponseSchema.parse(raw);
    };

    const firstPage = await fetchPage(viewport?.offset, viewport?.limit);
    const items: CanvasItem[] = firstPage.items as unknown as CanvasItem[];
    let total = firstPage.total;
    let offset = firstPage.offset ?? 0;
    let limit = firstPage.limit ?? items.length;
    let hasMore = firstPage.hasMore;
    let nextCursor = firstPage.nextCursor;

    if (!viewport && hasMore) {
      const pageLimit = limit || 100;
      let pageCount = 1;

      while (hasMore && pageCount < 100) {
        const nextPage = await fetchPage(
          nextCursor ? undefined : items.length,
          pageLimit,
          nextCursor,
        );
        if (nextPage.items.length === 0) {
          break;
        }
        items.push(...(nextPage.items as unknown as CanvasItem[]));
        total = nextPage.total;
        hasMore = nextPage.hasMore;
        nextCursor = nextPage.nextCursor;
        pageCount += 1;
      }

      if (hasMore) throw new Error("Canvas exceeds the safe item page limit");

      offset = 0;
      limit = items.length;
    }

    return {
      items,
      total,
      offset,
      limit,
    };
  },

  async getItem(itemId: string) {
    const response = await apiFetch(`/api/v1/canvas-items/${itemId}`);
    if (!response.ok) throw new Error("Failed to fetch item");

    return response.json() as Promise<CanvasItem>;
  },

  async createItem(input: CreateCanvasItemInput) {
    const response = await apiFetch("/api/v1/canvas-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to create item");
    }

    return response.json() as Promise<CanvasItem>;
  },

  async updateItem(itemId: string, input: UpdateCanvasItemInput) {
    const response = await apiFetch(`/api/v1/canvas-items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        error.detail || "Failed to update item",
        {
          problemType: error.type,
          code: error.code || error.extensions?.code,
        },
      );
    }

    return response.json() as Promise<CanvasItem>;
  },

  async deleteItem(itemId: string, input: DeleteCanvasItemInput) {
    const response = await apiFetch(`/api/v1/canvas-items/${itemId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to delete item");
    }

    return response.json();
  },

  async restoreItem(itemId: string, version: number) {
    const response = await apiFetch(`/api/v1/trash`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, version }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to restore item");
    }

    return response.json();
  },
};

/**
 * Query keys factory
 */
export const canvasItemKeys = {
  all: ["canvas-items"] as const,
  lists: () => [...canvasItemKeys.all, "list"] as const,
  list: (canvasId: string, type?: ItemType, viewport?: ViewportParams) =>
    [...canvasItemKeys.lists(), { canvasId, type, viewport }] as const,
  detail: (itemId: string) =>
    [...canvasItemKeys.all, "detail", itemId] as const,
};

export interface CommittedCanvasItemEvent {
  schemaVersion: 1;
  cursor: string;
  operation: "created" | "updated" | "deleted";
  entity: { type: "canvas-item"; id: string; version: number };
}

/**
 * Apply a server-committed event to the existing item caches. Updates and
 * creates fetch only the affected item; deletes apply a versioned tombstone.
 * A reconnect therefore converges without refetching the whole canvas for
 * every WebSocket message.
 */
export async function mergeCommittedCanvasItemEvent(
  queryClient: QueryClient,
  event: CommittedCanvasItemEvent,
): Promise<void> {
  if (event.operation === "deleted") {
    queryClient.removeQueries({
      queryKey: canvasItemKeys.detail(event.entity.id),
    });
    queryClient.setQueriesData(
      { queryKey: canvasItemKeys.lists() },
      (old: { items?: CanvasItem[] } | undefined) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.filter(
            (item) =>
              item.id !== event.entity.id ||
              item.version > event.entity.version,
          ),
        };
      },
    );
    return;
  }

  try {
    const item = await api.getItem(event.entity.id);
    if (item.version < event.entity.version) return;
    queryClient.setQueryData(canvasItemKeys.detail(item.id), item);
    queryClient.setQueriesData(
      { queryKey: canvasItemKeys.lists() },
      (old: { items?: CanvasItem[] } | undefined) => {
        if (!old?.items) return old;
        const existing = old.items.findIndex(
          (candidate) => candidate.id === item.id,
        );
        if (existing < 0) return { ...old, items: [...old.items, item] };
        if (old.items[existing]!.version > item.version) return old;
        const items = [...old.items];
        items[existing] = item;
        return { ...old, items };
      },
    );
  } catch (error) {
    // A create/update event can race a revocation or deletion. Treat a
    // durable 404 as the corresponding tombstone and leave transient errors
    // for the normal query retry/snapshot path.
    if (error instanceof ApiError && error.status === 404) {
      queryClient.removeQueries({
        queryKey: canvasItemKeys.detail(event.entity.id),
      });
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.lists() },
        (old: { items?: CanvasItem[] } | undefined) =>
          old?.items
            ? {
                ...old,
                items: old.items.filter((item) => item.id !== event.entity.id),
              }
            : old,
      );
      return;
    }
    throw error;
  }
}

/**
 * Fetch all items for a canvas with optional type filtering and viewport pagination
 *
 * Retrieves canvas items with optional viewport-based pagination for efficient
 * rendering of large canvases. Supports filtering by item type (note, bookmark, etc.).
 *
 * @param canvasId - The canvas to fetch items from
 * @param type - Optional filter by item type (note, bookmark, etc.)
 * @param viewport - Optional viewport bounds for spatial pagination
 * @returns TanStack Query result with items array and pagination metadata
 *
 * @example
 * ```typescript
 * // Load all items
 * const { data, isLoading } = useCanvasItems('canvas-123');
 *
 * // Load only notes
 * const { data } = useCanvasItems('canvas-123', 'note');
 *
 * // Load items in viewport (efficient for large canvases)
 * const { data } = useCanvasItems('canvas-123', undefined, {
 *   minX: viewportX,
 *   maxX: viewportX + viewportWidth,
 *   minY: viewportY,
 *   maxY: viewportY + viewportHeight,
 *   limit: 100
 * });
 * ```
 */
export function useCanvasItems(
  canvasId: string,
  type?: ItemType,
  viewport?: ViewportParams,
) {
  return useSuspenseQuery({
    queryKey: canvasItemKeys.list(canvasId, type, viewport),
    queryFn: () => api.listItems(canvasId, type, viewport),
  });
}

/**
 * Fetch a single canvas item by ID
 *
 * Retrieves detailed information about a specific canvas item.
 * Data is cached and automatically updated when mutations occur.
 *
 * @param itemId - The unique item identifier
 * @returns TanStack Query result with item data
 *
 * @example
 * ```typescript
 * function ItemDetail({ itemId }: { itemId: string }) {
 *   const { data: item, isLoading } = useCanvasItem(itemId);
 *   if (isLoading) return <div>Loading...</div>;
 *   return <div>{item.type}: {JSON.stringify(item.content)}</div>;
 * }
 * ```
 */
export function useCanvasItem(itemId: string) {
  return useQuery({
    queryKey: canvasItemKeys.detail(itemId),
    queryFn: () => api.getItem(itemId),
    enabled: !!itemId,
  });
}

/**
 * Custom hook to track page visibility for adaptive polling
 * Uses the Page Visibility API to detect when tab is active/inactive
 *
 * FEATURE: Issue #31 - Real-time updates with adaptive polling
 */
function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    // Set initial visibility
    setIsVisible(!document.hidden);

    // Listen for visibility changes
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

/**
 * List canvas items with polling-based real-time updates
 *
 * FEATURE: Issue #31 - Real-time updates for collaboration
 *
 * This hook extends useCanvasItems with adaptive polling that:
 * - Polls every 5 seconds when tab is active
 * - Polls every 30 seconds when tab is inactive (battery/resource saving)
 * - Automatically pauses when polling is disabled
 * - Provides near real-time collaboration without WebSocket infrastructure
 *
 * Usage for shared canvases:
 * ```
 * const { data, isLoading } = useCanvasItemsWithPolling(canvasId, {
 *   enablePolling: canvas.isShared, // Only poll for shared canvases
 *   viewport: { minX, maxX, minY, maxY },
 * });
 * ```
 *
 * @param canvasId - The canvas ID to fetch items for
 * @param options - Configuration options
 * @param options.type - Optional item type filter
 * @param options.viewport - Optional viewport parameters for efficient loading
 * @param options.enablePolling - Enable/disable polling (default: true for shared canvases)
 */
export function useCanvasItemsWithPolling(
  canvasId: string,
  options?: {
    type?: ItemType;
    viewport?: ViewportParams;
    enablePolling?: boolean;
  },
) {
  const isPageVisible = usePageVisibility();
  const {
    type,
    viewport,
    enablePolling = ENABLE_COLLABORATIVE_POLLING,
  } = options || {};

  // Determine refetch interval based on visibility and polling config
  const refetchInterval =
    enablePolling && isPageVisible
      ? POLLING_INTERVAL_ACTIVE_MS // 5s when active
      : enablePolling && !isPageVisible
        ? POLLING_INTERVAL_INACTIVE_MS // 30s when inactive
        : false; // No polling if disabled

  return useQuery({
    queryKey: canvasItemKeys.list(canvasId, type, viewport),
    queryFn: () => api.listItems(canvasId, type, viewport),
    enabled: !!canvasId,
    refetchInterval,
    // Keep previous data while refetching to prevent UI flicker
    placeholderData: (previousData) => previousData,
    // Refetch on window focus for immediate updates when user returns
    refetchOnWindowFocus: enablePolling,
    // Stale time matches polling interval to prevent redundant fetches
    staleTime: enablePolling ? POLLING_INTERVAL_ACTIVE_MS : Infinity,
  });
}

/**
 * Create a new canvas item
 *
 * OPTIMIZED: Issue #29 - Optimistic updates for better UX
 * Creates item in cache immediately, rolls back on error
 *
 * Mutates server state to create a new item (note, bookmark, etc.).
 * Automatically invalidates canvas item list queries on success.
 *
 * @returns TanStack Query mutation result
 *
 * @example
 * ```typescript
 * function AddNoteButton({ canvasId }: { canvasId: string }) {
 *   const createItem = useCreateCanvasItem();
 *
 *   const handleClick = async () => {
 *     await createItem.mutateAsync({
 *       canvasId,
 *       type: 'note',
 *       positionX: 100,
 *       positionY: 100,
 *       width: 300,
 *       height: 200,
 *       content: { text: '', backgroundColor: '#FFFACD' }
 *     });
 *   };
 *
 *   return <button onClick={handleClick}>Add Note</button>;
 * }
 * ```
 */
export function useCreateCanvasItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createItem,
    onMutate: async (newItem) => {
      // Scope cancellation to this canvas's list queries
      await queryClient.cancelQueries({
        queryKey: canvasItemKeys.list(newItem.canvasId),
      });

      const tempId = `temp-${nanoid(10)}`;

      // Optimistically update cache with temporary item
      const optimisticItem = {
        ...newItem,
        id: tempId,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };

      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.list(newItem.canvasId) },
        (old: { items?: CanvasItem[] } | undefined) => ({
          ...old,
          items: old?.items
            ? [...old.items, optimisticItem as unknown as CanvasItem]
            : [optimisticItem as unknown as CanvasItem],
        }),
      );

      return { tempId, canvasId: newItem.canvasId };
    },
    onSuccess: (newItem, _variables, context) => {
      // Replace temporary item with real server item in place
      queryClient.setQueriesData(
        {
          queryKey: canvasItemKeys.list(
            context?.canvasId || newItem.canvasId,
          ),
        },
        (old: { items?: CanvasItem[] } | undefined) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === context?.tempId ? newItem : item,
            ),
          };
        },
      );
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.list(newItem.canvasId),
      });
    },
    onError: (_err, newItem, context) => {
      // Targeted rollback: remove only the temporary item
      if (context?.tempId) {
        queryClient.setQueriesData(
          { queryKey: canvasItemKeys.list(context.canvasId) },
          (old: { items?: CanvasItem[] } | undefined) => {
            if (!old?.items) return old;
            return {
              ...old,
              items: old.items.filter((item) => item.id !== context.tempId),
            };
          },
        );
      }
    },
  });
}

/**
 * Update an existing canvas item
 *
 * OPTIMIZED: Issue #29 - Optimistic updates for better UX
 * Updates item in cache immediately, rolls back on error
 *
 * Mutates server state to update item properties (position, size, content).
 * Implements optimistic concurrency control with version numbers (ADR-0009).
 * Automatically handles version mismatches by refetching data.
 *
 * @returns TanStack Query mutation result
 */
export function useUpdateCanvasItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      itemId,
      data,
    }: {
      itemId: string;
      data: UpdateCanvasItemInput;
    }) => api.updateItem(itemId, data),
    onMutate: async ({ itemId, data }) => {
      // Find previous item snapshot specifically for this item
      const previousItem =
        queryClient.getQueryData<CanvasItem>(canvasItemKeys.detail(itemId)) ||
        queryClient
          .getQueriesData<{ items?: CanvasItem[] }>({
            queryKey: canvasItemKeys.lists(),
          })
          .flatMap(([_, d]) => d?.items || [])
          .find((item) => item.id === itemId);

      if (previousItem) {
        queryClient.setQueryData(
          canvasItemKeys.detail(itemId),
          (old: CanvasItem | undefined) => {
            if (!old) return old;
            return {
              ...old,
              ...data,
              updatedAt: new Date(),
            };
          },
        );

        queryClient.setQueriesData(
          { queryKey: canvasItemKeys.lists() },
          (old: { items?: CanvasItem[] } | undefined) => {
            if (!old?.items) return old;
            return {
              ...old,
              items: old.items.map((item) =>
                item.id === itemId
                  ? ({ ...item, ...data, updatedAt: new Date() } as CanvasItem)
                  : item,
              ),
            };
          },
        );
      }

      return { previousItem, itemId };
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData(
        canvasItemKeys.detail(updatedItem.id),
        updatedItem,
      );
      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.list(updatedItem.canvasId) },
        (old: { items?: CanvasItem[] } | undefined) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === updatedItem.id ? updatedItem : item,
            ),
          };
        },
      );
    },
    onError: (error: Error, _variables, context) => {
      // Targeted rollback: restore only the affected item
      if (context?.previousItem) {
        queryClient.setQueryData(
          canvasItemKeys.detail(context.itemId),
          context.previousItem,
        );
        queryClient.setQueriesData(
          { queryKey: canvasItemKeys.lists() },
          (old: { items?: CanvasItem[] } | undefined) => {
            if (!old?.items) return old;
            return {
              ...old,
              items: old.items.map((item) =>
                item.id === context.itemId
                  ? (context.previousItem as CanvasItem)
                  : item,
              ),
            };
          },
        );
      }

      if (isVersionConflict(error)) {
        queryClient.invalidateQueries({
          queryKey: canvasItemKeys.all,
        });
      }
    },
  });
}

/**
 * Delete a canvas item
 *
 * OPTIMIZED: Issue #29 - Optimistic updates for better UX
 * Removes item from cache immediately, rolls back on error
 *
 * Mutates server state to permanently delete an item.
 * Requires version number for optimistic concurrency control.
 * Automatically invalidates all item queries on success.
 *
 * @returns TanStack Query mutation result
 */
export function useDeleteCanvasItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, version }: { itemId: string; version: number }) =>
      api.deleteItem(itemId, { version }),
    onMutate: async ({ itemId }) => {
      const deletedItem =
        queryClient.getQueryData<CanvasItem>(canvasItemKeys.detail(itemId)) ||
        queryClient
          .getQueriesData<{ items?: CanvasItem[] }>({
            queryKey: canvasItemKeys.lists(),
          })
          .flatMap(([_, d]) => d?.items || [])
          .find((item) => item.id === itemId);

      queryClient.setQueriesData(
        { queryKey: canvasItemKeys.lists() },
        (old: { items?: CanvasItem[] } | undefined) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.filter((item) => item.id !== itemId),
          };
        },
      );

      queryClient.removeQueries({
        queryKey: canvasItemKeys.detail(itemId),
      });

      return { deletedItem, itemId };
    },
    onError: (_err, _variables, context) => {
      // Targeted rollback: re-insert the deleted item back into list caches
      if (context?.deletedItem) {
        queryClient.setQueryData(
          canvasItemKeys.detail(context.itemId),
          context.deletedItem,
        );
        queryClient.setQueriesData(
          { queryKey: canvasItemKeys.lists() },
          (old: { items?: CanvasItem[] } | undefined) => {
            if (!old?.items) return old;
            return {
              ...old,
              items: [...old.items, context.deletedItem as CanvasItem],
            };
          },
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.lists(),
      });
    },
  });
}

/**
 * Restore a soft-deleted canvas item
 */
export function useRestoreCanvasItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, version }: { itemId: string; version: number }) =>
      api.restoreItem(itemId, version),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: canvasItemKeys.lists(),
      });
    },
  });
}
