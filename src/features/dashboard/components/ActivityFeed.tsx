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
import {
  Add,
  Edit,
  Delete,
  Share,
  Comment,
  ContentCopy,
} from '@mui/icons-material';
import { useActivities } from '@/lib/hooks/use-activities';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

interface ActivityFeedProps {
  canvasId?: string;
  limit?: number;
  showTitle?: boolean;
}

const activityIcons: Record<string, React.ReactNode> = {
  CANVAS_CREATED: <Add fontSize="small" />,
  CANVAS_UPDATED: <Edit fontSize="small" />,
  CANVAS_DELETED: <Delete fontSize="small" />,
  CANVAS_SHARED: <Share fontSize="small" />,
  ITEM_CREATED: <Add fontSize="small" />,
  ITEM_UPDATED: <Edit fontSize="small" />,
  ITEM_DELETED: <Delete fontSize="small" />,
  COMMENT_ADDED: <Comment fontSize="small" />,
  TEMPLATE_CREATED: <ContentCopy fontSize="small" />,
  TEMPLATE_USED: <ContentCopy fontSize="small" />,
};

const activityColors: Record<string, string> = {
  CANVAS_CREATED: 'success',
  CANVAS_UPDATED: 'info',
  CANVAS_DELETED: 'error',
  CANVAS_SHARED: 'primary',
  ITEM_CREATED: 'success',
  ITEM_UPDATED: 'info',
  ITEM_DELETED: 'error',
  COMMENT_ADDED: 'primary',
  TEMPLATE_CREATED: 'secondary',
  TEMPLATE_USED: 'secondary',
};

function getActivityMessage(activity: any): string {
  switch (activity.type) {
    case 'CANVAS_CREATED':
      return `Created canvas "${activity.canvasName}"`;
    case 'CANVAS_UPDATED':
      return `Updated canvas "${activity.canvasName}"`;
    case 'CANVAS_DELETED':
      return `Deleted canvas "${activity.canvasName}"`;
    case 'CANVAS_SHARED':
      return `Shared canvas "${activity.canvasName}"`;
    case 'ITEM_CREATED':
      return `Added item to "${activity.canvasName}"`;
    case 'ITEM_UPDATED':
      return `Updated item in "${activity.canvasName}"`;
    case 'ITEM_DELETED':
      return `Deleted item from "${activity.canvasName}"`;
    case 'COMMENT_ADDED':
      return `Commented on "${activity.canvasName}"`;
    case 'TEMPLATE_CREATED':
      return `Created template "${activity.canvasName}"`;
    case 'TEMPLATE_USED':
      return `Used template "${activity.canvasName}"`;
    default:
      return 'Unknown activity';
  }
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
                          {getActivityMessage(activity)}
                        </Typography>
                      </Link>
                    ) : (
                      <Typography variant="body2">
                        {getActivityMessage(activity)}
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
