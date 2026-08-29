"use client";

import React from "react";
import {
  Alert,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import {
  NOTIFICATION_TYPE_LABELS,
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from "@/lib/hooks/use-notifications";

const DESCRIPTIONS = {
  CANVAS_SHARED: "When someone invites you to a canvas",
  SHARE_INVITATION_ACCEPTED: "When a recipient accepts your invitation",
  SHARE_INVITATION_DECLINED: "When a recipient declines your invitation",
} as const;

export function NotificationPreferences() {
  const preferences = useNotificationPreferences();
  const updatePreference = useUpdateNotificationPreference();

  if (preferences.isLoading) {
    return (
      <Stack spacing={1}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} variant="rounded" height={58} />
        ))}
      </Stack>
    );
  }

  if (preferences.error) {
    return (
      <Alert severity="error">Failed to load notification preferences.</Alert>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Choose which invitation events appear in the app or are delivered by
        email. Changes apply to future notifications.
      </Typography>
      {updatePreference.error && (
        <Alert severity="error">Failed to save notification preference.</Alert>
      )}
      <List disablePadding>
        {(preferences.data?.preferences ?? []).map((preference) => {
          const saving =
            updatePreference.isPending &&
            updatePreference.variables?.type === preference.type;
          return (
            <ListItem
              key={preference.type}
              divider
              sx={{
                px: 1,
                gap: 2,
                alignItems: { xs: "flex-start", sm: "center" },
                flexDirection: { xs: "column", sm: "row" },
              }}
            >
              <ListItemText
                primary={NOTIFICATION_TYPE_LABELS[preference.type]}
                secondary={DESCRIPTIONS[preference.type]}
              />
              <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                <FormControlLabel
                  label="In app"
                  control={
                    <Switch
                      checked={preference.inAppEnabled}
                      disabled={saving}
                      onChange={(_event, checked) =>
                        updatePreference.mutate({
                          ...preference,
                          inAppEnabled: checked,
                        })
                      }
                      slotProps={{
                        input: {
                          "aria-label": `${NOTIFICATION_TYPE_LABELS[preference.type]} in-app notifications`,
                        },
                      }}
                    />
                  }
                />
                <FormControlLabel
                  label="Email"
                  control={
                    <Switch
                      checked={preference.emailEnabled}
                      disabled={saving}
                      onChange={(_event, checked) =>
                        updatePreference.mutate({
                          ...preference,
                          emailEnabled: checked,
                        })
                      }
                      slotProps={{
                        input: {
                          "aria-label": `${NOTIFICATION_TYPE_LABELS[preference.type]} email notifications`,
                        },
                      }}
                    />
                  }
                />
              </Stack>
            </ListItem>
          );
        })}
      </List>
    </Stack>
  );
}
