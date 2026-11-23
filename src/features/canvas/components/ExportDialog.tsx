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
  Chip,
  CircularProgress,
  Alert,
  alpha,
} from "@mui/material";
import {
  AccountTree,
  Download,
  Description,
  Code,
  PictureAsPdf,
} from "@mui/icons-material";
import { motion } from "@/lib/theme";
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

const FORMAT_OPTIONS: {
  value: ExportFormat;
  label: string;
  hint: string;
  ext: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "png",
    label: "PNG Image",
    hint: "Crisp high-resolution picture of your canvas",
    ext: ".png",
    icon: <Download fontSize="small" />,
  },
  {
    value: "pdf",
    label: "PDF Document",
    hint: "Print-ready page snapshot to share or archive",
    ext: ".pdf",
    icon: <PictureAsPdf fontSize="small" />,
  },
  {
    value: "markdown",
    label: "Markdown (Notes & Links)",
    hint: "Plain text outline of notes and saved links",
    ext: ".md",
    icon: <Description fontSize="small" />,
  },
  {
    value: "canvas",
    label: "JSON Canvas (.canvas, Obsidian)",
    hint: "Open spatial standard for Obsidian and other tools",
    ext: ".canvas",
    icon: <AccountTree fontSize="small" />,
  },
  {
    value: "json",
    label: "JSON (Backup)",
    hint: "Full lossless backup you can re-import anytime",
    ext: ".json",
    icon: <Code fontSize="small" />,
  },
];

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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>Export canvas</DialogTitle>
      <DialogContent>
        {exportError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {exportError}
          </Alert>
        )}
        <FormControl component="fieldset" fullWidth sx={{ mt: 0.5 }}>
          <FormLabel component="legend" sx={{ mb: 1.5, fontSize: "0.85rem" }}>
            Choose format
          </FormLabel>
          <RadioGroup
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            sx={{ display: "flex", flexDirection: "column", gap: 1 }}
          >
            {FORMAT_OPTIONS.map((option) => {
              const active = format === option.value;
              return (
                <FormControlLabel
                  key={option.value}
                  value={option.value}
                  control={<Radio size="small" sx={{ mr: 0.5 }} />}
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 1.25,
                    borderRadius: 2.5,
                    border: "1.5px solid",
                    borderColor: active ? "primary.main" : "divider",
                    bgcolor: (theme) =>
                      active
                        ? alpha(theme.palette.primary.main, 0.06)
                        : "background.paper",
                    transition: `border-color 150ms ${motion.easeOut}, background-color 150ms ${motion.easeOut}, transform 150ms ${motion.easeOut}`,
                    "&:hover": {
                      borderColor: active ? "primary.main" : "text.secondary",
                    },
                    "& .MuiFormControlLabel-label": { flex: 1, minWidth: 0 },
                  }}
                  label={
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        width: "100%",
                      }}
                    >
                      <Box
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: 2,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: active ? "primary.main" : "text.secondary",
                          bgcolor: (theme) =>
                            active
                              ? alpha(theme.palette.primary.main, 0.12)
                              : "action.hover",
                        }}
                      >
                        {option.icon}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="subtitle2"
                          sx={{ fontWeight: 600 }}
                        >
                          {option.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: "text.secondary", display: "block" }}
                        >
                          {option.hint}
                        </Typography>
                      </Box>
                      <Chip
                        label={option.ext}
                        size="small"
                        variant={active ? "filled" : "outlined"}
                        color={active ? "primary" : "default"}
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.7rem",
                          height: 22,
                        }}
                      />
                    </Box>
                  }
                />
              );
            })}
          </RadioGroup>
        </FormControl>
        {format === "canvas" && (
          <Alert severity={canvasLeftOut ? "info" : "success"} sx={{ mt: 2 }}>
            {canvasLeftOut
              ? `Notes, text, links, frames and arrows between items are kept. The format cannot hold: ${canvasLeftOut}.`
              : "Everything on this canvas fits in the file."}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
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
