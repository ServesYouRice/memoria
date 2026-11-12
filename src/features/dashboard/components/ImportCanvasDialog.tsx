"use client";

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { UploadFile } from "@mui/icons-material";
import { useQueryClient } from "@tanstack/react-query";
import { canvasKeys } from "@/lib/hooks/use-canvases";
import { describeCounts } from "@/lib/canvas-formats/describe";

export interface CanvasImportResult {
  canvasId: string;
  name: string;
  format: "json-canvas" | "excalidraw";
  itemCount: number;
  brought: Record<string, number>;
  leftOut: Record<string, number>;
}

/**
 * Open a `.canvas` (Obsidian) or `.excalidraw` file as a new canvas
 * (IMP-096), then show what came in and what was left out.
 */
export function ImportCanvasDialog({
  open,
  onClose,
  onOpenCanvas,
}: {
  open: boolean;
  onClose: () => void;
  onOpenCanvas: (canvasId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CanvasImportResult | null>(null);

  const close = () => {
    if (busy) return;
    setFile(null);
    setName("");
    setError(null);
    setResult(null);
    onClose();
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (name.trim()) form.append("name", name.trim());
      const response = await fetch("/api/v1/canvases/import", {
        method: "POST",
        body: form,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          (body && (body.detail || body.error)) ||
            "This file could not be opened.",
        );
        return;
      }
      setResult(body as CanvasImportResult);
      void queryClient.invalidateQueries({ queryKey: canvasKeys.all });
    } catch {
      setError("This file could not be sent. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>Open a canvas file</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2 }}>
        {result ? (
          <>
            <Alert severity="success">
              “{result.name}” is ready with {result.itemCount} item
              {result.itemCount === 1 ? "" : "s"}.
            </Alert>
            <Box>
              <Typography variant="subtitle2">Brought in</Typography>
              <Typography variant="body2">
                {describeCounts(result.brought) || "Nothing"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2">Left out</Typography>
              <Typography variant="body2">
                {describeCounts(result.leftOut) || "Nothing"}
              </Typography>
            </Box>
          </>
        ) : (
          <>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              A <strong>.canvas</strong> file from Obsidian or a{" "}
              <strong>.excalidraw</strong> drawing becomes a new canvas.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <Button
              component="label"
              variant="outlined"
              startIcon={<UploadFile />}
            >
              {file ? file.name : "Choose file"}
              <input
                hidden
                type="file"
                accept=".canvas,.excalidraw,.json,application/json"
                aria-label="Canvas file"
                onChange={(event) => {
                  const chosen = event.target.files?.[0] ?? null;
                  setFile(chosen);
                  setError(null);
                }}
              />
            </Button>
            <TextField
              label="Canvas name (optional)"
              value={name}
              onChange={(event) => setName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 255 } }}
              placeholder={file?.name.replace(/\.[^.]+$/, "") ?? ""}
            />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 1 }}>
        <Button onClick={close} disabled={busy}>
          {result ? "Close" : "Cancel"}
        </Button>
        {result ? (
          <Button
            variant="contained"
            onClick={() => onOpenCanvas(result.canvasId)}
          >
            Open canvas
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => void submit()}
            disabled={!file || busy}
          >
            {busy ? "Opening…" : "Open"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
