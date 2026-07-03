/**
 * Activity Feed Component
 * Display recent user activities
 */

'use client';

import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
  Avatar,
} from '@mui/material';
import { Edit } from '@mui/icons-material';
import { useActivities } from '@/lib/hooks/use-activities';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { activityIcons, activityColors, getActivityMessage } from './activity-utils';

interface ActivityFeedProps {
  canvasId?: string;
  limit?: number;
  showTitle?: boolean;
}

/** Standalone sentence form of the shared activity message ("Created canvas …"). */
function activitySentence(activity: Parameters<typeof getActivityMessage>[0]): string {
  const message = getActivityMessage(activity);
  return message.charAt(0).toUpperCase() + message.slice(1);
}

export function ActivityFeed({ canvasId, limit = 20, showTitle = true }: ActivityFeedProps) {
  const { data, isLoading, error } = useActivities(canvasId, limit);

  const activities = data?.activities || [];

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Failed to load activity feed
      </Alert>
    );
  }

  return (
    <Box>
      {showTitle && (
        <Typography variant="h6" gutterBottom>
          Recent Activity
        </Typography>
      )}

      {activities.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="body2" color="text.secondary">
            No recent activity
          </Typography>
        </Box>
      ) : (
        <List sx={{ p: 0 }}>
          {activities.map((activity) => (
            <ListItem
              key={activity.id}
              sx={{
                px: 0,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                '&:last-child': { borderBottom: 0 },
              }}
            >
              <Avatar
                sx={{
                  mr: 2,
                  bgcolor: `${activityColors[activity.type] || 'default'}.main`,
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
                      <Link
                        href={`/canvas/${activity.canvasId}`}
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          {activitySentence(activity)}
                        </Typography>
                      </Link>
                    ) : (
                      <Typography variant="body2">
                        {activitySentence(activity)}
                      </Typography>
                    )}
                  </Box>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary">
                    {formatDistanceToNow(new Date(activity.createdAt), {
                      addSuffix: true,
                    })}
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
