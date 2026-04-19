/**
 * Comments Hook
 * React Query hooks for managing canvas item comments
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
    queryKey: ["comments", itemId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/items/${itemId}/comments`);
      if (!response.ok) {
        throw new Error("Failed to fetch comments");
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
    mutationFn: async ({
      itemId,
      content,
    }: {
      itemId: string;
      content: string;
    }) => {
      const response = await fetch(`/api/v1/items/${itemId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create comment");
      }

      return response.json();
    },
    onMutate: async (newComment) => {
      await queryClient.cancelQueries({
        queryKey: ["comments", newComment.itemId],
      });
      const previousComments = queryClient.getQueryData([
        "comments",
        newComment.itemId,
      ]);

      queryClient.setQueryData(
        ["comments", newComment.itemId],
        (old: CommentsResponse | undefined) => {
          const optimisticComment: Comment = {
            id: "temp-" + Date.now(),
            itemId: newComment.itemId,
            userId: "current-user", // Should be replaced by actual user ID if available, but for UI it's fine
            content: newComment.content,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            user: {
              // Optimistic user needed
              id: "current-user",
              name: "You",
              image: null,
            }, // Ideally we get this from session context, but complex to pass here.
          };
          return {
            comments: [...(old?.comments || []), optimisticComment],
          };
        },
      );

      return { previousComments };
    },
    onError: (err, newComment, context) => {
      queryClient.setQueryData(
        ["comments", newComment.itemId],
        context?.previousComments,
      );
    },
    onSettled: (_, __, variables) => {
      // Invalidate comments query to refetch
      queryClient.invalidateQueries({
        queryKey: ["comments", variables.itemId],
      });
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
      const response = await fetch(
        `/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update comment");
      }

      return response.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: ["comments", variables.itemId],
      });
      const previousComments = queryClient.getQueryData([
        "comments",
        variables.itemId,
      ]);

      queryClient.setQueryData(
        ["comments", variables.itemId],
        (old: CommentsResponse | undefined) => {
          if (!old) return old;
          return {
            comments: old.comments.map((c) =>
              c.id === variables.commentId
                ? {
                    ...c,
                    content: variables.content,
                    updatedAt: new Date().toISOString(),
                  }
                : c,
            ),
          };
        },
      );

      return { previousComments };
    },
    onError: (err, variables, context: any) => {
      queryClient.setQueryData(
        ["comments", variables.itemId],
        context?.previousComments,
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["comments", variables.itemId],
      });
    },
  });
}

/**
 * Delete a comment
 */
export function useDeleteComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      itemId,
      commentId,
    }: {
      itemId: string;
      commentId: string;
    }) => {
      const response = await fetch(
        `/api/v1/items/${itemId}/comments/${commentId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete comment");
      }

      return response.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: ["comments", variables.itemId],
      });
      const previousComments = queryClient.getQueryData([
        "comments",
        variables.itemId,
      ]);

      queryClient.setQueryData(
        ["comments", variables.itemId],
        (old: CommentsResponse | undefined) => {
          if (!old) return old;
          return {
            comments: old.comments.filter((c) => c.id !== variables.commentId),
          };
        },
      );

      return { previousComments };
    },
    onError: (err, variables, context: any) => {
      queryClient.setQueryData(
        ["comments", variables.itemId],
        context?.previousComments,
      );
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["comments", variables.itemId],
      });
    },
  });
}
