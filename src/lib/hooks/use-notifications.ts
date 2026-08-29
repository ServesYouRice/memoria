"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/fetch-client";

export const NOTIFICATION_TYPES = [
  "CANVAS_SHARED",
  "SHARE_INVITATION_ACCEPTED",
  "SHARE_INVITATION_DECLINED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  CANVAS_SHARED: "Canvas invitations",
  SHARE_INVITATION_ACCEPTED: "Accepted invitations",
  SHARE_INVITATION_DECLINED: "Declined invitations",
};

export interface NotificationAction {
  href: string;
  label: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  subject: string;
  canvasId: string | null;
  readAt: string | null;
  createdAt: string;
  actor: { id: string; name: string | null; image: string | null };
  canvas: { id: string; name: string } | null;
  action: NotificationAction | null;
}

interface NotificationsPage {
  notifications: AppNotification[];
  unread: number;
  pagination: { total: number; limit: number; offset: number };
}

export interface NotificationPreference {
  type: NotificationType;
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

interface NotificationPreferencesResponse {
  preferences: NotificationPreference[];
}

export const notificationKeys = {
  all: ["notifications"] as const,
  inbox: () => [...notificationKeys.all, "inbox"] as const,
  unread: () => [...notificationKeys.all, "unread"] as const,
  preferences: () => [...notificationKeys.all, "preferences"] as const,
};

async function readJson<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) throw new Error(message);
  return (await response.json()) as T;
}

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.inbox(),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      readJson<NotificationsPage>(
        await apiFetch(
          `/api/v1/notifications?limit=25&offset=${String(pageParam)}`,
        ),
        "Failed to load notifications",
      ),
    getNextPageParam: (lastPage) => {
      const next = lastPage.pagination.offset + lastPage.notifications.length;
      return next < lastPage.pagination.total ? next : undefined;
    },
  });
}

export function useUnreadNotifications(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: async () =>
      (
        await readJson<NotificationsPage>(
          await apiFetch("/api/v1/notifications?limit=1&offset=0"),
          "Failed to load unread notifications",
        )
      ).unread,
    enabled,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids: string[] } | { all: true }) =>
      readJson<{ updated: number }>(
        await apiFetch("/api/v1/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
        "Failed to update notifications",
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: notificationKeys.inbox() }),
        queryClient.invalidateQueries({ queryKey: notificationKeys.unread() }),
      ]);
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: async () =>
      readJson<NotificationPreferencesResponse>(
        await apiFetch("/api/v1/notifications/preferences"),
        "Failed to load notification preferences",
      ),
  });
}

export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (preference: NotificationPreference) =>
      readJson<NotificationPreference>(
        await apiFetch("/api/v1/notifications/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preference),
        }),
        "Failed to save notification preference",
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData<NotificationPreferencesResponse>(
        notificationKeys.preferences(),
        (current) => ({
          preferences: (current?.preferences ?? []).map((preference) =>
            preference.type === saved.type ? saved : preference,
          ),
        }),
      );
    },
  });
}
