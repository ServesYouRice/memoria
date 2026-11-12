import React, { useContext, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Typography,
  Box,
  CircularProgress,
  Alert,
} from "@mui/material";
import {
  AccountTree,
  Download,
  Description,
  Code,
  PictureAsPdf,
} from "@mui/icons-material";
import { type CanvasItem } from "@/types/canvas";
import {
  BoardExportCaptureContext,
  EXPORT_EXCLUDE_NAME,
  captureStageRegion,
  computeItemsBounds,
  exportToJSON,
  exportToMarkdown,
  exportToPDF,
  fetchAllCanvasItems,
} from "@/lib/export/export-utils";
import { toJsonCanvas } from "@/lib/canvas-formats/json-canvas";
import { describeCounts } from "@/lib/canvas-formats/describe";

const EXPORT_PADDING = 40;

export type ExportFormat = "json" | "markdown" | "pdf" | "png" | "canvas";

export interface ExportOptions {
  includeBackground: boolean;
  scale: number;
}

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  canvasName: string;
  items: CanvasItem[];
  stageRef: any; // Konva Stage Ref
}

export function ExportDialog({
  open,
  onClose,
  canvasId,
  canvasName,
  items,
  stageRef,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const boardCapture = useContext(BoardExportCaptureContext);
  // What JSON Canvas cannot hold, shown before the download (IMP-096).
  const canvasLeftOut = React.useMemo(
    () =>
      format === "canvas" ? describeCounts(toJsonCanvas(items).leftOut) : "",
    [format, items],
  );

  /** PNG data URL of the whole board; null without a stage to capture. */
  const captureBoard = async (): Promise<string | null> => {
    const stage = stageRef.current;
    if (!stage) return null;
    const session = boardCapture.current
      ? await boardCapture.current.prepare()
      : { items, restore: () => undefined };
    try {
      const bounds = computeItemsBounds(session.items, EXPORT_PADDING);
      if (!bounds) throw new Error("The canvas has no items to export");
      return captureStageRegion(stage, bounds, {
        pixelRatio: 2,
        exclude: EXPORT_EXCLUDE_NAME,
      });
    } finally {
      session.restore();
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const filename = canvasName.replace(/[^a-z0-9]/gi, "_").toLowerCase();

      if (format === "json") {
        // The board's items are a viewport working set; files hold the
        // whole canvas.
        const allItems = await fetchAllCanvasItems(canvasId, items);
        const json = await exportToJSON(canvasId, canvasName, allItems);
        downloadFile(json, `${filename}.json`, "application/json");
      } else if (format === "canvas") {
        const allItems = await fetchAllCanvasItems(canvasId, items);
        const { file } = toJsonCanvas(allItems);
        downloadFile(
          JSON.stringify(file, null, 2),
          `${filename}.canvas`,
          "application/json",
        );
      } else if (format === "markdown") {
        const allItems = await fetchAllCanvasItems(canvasId, items);
        const md = await exportToMarkdown(canvasId, canvasName, allItems);
        downloadFile(md, `${filename}.md`, "text/markdown");
      } else if (format === "pdf") {
        const dataUrl = await captureBoard();
        if (dataUrl) await exportToPDF(filename, dataUrl);
      } else if (format === "png") {
        const dataUrl = await captureBoard();
        if (dataUrl) {
          const link = document.createElement("a");
          link.download = `${filename}.png`;
          link.href = dataUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }

      onClose();
    } catch (error) {
      console.error("Export failed:", error);
      setExportError(
        error instanceof Error && error.message
          ? `Export failed: ${error.message}`
          : "Export failed. Nothing was downloaded.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Export Canvas</DialogTitle>
      <DialogContent>
        {exportError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {exportError}
          </Alert>
        )}
        <FormControl component="fieldset" fullWidth sx={{ mt: 1 }}>
          <FormLabel component="legend">Choose Format</FormLabel>
          <RadioGroup
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <FormControlLabel
              value="png"
              control={<Radio />}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Download fontSize="small" />
                  <Typography>PNG Image</Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="pdf"
              control={<Radio />}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <PictureAsPdf fontSize="small" />
                  <Typography>PDF Document</Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="markdown"
              control={<Radio />}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Description fontSize="small" />
                  <Typography>Markdown (Notes & Links)</Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="canvas"
              control={<Radio />}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <AccountTree fontSize="small" />
                  <Typography>JSON Canvas (.canvas, Obsidian)</Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="json"
              control={<Radio />}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Code fontSize="small" />
                  <Typography>JSON (Backup)</Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>
        {format === "canvas" && (
          <Alert severity={canvasLeftOut ? "info" : "success"} sx={{ mt: 1 }}>
            {canvasLeftOut
              ? `Notes, text, links, frames and arrows between items are kept. The format cannot hold: ${canvasLeftOut}.`
              : "Everything on this canvas fits in the file."}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isExporting}>
          Cancel
        </Button>
        <Button
          onClick={handleExport}
          variant="contained"
          disabled={isExporting}
          startIcon={
            isExporting ? <CircularProgress size={20} /> : <Download />
          }
        >
          {isExporting ? "Exporting..." : "Export"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
