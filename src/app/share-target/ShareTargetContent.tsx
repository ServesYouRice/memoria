"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiFetch } from "@/lib/api/fetch-client";
import { PageHeader } from "@/components/layout/PageHeader";
import { CLIP_BATCH_NOTE_MAX_LENGTH } from "@/lib/validation/extension";
import type { SharedLink } from "./shared-link";

const SAVE_ENDPOINT = "/share-target/save";

interface SaveResult {
  batchId: string;
  canvasId: string;
  replayed: boolean;
}

async function problemDetail(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function ShareTargetContent({
  link,
  shareId,
  sharedText,
}: {
  link: SharedLink | null;
  shareId: string | null;
  sharedText: string | null;
}) {
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const started = useRef(false);
  const [saving, setSaving] = useState(false);

  // Runs only from the Save button: this page opens from a plain GET that
  // any site can link to, so arriving here must not save anything by itself.
  const save = () => {
    if (!link || !shareId || started.current) return;
    started.current = true;
    setSaving(true);
    // The share id is the idempotency key, so a repeat (after a reload)
    // replays the first save.
    apiFetch(SAVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId, url: link.url, title: link.title }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await problemDetail(response, "The link could not be saved."),
          );
        }
        setSaved((await response.json()) as SaveResult);
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "The link could not be saved.",
        );
      });
  };

  const saveNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!saved || noteState === "saving") return;
    setNoteState("saving");
    try {
      const response = await apiFetch(SAVE_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: saved.batchId, note }),
      });
      setNoteState(response.ok ? "saved" : "error");
    } catch {
      setNoteState("error");
    }
  };

  if (!link) {
    return (
      <>
        <PageHeader title="Nothing to save" />
        <Alert severity="info" sx={{ mb: 3 }}>
          Memoria saves shared links. This share did not include a link
          {sharedText ? `: “${sharedText.slice(0, 200)}”` : "."}
        </Alert>
        <Button component={Link} href="/dashboard" variant="contained">
          Go to dashboard
        </Button>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Not saved" />
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Typography color="text.secondary" sx={{ wordBreak: "break-all" }}>
          {link.url}
        </Typography>
      </>
    );
  }

  if (!saved) {
    return (
      <>
        <PageHeader title="Save this link?" />
        <Paper
          variant="outlined"
          sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: 3 }}
        >
          <Stack spacing={2.5}>
            <Typography color="text.secondary" variant="body2">
              This link was shared to Memoria from another app or site. Nothing
              is saved until you choose to.
            </Typography>
            <Box>
              <Typography variant="h6" sx={{ wordBreak: "break-all" }}>
                {hostnameOf(link.url)}
              </Typography>
              {link.title ? (
                <Typography sx={{ fontWeight: 600 }}>{link.title}</Typography>
              ) : null}
              <Typography
                color="text.secondary"
                variant="body2"
                sx={{ wordBreak: "break-all" }}
              >
                {link.url}
              </Typography>
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button
                variant="contained"
                onClick={save}
                disabled={saving || !shareId}
                startIcon={
                  saving ? (
                    <CircularProgress size={16} color="inherit" aria-hidden />
                  ) : undefined
                }
              >
                Save to Inbox
              </Button>
              <Button component={Link} href="/dashboard" variant="outlined">
                Cancel
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Saved" subtitle="The link is in your Inbox." />
      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: 3 }}>
        <Stack spacing={2.5}>
          <Box>
            {link.title ? (
              <Typography sx={{ fontWeight: 600 }}>{link.title}</Typography>
            ) : null}
            <Typography
              color="text.secondary"
              variant="body2"
              sx={{ wordBreak: "break-all" }}
            >
              {link.url}
            </Typography>
          </Box>
          <Box component="form" onSubmit={(event) => void saveNote(event)}>
            <Stack spacing={1.5}>
              <TextField
                label="How should this be sorted? (optional)"
                placeholder="e.g. trip ideas for Lisbon"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  if (noteState !== "saving") setNoteState("idle");
                }}
                multiline
                minRows={2}
                slotProps={{
                  htmlInput: { maxLength: CLIP_BATCH_NOTE_MAX_LENGTH },
                }}
              />
              {noteState === "saved" ? (
                <Alert severity="success">Note saved.</Alert>
              ) : noteState === "error" ? (
                <Alert severity="error">The note could not be saved.</Alert>
              ) : null}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!note.trim() || noteState === "saving"}
                >
                  {noteState === "saving" ? "Saving note…" : "Save note"}
                </Button>
                <Button
                  component={Link}
                  href={`/canvas/${saved.canvasId}`}
                  variant="outlined"
                >
                  Open Inbox
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </>
  );
}
