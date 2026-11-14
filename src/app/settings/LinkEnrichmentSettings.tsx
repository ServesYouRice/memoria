"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  Box,
  Button,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import {
  TAGGING_RULES_EXAMPLE,
  TAGGING_RULES_MAX_CHARS,
} from "@/lib/ai/tagging-rules";

const ENDPOINT = "/api/v1/ai/link-enrichment";

interface LinkEnrichmentPayload {
  autoEnrichLinks: boolean;
  aiConfigured: boolean;
  webArchiveAvailable?: boolean;
  webArchiveLookup?: boolean;
  taggingRules?: string;
}

type LinkSettingsChange = Partial<
  Pick<
    LinkEnrichmentPayload,
    "autoEnrichLinks" | "webArchiveLookup" | "taggingRules"
  >
>;

/** Settings switch for naming, tagging and summarizing saved links. */
export function LinkEnrichmentSettings() {
  const [data, setData] = useState<LinkEnrichmentPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(ENDPOINT, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Link enrichment request failed");
        const payload = (await response.json()) as LinkEnrichmentPayload;
        setData(payload);
        setRules(payload.taggingRules ?? "");
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const toggle = async (change: LinkSettingsChange) => {
    setSaving(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error("Save failed");
      const payload = (await response.json()) as LinkEnrichmentPayload;
      setData(payload);
      if (change.taggingRules !== undefined) {
        setRules(payload.taggingRules ?? "");
        toast.success(
          payload.taggingRules
            ? "Your tagging rules are saved."
            : "Tagging is back to the standard rules.",
        );
      }
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
            (data.aiConfigured
              ? "Links you save from the extension, your phone or an agent get a clear title, a few tags and a two-line summary."
              : "Links you save get the page's own title and description. Add an AI provider above for tags and a summary too.") +
            " Memoria also keeps a copy of each page's text, so you can still read and search it if the site changes."
          }
        />
        <Switch
          checked={data.autoEnrichLinks}
          disabled={saving}
          onChange={(event) =>
            void toggle({ autoEnrichLinks: event.target.checked })
          }
          slotProps={{
            input: { "aria-label": "Name, tag and explain saved links" },
          }}
        />
      </ListItem>
      {data.webArchiveAvailable && (
        <ListItem disablePadding sx={{ px: 1, gap: 2 }}>
          <ListItemText
            primary="Find web-archive copies of saved links"
            secondary="Asks the Internet Archive (archive.org) whether it has a copy of each link you save, so you can open it if the site goes away. This sends the link's address to archive.org."
          />
          <Switch
            checked={Boolean(data.webArchiveLookup)}
            disabled={saving || !data.autoEnrichLinks}
            onChange={(event) =>
              void toggle({ webArchiveLookup: event.target.checked })
            }
            slotProps={{
              input: { "aria-label": "Find web-archive copies of saved links" },
            }}
          />
        </ListItem>
      )}
      <Box sx={{ px: 1, pt: 1 }}>
        <TextField
          label="How should things be tagged?"
          placeholder={`For example: ${TAGGING_RULES_EXAMPLE}`}
          helperText={`In your own words. New automatic tags follow these rules; tags you set yourself are never replaced. Leave it empty for the standard tags. ${rules.length}/${TAGGING_RULES_MAX_CHARS}`}
          value={rules}
          onChange={(event) =>
            setRules(event.target.value.slice(0, TAGGING_RULES_MAX_CHARS))
          }
          slotProps={{ htmlInput: { maxLength: TAGGING_RULES_MAX_CHARS } }}
          multiline
          minRows={2}
          fullWidth
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
          <Button
            variant="outlined"
            disabled={saving || rules === (data.taggingRules ?? "")}
            onClick={() => void toggle({ taggingRules: rules })}
          >
            Save tagging rules
          </Button>
        </Box>
      </Box>
    </Stack>
  );
}
