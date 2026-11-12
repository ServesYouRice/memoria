"use client";

import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from "@mui/material";
import type { ArrowContent } from "@/types/canvas";

/** Same limit as the links API (IMP-095). */
export const ARROW_LABEL_MAX = 100;

type LineStyle = NonNullable<ArrowContent["lineStyle"]>;

/** Edit an arrow's short label and line pattern (IMP-095). */
export function ArrowLabelDialog({
  content,
  onClose,
  onSave,
}: {
  /** The arrow being edited, or null when closed. */
  content: ArrowContent | null;
  onClose: () => void;
  onSave: (next: ArrowContent) => void;
}) {
  const [label, setLabel] = useState("");
  const [lineStyle, setLineStyle] = useState<LineStyle>("SOLID");

  useEffect(() => {
    if (!content) return;
    setLabel(content.label ?? "");
    setLineStyle(content.lineStyle ?? "SOLID");
  }, [content]);

  const save = () => {
    if (!content) return;
    const next: ArrowContent = { ...content };
    const trimmed = label.trim().slice(0, ARROW_LABEL_MAX);
    if (trimmed) next.label = trimmed;
    else delete next.label;
    if (lineStyle === "SOLID") delete next.lineStyle;
    else next.lineStyle = lineStyle;
    onSave(next);
  };

  return (
    <Dialog open={Boolean(content)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Arrow</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2, pt: "8px !important" }}>
        <TextField
          autoFocus
          label="Label"
          placeholder="e.g. leads to"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          slotProps={{ htmlInput: { maxLength: ARROW_LABEL_MAX } }}
          helperText={`${label.length}/${ARROW_LABEL_MAX}`}
        />
        <TextField
          select
          label="Line"
          value={lineStyle}
          onChange={(event) => setLineStyle(event.target.value as LineStyle)}
        >
          <MenuItem value="SOLID">Solid</MenuItem>
          <MenuItem value="DASHED">Dashed</MenuItem>
          <MenuItem value="DOTTED">Dotted</MenuItem>
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
