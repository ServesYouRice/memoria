"use client";

import React, { useState } from "react";
import NextLink from "next/link";
import {
  Alert,
  Button,
  Dialog,
  Link,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  morningIn,
  useCancelReminder,
  useItemReminder,
  useSetReminder,
} from "@/lib/hooks/use-reminders";

/** `YYYY-MM-DDTHH:mm` in local time, for a datetime-local input. */
function localInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatReminderTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * IMP-097 — "Remind me" on one item: tomorrow, next week, or a date. Shows
 * and cancels the reminder already set.
 */
export function ReminderDialog({
  itemId,
  onClose,
}: {
  itemId: string | null;
  onClose: () => void;
}) {
  // Mounted only while open, so a closed menu asks the server nothing.
  return itemId === null ? null : (
    <ReminderDialogBody key={itemId} itemId={itemId} onClose={onClose} />
  );
}

function ReminderDialogBody({
  itemId,
  onClose,
}: {
  itemId: string;
  onClose: () => void;
}) {
  const current = useItemReminder(itemId);
  const setReminder = useSetReminder();
  const cancelReminder = useCancelReminder();
  const [picked, setPicked] = useState(() => localInputValue(morningIn(1)));
  const [error, setError] = useState<string | null>(null);
  const busy = setReminder.isPending || cancelReminder.isPending;

  const close = () => {
    setError(null);
    onClose();
  };

  const remindAt = async (at: Date) => {
    setError(null);
    try {
      await setReminder.mutateAsync({ itemId, remindAt: at });
      close();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The reminder was not set.",
      );
    }
  };

  const cancel = async () => {
    setError(null);
    try {
      await cancelReminder.mutateAsync(itemId);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The reminder was not cancelled.",
      );
    }
  };

  const pickedDate = picked ? new Date(picked) : null;
  const pickedValid =
    pickedDate !== null && !Number.isNaN(pickedDate.getTime());

  return (
    <Dialog open onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>Remind me</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {current.data && (
          <Alert
            severity="info"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => void cancel()}
                disabled={busy}
              >
                Cancel reminder
              </Button>
            }
          >
            Set for {formatReminderTime(current.data.remindAt)}
          </Alert>
        )}
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={() => void remindAt(morningIn(1))}
            disabled={busy}
          >
            Tomorrow
          </Button>
          <Button
            variant="outlined"
            onClick={() => void remindAt(morningIn(7))}
            disabled={busy}
          >
            Next week
          </Button>
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Or pick a date. You get a notification; an email only if reminder
          emails are on in Settings.{" "}
          <Link component={NextLink} href="/reminders" onClick={close}>
            All reminders
          </Link>
        </Typography>
        <TextField
          label="Date and time"
          type="datetime-local"
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 1 }}>
        <Button onClick={close} disabled={busy}>
          Close
        </Button>
        <Button
          variant="contained"
          onClick={() => pickedValid && void remindAt(pickedDate)}
          disabled={busy || !pickedValid}
        >
          Remind me then
        </Button>
      </DialogActions>
    </Dialog>
  );
}
