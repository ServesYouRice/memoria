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

const ENDPOINT = "/api/v1/ai/link-enrichment";

interface LinkEnrichmentPayload {
  autoEnrichLinks: boolean;
  aiConfigured: boolean;
}

/** Settings switch for naming, tagging and summarizing saved links. */
export function LinkEnrichmentSettings() {
  const [data, setData] = useState<LinkEnrichmentPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(ENDPOINT, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Link enrichment request failed");
        setData((await response.json()) as LinkEnrichmentPayload);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const toggle = async (autoEnrichLinks: boolean) => {
    setSaving(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoEnrichLinks }),
      });
      if (!response.ok) throw new Error("Save failed");
      setData((await response.json()) as LinkEnrichmentPayload);
    } catch {
      toast.error("Could not save the link setting.");
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return <Alert severity="error">Failed to load the link setting.</Alert>;
  }
  if (!data) return <Skeleton variant="rounded" height={58} />;

  return (
    <Stack spacing={1} sx={{ mt: 2 }}>
      <ListItem disablePadding sx={{ px: 1, gap: 2 }}>
        <ListItemText
          primary="Name, tag and explain saved links"
          secondary={
            data.aiConfigured
              ? "Links you save from the extension, your phone or an agent get a clear title, a few tags and a two-line summary."
              : "Links you save get the page's own title and description. Add an AI provider above for tags and a summary too."
          }
        />
        <Switch
          checked={data.autoEnrichLinks}
          disabled={saving}
          onChange={(event) => void toggle(event.target.checked)}
          slotProps={{
            input: { "aria-label": "Name, tag and explain saved links" },
          }}
        />
      </ListItem>
    </Stack>
  );
}
