import { useQuery } from '@tanstack/react-query';

export interface Activity {
    id: string;
    type: string;
    details: any;
    createdAt: string;
    user: {
        id: string;
        name: string | null;
        email: string | null;
        image: string | null;
    };
}

interface ActivitiesResponse {
    activities: Activity[];
}

export function useActivities(limit = 50) {
    return useQuery<ActivitiesResponse>({
        queryKey: ['activities', limit],
        queryFn: async () => {
            const response = await fetch(`/api/v1/activities?limit=${limit}`);
            if (!response.ok) {
                throw new Error('Failed to fetch activities');
            }
            return response.json();
        },
    });
}
