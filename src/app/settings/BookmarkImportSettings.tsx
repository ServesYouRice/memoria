"use client";

/**
 * IMP-091: bring saved links from a browser, Pocket or Raindrop. Choose a
 * file, see what is in it, choose where the links go, then follow the
 * import while it runs in the background.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import { UploadFile as UploadFileIcon } from "@mui/icons-material";
import { DisabledReason } from "@/components/DisabledReason";

interface Preview {
  fileName: string;
  format: "html" | "csv";
  links: number;
  folders: string[];
  duplicates: number;
  invalid: number;
}

export interface ImportStatus {
  id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  fileName: string;
  total: number;
  processed: number;
  imported: number;
  duplicates: number;
  overLimit: number;
  invalid: number;
  failed: number;
  error: string | null;
}

const ACCEPT = ".html,.htm,.csv,text/html,text/csv";
const POLL_MS = 1_500;

async function problem(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || fallback;
  } catch {
    return fallback;
  }
}

const count = (n: number) => n.toLocaleString();

function isRunning(status: ImportStatus | null) {
  return status?.status === "QUEUED" || status?.status === "RUNNING";
}

/** The plain-language result of an import. */
export function ImportResult({ status }: { status: ImportStatus }) {
  const done = status.status === "COMPLETED";
  const lines = [
    `${count(status.imported)} imported`,
    `${count(status.duplicates)} already saved, skipped`,
    status.overLimit > 0 &&
      `${count(status.overLimit)} did not fit (a canvas holds at most 2,000 items, and you can have up to 200 canvases)`,
    status.invalid + status.failed > 0 &&
      `${count(status.invalid + status.failed)} could not be read`,
  ].filter(Boolean) as string[];
  return (
    <Alert
      severity={
        status.status === "FAILED"
          ? "error"
          : status.overLimit > 0
            ? "warning"
            : "success"
      }
      role="status"
    >
      <Typography sx={{ fontWeight: 600 }}>
        {status.status === "FAILED"
          ? `Import of ${status.fileName} stopped`
          : done
            ? `Import of ${status.fileName} finished`
            : `Importing ${status.fileName}`}
      </Typography>
      {status.error && <Typography>{status.error}</Typography>}
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </Box>
    </Alert>
  );
}

export function BookmarkImportSettings() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState<"INBOX" | "FOLDERS">("INBOX");
  const [enrich, setEnrich] = useState(false);
  const [status, setStatus] = useState<ImportStatus | null>(null);

  // Show an import that is still running, e.g. after a reload.
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/imports", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { imports: ImportStatus[] };
        const latest = body.imports[0];
        if (latest) setStatus(latest);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const statusId = status?.id;
  const running = isRunning(status);
  useEffect(() => {
    if (!statusId || !running) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void fetch(`/api/v1/imports/${statusId}`, { signal: controller.signal })
        .then(async (response) => {
          if (response.ok) setStatus((await response.json()) as ImportStatus);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [statusId, running]);

  const choose = async (chosen: File | undefined) => {
    if (!chosen) return;
    setFile(chosen);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", chosen);
      const response = await fetch("/api/v1/imports/preview", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        throw new Error(await problem(response, "Could not read this file."));
      }
      const read = (await response.json()) as Preview;
      setPreview(read);
      if (read.folders.length === 0) setDestination("INBOX");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const start = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("destination", destination);
      form.append("enrich", String(enrich));
      const response = await fetch("/api/v1/imports", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        throw new Error(await problem(response, "Could not start the import."));
      }
      setStatus((await response.json()) as ImportStatus);
      setFile(null);
      setPreview(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const newLinks = preview ? preview.links - preview.duplicates : 0;
  const startBlocked = !preview || newLinks <= 0 || running;

  return (
    <Stack spacing={2.5}>
      <Typography color="text.secondary">
        Use the bookmarks file your browser exports (Chrome, Firefox, Safari and
        Edge all make one), or the CSV or HTML file from Pocket or Raindrop.
      </Typography>

      {status && (
        <Stack spacing={1}>
          {running && (
            <LinearProgress
              variant={status.total > 0 ? "determinate" : "indeterminate"}
              value={
                status.total > 0 ? (status.processed / status.total) * 100 : 0
              }
              aria-label="Import progress"
            />
          )}
          <ImportResult status={status} />
        </Stack>
      )}

      <Box>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          aria-label="Bookmark file"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <Button
          variant="outlined"
          startIcon={<UploadFileIcon />}
          disabled={busy || running}
          onClick={() => inputRef.current?.click()}
        >
          {file ? "Choose a different file" : "Choose a file"}
        </Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      {preview && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Box>
              <Typography sx={{ fontWeight: 600 }}>
                {preview.fileName}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                <li>{count(preview.links)} links</li>
                <li>
                  {count(preview.folders.length)} top-level folder
                  {preview.folders.length === 1 ? "" : "s"}
                </li>
                <li>
                  {count(preview.duplicates)} already saved (will be skipped)
                </li>
                {preview.invalid > 0 && (
                  <li>
                    {preview.invalid === 1
                      ? "1 entry is not a web link and will be left out"
                      : `${count(preview.invalid)} entries are not web links and will be left out`}
                  </li>
                )}
              </Box>
            </Box>

            <Box>
              <Typography id="import-destination" sx={{ fontWeight: 600 }}>
                Where should the links go?
              </Typography>
              <RadioGroup
                aria-labelledby="import-destination"
                value={destination}
                onChange={(event) =>
                  setDestination(event.target.value as "INBOX" | "FOLDERS")
                }
              >
                <FormControlLabel
                  value="INBOX"
                  control={<Radio />}
                  label="All into my Inbox"
                />
                <FormControlLabel
                  value="FOLDERS"
                  control={<Radio />}
                  disabled={preview.folders.length === 0}
                  label="One canvas for each top-level folder"
                />
              </RadioGroup>
              <Typography variant="body2" color="text.secondary">
                Folder names and tags from the file become tags.
              </Typography>
            </Box>

            <FormControlLabel
              control={
                <Checkbox
                  checked={enrich}
                  onChange={(event) => setEnrich(event.target.checked)}
                />
              }
              label="Let AI name, tag and summarise these links (uses your AI allowance)"
            />

            <Box>
              <Button
                variant="contained"
                disabled={startBlocked || busy}
                aria-describedby="import-start-reason"
                onClick={() => void start()}
              >
                Import {count(Math.max(newLinks, 0))} links
              </Button>
              <DisabledReason id="import-start-reason" show={startBlocked}>
                {running
                  ? "Wait for the current import to finish."
                  : "Every link in this file is already saved."}
              </DisabledReason>
            </Box>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
