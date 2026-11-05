"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  ListItem,
  ListItemText,
  MenuItem,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

const ENDPOINT = "/api/v1/recaps/settings";
const STALE_WEEK_OPTIONS = [2, 4, 6, 8, 12, 26, 52];

interface RecapSettingsPayload {
  weeklyRecapEmail: boolean;
  staleLinkWeeks: number;
}

/**
 * IMP-070: the weekly recap always arrives in the app; email is opt-in. A
 * link nobody opened for the chosen number of weeks is offered for archiving.
 */
export function WeeklyRecapSettings() {
  const [data, setData] = useState<RecapSettingsPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(ENDPOINT, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Recap settings request failed");
        setData((await response.json()) as RecapSettingsPayload);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const save = async (change: Partial<RecapSettingsPayload>) => {
    setSaving(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error("Save failed");
      setData((await response.json()) as RecapSettingsPayload);
    } catch {
      toast.error("Could not save the weekly recap setting.");
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        Failed to load the weekly recap settings.
      </Alert>
    );
  }
  if (!data) return <Skeleton variant="rounded" height={116} sx={{ mt: 2 }} />;

  const options = STALE_WEEK_OPTIONS.includes(data.staleLinkWeeks)
    ? STALE_WEEK_OPTIONS
    : [...STALE_WEEK_OPTIONS, data.staleLinkWeeks].sort((a, b) => a - b);

  return (
    <Stack spacing={1} sx={{ mt: 3 }}>
      <Typography variant="subtitle2">Weekly recap</Typography>
      <Typography variant="body2" color="text.secondary">
        Once a week you get a short recap in the app: what you saved, piles it
        could go in, and links you have not opened in a while.
      </Typography>
      <ListItem disablePadding sx={{ px: 1, gap: 2 }}>
        <ListItemText
          primary="Also send the recap by email"
          secondary="Off by default. The in-app recap always arrives."
        />
        <Switch
          checked={data.weeklyRecapEmail}
          disabled={saving}
          onChange={(event) =>
            void save({ weeklyRecapEmail: event.target.checked })
          }
          slotProps={{
            input: { "aria-label": "Send the weekly recap by email" },
          }}
        />
      </ListItem>
      <ListItem disablePadding sx={{ px: 1, gap: 2 }}>
        <ListItemText
          primary="Old links"
          secondary="Links not opened for this long are offered for archiving. Archived links keep their summary and wait in Trash until you restore them."
        />
        <TextField
          select
          size="small"
          value={data.staleLinkWeeks}
          disabled={saving}
          onChange={(event) =>
            void save({ staleLinkWeeks: Number(event.target.value) })
          }
          slotProps={{
            htmlInput: { "aria-label": "Weeks before a link counts as old" },
          }}
          sx={{ minWidth: 128, flexShrink: 0 }}
        >
          {options.map((weeks) => (
            <MenuItem key={weeks} value={weeks}>
              {weeks} weeks
            </MenuItem>
          ))}
        </TextField>
      </ListItem>
    </Stack>
  );
}
