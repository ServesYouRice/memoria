"use client";

import React, { useState } from "react";
import NextLink from "next/link";
import {
  Alert,
  Button,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Skeleton,
  Stack,
} from "@mui/material";
import { NotificationsActiveOutlined as ReminderIcon } from "@mui/icons-material";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import {
  useCancelReminder,
  useUpcomingReminders,
} from "@/lib/hooks/use-reminders";
import {
  ReminderDialog,
  formatReminderTime,
} from "@/features/canvas/components/ReminderDialog";

/** IMP-097 — upcoming reminders, with change and cancel. */
export function RemindersContent() {
  const reminders = useUpcomingReminders();
  const cancel = useCancelReminder();
  const [changing, setChanging] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Reminders"
        subtitle="Items you asked to see again, soonest first"
      />
      {reminders.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Reminders could not be loaded. Please try again.
        </Alert>
      )}
      {cancel.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          The reminder was not cancelled. Please try again.
        </Alert>
      )}
      {reminders.isLoading ? (
        <Skeleton variant="rounded" height={160} />
      ) : reminders.data && reminders.data.length > 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <List>
            {reminders.data.map((reminder) => (
              <ListItem
                key={reminder.id}
                divider
                secondaryAction={
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      onClick={() => setChanging(reminder.itemId)}
                    >
                      Change
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(reminder.itemId)}
                    >
                      Cancel
                    </Button>
                  </Stack>
                }
                sx={{ pr: 22 }}
              >
                <ListItemText
                  primary={
                    <Link component={NextLink} href={reminder.url}>
                      {reminder.title}
                    </Link>
                  }
                  secondary={`${formatReminderTime(reminder.remindAt)} · ${reminder.canvasName}`}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      ) : (
        <EmptyState
          icon={ReminderIcon}
          title="No reminders"
          description='Right-click an item on a canvas and choose "Remind me…" to see it again on a day you pick.'
        />
      )}
      <ReminderDialog itemId={changing} onClose={() => setChanging(null)} />
    </>
  );
}
