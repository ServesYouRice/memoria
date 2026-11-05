"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  Switch,
} from "@mui/material";

const ENDPOINT = "/api/v1/ai/auto-file";

interface AutoFilePayload {
  autoFileItems: boolean;
  confidenceThreshold: number;
}

/** Settings switch for filing confident Inbox suggestions automatically (IMP-066). */
export function AutoFileSettings() {
  const [data, setData] = useState<AutoFilePayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(ENDPOINT, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Auto-file request failed");
        setData((await response.json()) as AutoFilePayload);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const toggle = async (autoFileItems: boolean) => {
    setSaving(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoFileItems }),
      });
      if (!response.ok) throw new Error("Save failed");
      setData((await response.json()) as AutoFilePayload);
    } catch {
      toast.error("Could not save the filing setting.");
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return <Alert severity="error">Failed to load the filing setting.</Alert>;
  }
  if (!data) return <Skeleton variant="rounded" height={58} />;

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <ListItem disablePadding sx={{ px: 1, gap: 2 }}>
        <ListItemText
          primary="File new Inbox items automatically"
          secondary={`When an item's suggested board is a clear match (${Math.round(
            data.confidenceThreshold * 100,
          )}% or more), it moves there on its own. Other suggestions wait for you, and every move can be undone from the Inbox.`}
        />
        <Switch
          checked={data.autoFileItems}
          disabled={saving}
          onChange={(event) => void toggle(event.target.checked)}
          slotProps={{
            input: { "aria-label": "File new Inbox items automatically" },
          }}
        />
      </ListItem>
    </Stack>
  );
}
