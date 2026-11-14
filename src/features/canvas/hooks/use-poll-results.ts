"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/fetch-client";
import { isLaunchCapabilityEnabled } from "@/lib/product-surfaces";
import type { PollResult } from "@/lib/polls/shared";

/**
 * IMP-104: poll counts come from the server, one request per canvas shared
 * by every poll on it. A "poll-changed" notice on the live connection (or a
 * vote of one's own) refreshes them, so everyone sees the same counts.
 */

export const pollKeys = {
  canvas: (canvasId: string) => ["polls", canvasId] as const,
};

async function fetchCanvasPolls(canvasId: string): Promise<PollResult[]> {
  const response = await apiFetch(
    `/api/v1/canvases/${encodeURIComponent(canvasId)}/polls`,
    { cache: "no-store" },
  );
  return ((await response.json()) as { polls: PollResult[] }).polls;
}

export function usePollResult(
  canvasId: string,
  itemId: string,
): PollResult | undefined {
  const { data } = useQuery({
    queryKey: pollKeys.canvas(canvasId),
    queryFn: () => fetchCanvasPolls(canvasId),
    enabled: isLaunchCapabilityEnabled("polls") && Boolean(canvasId),
    staleTime: 30_000,
  });
  return data?.find((poll) => poll.itemId === itemId);
}

function usePollWrite(
  canvasId: string,
  itemId: string,
  method: "PUT" | "PATCH",
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: unknown) => {
      const response = await apiFetch(
        `/api/v1/canvas-items/${encodeURIComponent(itemId)}/poll`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return (await response.json()) as PollResult;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<PollResult[]>(
        pollKeys.canvas(canvasId),
        (polls) =>
          polls?.some((poll) => poll.itemId === result.itemId)
            ? polls.map((poll) =>
                poll.itemId === result.itemId ? result : poll,
              )
            : [...(polls ?? []), result],
      );
    },
  });
}

/** Records the signed-in person's whole answer. */
export function usePollVote(canvasId: string, itemId: string) {
  const mutation = usePollWrite(canvasId, itemId, "PUT");
  return {
    vote: (choiceIds: string[]) => mutation.mutateAsync({ choiceIds }),
    isPending: mutation.isPending,
  };
}

/** The canvas owner closes or reopens the poll. */
export function usePollClose(canvasId: string, itemId: string) {
  const mutation = usePollWrite(canvasId, itemId, "PATCH");
  return {
    setClosed: (closed: boolean) => mutation.mutateAsync({ closed }),
    isPending: mutation.isPending,
  };
}

/** The next answer after choosing `choiceId`: switches, toggles or clears. */
export function nextPollChoices(
  current: string[],
  choiceId: string,
  multipleChoice: boolean,
): string[] {
  if (current.includes(choiceId))
    return current.filter((id) => id !== choiceId);
  return multipleChoice ? [...current, choiceId] : [choiceId];
}
