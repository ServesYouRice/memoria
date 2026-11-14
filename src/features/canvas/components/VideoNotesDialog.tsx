"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  List,
  ListItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import { ApiError, apiFetch } from "@/lib/api/fetch-client";
import { formatVideoTime, parseVideoTime } from "@/lib/video/video-link";

export interface VideoNote {
  id: string;
  seconds: number;
  text: string;
  /** Opens the video at this moment, in a new tab. */
  openUrl: string;
  mine: boolean;
  createdAt: string;
}

export interface VideoCardResponse {
  video: {
    url: string;
    provider: string;
    source: string;
    host: string;
    title: string | null;
  };
  notes: VideoNote[];
  transcript: {
    text: string;
    source: "pasted" | "fetched";
    language: string | null;
    updatedAt: string;
  } | null;
  canEdit: boolean;
  autoFetch: { enabled: boolean; pending: boolean };
  limits: { maxNoteChars: number; maxTranscriptBytes: number };
}

/** Shown wherever automatic caption reading is on (DEC-018). */
export const TRANSCRIPT_FETCH_NOTICE =
  "This server reads YouTube captions automatically. That is unofficial and can stop working at any time; pasting a transcript always works.";

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

function transcriptDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" });
}

/**
 * Video notes and transcript (IMP-114). Notes keep a moment of the video;
 * choosing the moment opens the video there in a new tab. Nothing from the
 * video's site is loaded here (DEC-011). The transcript and notes are shown
 * as plain text only.
 */
