"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/fetch-client";

/** IMP-097 — "Remind me" and "Something old". */

export interface UpcomingReminder {
  id: string;
  remindAt: string;
  itemId: string;
  canvasId: string;
  canvasName: string;
  title: string;
  url: string;
}

export interface SomethingOld {
  id: string;
  canvasId: string;
  canvasName: string;
  type: string;
  title: string;
  url: string;
  savedAt: string;
  lastOpenedAt: string | null;
}

export const reminderKeys = {
  all: ["reminders"] as const,
  upcoming: () => [...reminderKeys.all, "upcoming"] as const,
  item: (itemId: string) => [...reminderKeys.all, "item", itemId] as const,
  old: (exclude: string[]) =>
    [...reminderKeys.all, "something-old", ...exclude] as const,
};

const itemPath = (itemId: string) =>
  `/api/v1/items/${encodeURIComponent(itemId)}/reminder`;

/** 9:00 local time, `days` days from today. */
export function morningIn(days: number, from = new Date()): Date {
  const at = new Date(from);
  at.setDate(at.getDate() + days);
  at.setHours(9, 0, 0, 0);
  return at;
}

export function useItemReminder(itemId: string | null) {
  return useQuery({
    queryKey: reminderKeys.item(itemId ?? ""),
    enabled: Boolean(itemId),
    queryFn: async () =>
      (
        (await (await apiFetch(itemPath(itemId!))).json()) as {
          reminder: { id: string; remindAt: string } | null;
        }
      ).reminder,
  });
}

export function useUpcomingReminders() {
  return useQuery({
    queryKey: reminderKeys.upcoming(),
    queryFn: async () =>
      (
        (await (await apiFetch("/api/v1/reminders")).json()) as {
          reminders: UpcomingReminder[];
        }
      ).reminders,
  });
}

export function useSetReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { itemId: string; remindAt: Date }) =>
      (
        await apiFetch(itemPath(input.itemId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remindAt: input.remindAt.toISOString() }),
        })
      ).json(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: reminderKeys.all }),
  });
}

export function useCancelReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      await apiFetch(itemPath(itemId), { method: "DELETE" });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: reminderKeys.all }),
  });
}

export function useSomethingOld(exclude: string[]) {
  return useQuery({
    queryKey: reminderKeys.old(exclude),
    queryFn: async () => {
      const query = new URLSearchParams();
      for (const id of exclude) query.append("exclude", id);
      const suffix = query.size ? `?${query.toString()}` : "";
      return (
        (await (await apiFetch(`/api/v1/something-old${suffix}`)).json()) as {
          item: SomethingOld | null;
        }
      ).item;
    },
    staleTime: Infinity,
  });
}

/** Opening "something old" counts as opened, so it is not offered again. */
export function markItemOpened(itemId: string) {
  void fetch(`/api/v1/items/${encodeURIComponent(itemId)}/opened`, {
    method: "POST",
    keepalive: true,
  }).catch(() => undefined);
}
