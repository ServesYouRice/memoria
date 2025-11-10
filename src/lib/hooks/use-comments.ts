/**
 * Comments Hook
 * React Query hooks for managing canvas item comments
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface Comment {
  id: string;
  itemId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

interface CommentsResponse {
  comments: Comment[];
}

/**
 * Fetch all comments for a canvas item
 */
export function useComments(itemId: string) {
  return useQuery<CommentsResponse>({
    queryKey: ['comments', itemId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/items/${itemId}/comments`);
      if (!response.ok) {
        throw new Error('Failed to fetch comments');
      }
      return response.json();
    },
    enabled: !!itemId,
  });
}

/**
 * Create a new comment
 */
export function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, content }: { itemId: string; content: string }) => {
      const response = await fetch(`/api/v1/items/${itemId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create comment');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate comments query to refetch
      queryClient.invalidateQueries({ queryKey: ['comments', variables.itemId] });
    },
  });
}

/**
 * Update an existing comment
 */
export function useUpdateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      itemId,
      commentId,
      content,
    }: {
      itemId: string;
      commentId: string;
      content: string;
    }) => {
      const response = await fetch(`/api/v1/items/${itemId}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update comment');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['comments', variables.itemId] });
    },
  });
}

/**
 * Delete a comment
 */
export function useDeleteComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, commentId }: { itemId: string; commentId: string }) => {
      const response = await fetch(`/api/v1/items/${itemId}/comments/${commentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete comment');
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['comments', variables.itemId] });
    },
  });
}
