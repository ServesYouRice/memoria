/**
 * Activity Feed Component
 * Display recent user activities
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
  Avatar,
  Button,
} from "@mui/material";
import { Edit } from "@mui/icons-material";
import { useActivities } from "@/lib/hooks/use-activities";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import {
  activityIcons,
  activityColors,
  getActivityGroupMessage,
  groupActivities,
} from "./activity-utils";

/** IMP-138: lines shown before "Show all activity". */
const COLLAPSED_LINES = 5;

interface ActivityFeedProps {
  canvasId?: string;
  limit?: number;
  showTitle?: boolean;
  /** Optional action control placed opposite the "Latest activity" title. */
  headerAction?: React.ReactNode;
  /** Told once loaded whether there is anything to show (IMP-083). */
  onHasActivity?: (hasActivity: boolean) => void;
}

/** Standalone sentence form of the shared activity message ("Created canvas …"). */
function activitySentence(
  group: Parameters<typeof getActivityGroupMessage>[0],
): string {
  const message = getActivityGroupMessage(group);
  return message.charAt(0).toUpperCase() + message.slice(1);
}

export function ActivityFeed({
  canvasId,
  limit = 20,
  showTitle = true,
  headerAction,
  onHasActivity,
}: ActivityFeedProps) {
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useActivities(canvasId, limit);

  const activities = useMemo(
    () => data?.pages.flatMap((page) => page.activities) || [],
    [data],
  );
  const groups = useMemo(() => groupActivities(activities), [activities]);
  const [showAll, setShowAll] = useState(false);
  const collapsed = !showAll && groups.length > COLLAPSED_LINES;
  const shownGroups = collapsed ? groups.slice(0, COLLAPSED_LINES) : groups;
  const hasActivity = activities.length > 0;
  const loaded = !isLoading && !error;

  useEffect(() => {
    if (loaded) onHasActivity?.(hasActivity);
  }, [loaded, hasActivity, onHasActivity]);

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress aria-label="Loading recent activity" />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load activity feed</Alert>;
  }

  return (
    <Box>
      {showTitle && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mb: 0.75,
          }}
        >
          <Typography variant="h6">Latest activity</Typography>
          {headerAction}
        </Box>
      )}

      {activities.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
            }}
          >
            No recent activity
          </Typography>
        </Box>
      ) : (
        <List sx={{ p: 0 }}>
          {shownGroups.map((group) => {
            const activity = group.latest;
            return (
              <ListItem
                key={group.key}
                sx={{
                  px: 0,
                  py: 1.5,
                  borderBottom: 1,
                  borderColor: "divider",
                  "&:last-child": { borderBottom: 0 },
                }}
              >
                <Avatar
                  sx={{
                    mr: 2,
                    bgcolor: `${activityColors[activity.type] || "default"}.main`,
                    width: 36,
                    height: 36,
                  }}
                >
                  {activityIcons[activity.type] || <Edit fontSize="small" />}
                </Avatar>
                <ListItemText
                  primary={
                    <Box>
                      {activity.canvasId && !canvasId ? (
                        <Box
                          component={Link}
                          href={`/canvas/${activity.canvasId}`}
                          sx={{ textDecoration: "none", color: "inherit" }}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              "&:hover": { textDecoration: "underline" },
                            }}
                          >
                            {activitySentence(group)}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2">
                          {activitySentence(group)}
                        </Typography>
                      )}
                    </Box>
                  }
                  secondary={
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                      }}
                    >
                      {formatDistanceToNow(new Date(activity.createdAt), {
                        addSuffix: true,
                      })}
                    </Typography>
                  }
                />
              </ListItem>
            );
          })}
          {collapsed && (
            <ListItem sx={{ justifyContent: "center" }}>
              <Button onClick={() => setShowAll(true)}>
                Show all activity
              </Button>
            </ListItem>
          )}
          {!collapsed && hasNextPage && (
            <ListItem sx={{ justifyContent: "center" }}>
              <Button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more activity"}
              </Button>
            </ListItem>
          )}
        </List>
      )}
    </Box>
  );
}
