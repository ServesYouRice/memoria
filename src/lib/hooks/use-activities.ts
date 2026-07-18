/**
 * Activities Hook
 * React Query hook for fetching user activities
 */

import { apiFetch } from "@/lib/api/fetch-client";
import { useInfiniteQuery } from "@tanstack/react-query";

export interface Activity {
  id: string;
  userId: string;
  type: string;
  canvasId: string | null;
  canvasName: string | null;
  itemId: string | null;
  metadata: any;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

interface ActivitiesResponse {
  activities: Activity[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Fetch user activities
 */
export function useActivities(canvasId?: string, limit: number = 50) {
  return useInfiniteQuery<ActivitiesResponse>({
    queryKey: ["activities", canvasId, limit],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: String(pageParam),
      });
      if (canvasId) params.append("canvasId", canvasId);
      const response = await apiFetch(`/api/v1/activities?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch activities");
      }
      return response.json();
    },
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.activities.length
        : undefined,
  });
}