export function VideoNotesDialog({
  itemId,
  onClose,
}: {
  itemId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<VideoCardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState("");
  const [noteText, setNoteText] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  const endpoint = itemId
    ? `/api/v1/canvas-items/${encodeURIComponent(itemId)}/video`
    : null;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!endpoint) return;
      try {
        const response = await fetch(endpoint, { signal });
        if (!response.ok) throw new Error("Video request failed");
        setData((await response.json()) as VideoCardResponse);
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") setFailed(true);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    if (!endpoint) return;
    setData(null);
    setFailed(false);
    setError(null);
    setTime("");
    setNoteText("");
    setPasting(false);
    setPasted("");
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [endpoint, load]);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (actionError) {
      setError(messageOf(actionError, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const seconds = parseVideoTime(time);
  const timeInvalid = time.trim() !== "" && seconds === null;

  const addNote = async () => {
    if (seconds === null || !noteText.trim() || !endpoint) return;
    const ok = await run(
      () =>
        apiFetch(`${endpoint}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds, text: noteText }),
        }),
      "Could not add the note.",
    );
    if (ok) {
      setTime("");
      setNoteText("");
    }
  };

  const deleteNote = (noteId: string) =>
    run(
      () =>
        apiFetch(`${endpoint}/notes/${encodeURIComponent(noteId)}`, {
          method: "DELETE",
        }),
      "Could not delete the note.",
    );

  const saveTranscript = async () => {
    if (!pasted.trim() || !endpoint) return;
    const ok = await run(
      () =>
        apiFetch(`${endpoint}/transcript`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: pasted }),
        }),
      "Could not save the transcript.",
    );
    if (ok) {
      setPasting(false);
      setPasted("");
    }
  };

  const clearTranscript = () =>
    run(
      () => apiFetch(`${endpoint}/transcript`, { method: "DELETE" }),
      "Could not clear the transcript.",
    );

  const transcript = data?.transcript;
  return (
    <Dialog
      open={Boolean(itemId)}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="video-notes-title"
    >
      <DialogTitle id="video-notes-title">Video notes</DialogTitle>
      <DialogContent dividers>
        {failed && <Alert severity="error">Could not load this video.</Alert>}
        {!failed && !data && <Skeleton variant="rounded" height={160} />}
        {data && (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1" sx={{ overflowWrap: "anywhere" }}>
                {data.video.title ?? `${data.video.source} video`}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                From {data.video.source} · {data.video.host} ·{" "}
                <Link
                  href={data.video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open video
                </Link>
              </Typography>
            </Box>
            {error && <Alert severity="error">{error}</Alert>}

            <Box>
              <Typography variant="subtitle2" component="h3">
                Notes
              </Typography>
              {data.notes.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No notes yet.
                </Typography>
              ) : (
                <List dense disablePadding aria-label="Notes at moments">
                  {data.notes.map((note) => (
                    <ListItem
                      key={note.id}
                      disableGutters
                      secondaryAction={
                        data.canEdit ? (
                          <IconButton
                            edge="end"
                            aria-label={`Delete note at ${formatVideoTime(note.seconds)}`}
                            onClick={() => void deleteNote(note.id)}
                            disabled={busy}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        ) : undefined
                      }
                    >
                      <Box sx={{ display: "flex", gap: 1.5, pr: 5 }}>
                        <Link
                          href={note.openUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open the video at ${formatVideoTime(note.seconds)}`}
                          sx={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {formatVideoTime(note.seconds)}
                        </Link>
                        <Typography
                          variant="body2"
                          sx={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {note.text}
                        </Typography>
                      </Box>
                    </ListItem>
                  ))}
                </List>
              )}
              {data.canEdit && (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ mt: 1, alignItems: { sm: "flex-start" } }}
                >
                  <TextField
                    label="Time"
                    placeholder="1:05"
                    size="small"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                    error={timeInvalid}
                    helperText={timeInvalid ? "Use 1:05 or 1:02:03" : " "}
                    sx={{ width: { sm: 120 } }}
                  />
                  <TextField
                    label="Note"
                    size="small"
                    multiline
                    maxRows={4}
                    fullWidth
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    slotProps={{
                      htmlInput: { maxLength: data.limits.maxNoteChars },
                    }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => void addNote()}
                    disabled={busy || seconds === null || !noteText.trim()}
                    sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    Add note at a time
                  </Button>
                </Stack>
              )}
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" component="h3">
                Transcript
              </Typography>
              {data.autoFetch.enabled && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="p"
                >
                  {TRANSCRIPT_FETCH_NOTICE}
                </Typography>
              )}
              {transcript ? (
                <>
                  <Typography variant="body2" color="text.secondary">
                    {transcript.source === "fetched"
                      ? "Read from the video's captions"
                      : "Pasted"}{" "}
                    on {transcriptDate(transcript.updatedAt)}.
                  </Typography>
                  <Typography
                    component="div"
                    variant="body2"
                    data-testid="video-transcript-text"
                    sx={{
                      mt: 1,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      maxHeight: "40vh",
                      overflowY: "auto",
                    }}
                  >
                    {transcript.text}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {data.autoFetch.pending
                    ? "Reading the video's captions. Open this again in a minute."
                    : "No transcript yet."}
                </Typography>
              )}
              {data.canEdit && !pasting && (
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button onClick={() => setPasting(true)} disabled={busy}>
                    {transcript ? "Replace transcript" : "Paste transcript"}
                  </Button>
                  {transcript && (
                    <Button
                      color="error"
                      onClick={() => void clearTranscript()}
                      disabled={busy}
                    >
                      Clear transcript
                    </Button>
                  )}
                </Stack>
              )}
              {data.canEdit && pasting && (
                <Box sx={{ mt: 1 }}>
                  <TextField
                    label="Transcript"
                    multiline
                    minRows={6}
                    maxRows={14}
                    fullWidth
                    value={pasted}
                    onChange={(event) => setPasted(event.target.value)}
                    helperText={`Plain text, up to ${Math.floor(
                      data.limits.maxTranscriptBytes / 1024,
                    )} KB.`}
                  />
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Button
                      variant="contained"
                      onClick={() => void saveTranscript()}
                      disabled={busy || !pasted.trim()}
                    >
                      Save transcript
                    </Button>
                    <Button onClick={() => setPasting(false)} disabled={busy}>
                      Cancel
                    </Button>
                  </Stack>
                </Box>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
