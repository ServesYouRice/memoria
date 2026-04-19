"use client";

import React from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Paper,
  Divider,
  CircularProgress,
  Alert,
  Container,
} from "@mui/material";
import { Notifications as NotificationsIcon } from "@mui/icons-material";
import { useActivities } from "@/lib/hooks/use-activities";
import { formatDistanceToNow } from "date-fns";

export default function NotificationsPage() {
  const { data, isLoading, error } = useActivities();

  const activities = data?.activities || [];

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4, display: "flex", alignItems: "center", gap: 2 }}>
        <NotificationsIcon color="primary" sx={{ fontSize: 32 }} />
        <Typography variant="h4" fontWeight={700}>
          Notifications
        </Typography>
      </Box>

      {error ? (
        <Alert severity="error">Failed to load notifications</Alert>
      ) : isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : activities.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">No recent activity</Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <List sx={{ p: 0 }}>
            {activities.map((activity, index) => (
              <React.Fragment key={activity.id}>
                {index > 0 && <Divider />}
                <ListItem
                  alignItems="flex-start"
                  sx={{ "&:hover": { bgcolor: "action.hover" } }}
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
                      <Box component="span" sx={{ display: "flex", gap: 1 }}>
                        <Typography component="span" fontWeight={600}>
                          {activity.user.name || activity.user.email}
                        </Typography>
                        <Typography component="span" color="text.secondary">
                          {formatActivityType(activity.type)}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <React.Fragment>
                        <Typography
                          component="span"
                          variant="body2"
                          color="text.primary"
                          sx={{ display: "block", mt: 0.5 }}
                        >
                          {/* Try to show some details if available */}
                          {JSON.stringify(activity.metadata)}
                        </Typography>
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                        >
                          {formatDistanceToNow(new Date(activity.createdAt), {
                            addSuffix: true,
                          })}
                        </Typography>
                      </React.Fragment>
                    }
                  />
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        </Paper>
      )}
    </Container>
  );
}

function formatActivityType(type: string) {
  // Basic formatter, extend as needed based on actual Activity types
  return type.toLowerCase().replace(/_/g, " ");
}
