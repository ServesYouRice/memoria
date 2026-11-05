"use client";

import React, { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    if (!link || !shareId || started.current) return;
    started.current = true;
    // The share id is the idempotency key, so a repeat (strict mode, reload)
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
  }, [link, shareId]);

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
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress aria-label="Saving to Inbox" />
      </Box>
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
