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
  Typography,
} from "@mui/material";
import { NotificationsNoneOutlined as NotificationsIcon } from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import { useActivities } from "@/lib/hooks/use-activities";
import { getActivityMessage } from "@/features/dashboard/components/activity-utils";
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
  } = useActivities();

  const activities = data?.pages.flatMap((page) => page.activities) || [];

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Recent activity across your canvases"
      />

      {error && <Alert severity="error">Failed to load notifications</Alert>}

      {isLoading && (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <NotificationSkeleton key={i} />
          ))}
        </Paper>
      )}

      {!isLoading && !error && activities.length === 0 && (
        <EmptyState
          icon={NotificationsIcon}
          title="No recent activity"
          description="Activity on your canvases — edits, shares, and comments — will show up here."
        />
      )}

      {!isLoading && activities.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
          <List sx={{ p: 0 }}>
            {activities.map((activity) => {
              const message = (
                <>
                  <Typography component="span" fontWeight={600}>
                    {activity.user.name || activity.user.email}
                  </Typography>{" "}
                  <Typography component="span" color="text.secondary">
                    {getActivityMessage(activity)}
                  </Typography>
                </>
              );

              return (
                <ListItem
                  key={activity.id}
                  divider
                  sx={{
                    "&:hover": { bgcolor: "action.hover" },
                    "&:last-child": { borderBottom: 0 },
                  }}
                >
                  <ListItemAvatar>
                    <Avatar src={activity.user.image || undefined}>
                      {(activity.user.name ||
                        activity.user.email ||
                        "?")[0].toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      activity.canvasId ? (
                        <Link
                          href={`/canvas/${activity.canvasId}`}
                          style={{ textDecoration: "none", color: "inherit" }}
                        >
                          <Box
                            component="span"
                            sx={{ "&:hover": { textDecoration: "underline" } }}
                          >
                            {message}
                          </Box>
                        </Link>
                      ) : (
                        message
                      )
                    }
                    secondary={formatDistanceToNow(
                      new Date(activity.createdAt),
                      { addSuffix: true },
                    )}
                    secondaryTypographyProps={{ variant: "caption" }}
                  />
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
