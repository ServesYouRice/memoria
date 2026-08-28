"use client";

import React from "react";
import Link from "next/link";
import {
  Alert,
  Avatar,
  Box,
  Button,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import {
  DoneAllOutlined as DoneAllIcon,
  NotificationsNoneOutlined as NotificationsIcon,
} from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import {
  useMarkNotificationsRead,
  useNotifications,
} from "@/lib/hooks/use-notifications";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";

function NotificationSkeleton() {
  return (
    <Box sx={{ display: "flex", gap: 2, p: 2 }}>
      <Skeleton variant="circular" width={40} height={40} />
      <Box sx={{ flexGrow: 1 }}>
        <Skeleton width="60%" height={22} />
        <Skeleton width="30%" height={16} />
      </Box>
    </Box>
  );
}

export function NotificationsContent() {
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const notifications = data?.pages.flatMap((page) => page.notifications) ?? [];
  const unread = data?.pages[0]?.unread ?? 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={
          unread === 0
            ? "You are all caught up"
            : `${unread} unread notification${unread === 1 ? "" : "s"}`
        }
        actions={
          unread > 0 ? (
            <Button
              startIcon={<DoneAllIcon />}
              onClick={() => markRead.mutate({ all: true })}
              disabled={markRead.isPending}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {(error || markRead.error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {markRead.error instanceof Error
            ? markRead.error.message
            : "Failed to load notifications"}
        </Alert>
      )}

      {isLoading && (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          {[0, 1, 2, 3, 4].map((index) => (
            <NotificationSkeleton key={index} />
          ))}
        </Paper>
      )}

      {!isLoading && !error && notifications.length === 0 && (
        <EmptyState
          icon={NotificationsIcon}
          title="No notifications"
          description="Canvas invitations and responses will appear here. Activity remains available on the dashboard."
        />
      )}

      {!isLoading && notifications.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
          <List sx={{ p: 0 }} aria-label="Notification inbox">
            {notifications.map((notification) => {
              const isUnread = notification.readAt === null;
              const actorName = notification.actor.name || "A collaborator";
              return (
                <ListItem
                  key={notification.id}
                  divider
                  alignItems="flex-start"
                  sx={{
                    bgcolor: isUnread ? "action.selected" : "transparent",
                    "&:last-child": { borderBottom: 0 },
                  }}
                >
                  <ListItemAvatar>
                    <Avatar src={notification.actor.image || undefined}>
                      {actorName.charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "center" }}
                      >
                        <Typography
                          component="span"
                          sx={{ fontWeight: isUnread ? 700 : 500 }}
                        >
                          {notification.subject}
                        </Typography>
                        {isUnread && (
                          <Box
                            component="span"
                            aria-label="Unread"
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              bgcolor: "primary.main",
                              flexShrink: 0,
                            }}
                          />
                        )}
                      </Stack>
                    }
                    secondary={`${actorName} · ${notification.canvas?.name || "Canvas"} · ${formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}`}
                  />
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={0.5}
                    sx={{ ml: 1, alignItems: "flex-end" }}
                  >
                    {notification.action && (
                      <Button
                        component={Link}
                        href={notification.action.href}
                        size="small"
                        onClick={() => {
                          if (isUnread)
                            markRead.mutate({ ids: [notification.id] });
                        }}
                      >
                        {notification.action.label}
                      </Button>
                    )}
                    {isUnread && (
                      <Button
                        size="small"
                        onClick={() =>
                          markRead.mutate({ ids: [notification.id] })
                        }
                        disabled={markRead.isPending}
                      >
                        Mark read
                      </Button>
                    )}
                  </Stack>
                </ListItem>
              );
            })}
            {hasNextPage && (
              <ListItem sx={{ justifyContent: "center" }}>
                <Button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? "Loading…" : "Load more notifications"}
                </Button>
              </ListItem>
            )}
          </List>
        </Paper>
      )}
    </>
  );
}
