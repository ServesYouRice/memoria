/**
 * Activities Hook
 * React Query hook for fetching user activities
 */

import { useQuery } from '@tanstack/react-query';

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
}

/**
 * Fetch user activities
 */
export function useActivities(canvasId?: string, limit: number = 50) {
  const params = new URLSearchParams();
  params.append('limit', limit.toString());
  if (canvasId) params.append('canvasId', canvasId);

  return useQuery<ActivitiesResponse>({
    queryKey: ['activities', canvasId, limit],
    queryFn: async () => {
      const response = await fetch(`/api/v1/activities?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch activities');
      }
      return response.json();
    },
  });
}
