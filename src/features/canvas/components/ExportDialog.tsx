import React, { useState } from 'react';
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
  CircularProgress
} from '@mui/material';
import { Download, Description, Code, PictureAsPdf } from '@mui/icons-material';
import { CanvasItem } from '@/types/canvas';
import { exportToJSON, exportToMarkdown, exportToPDF } from '@/lib/export/export-utils';

export type ExportFormat = 'json' | 'markdown' | 'pdf' | 'png';

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
  stageRef
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const filename = canvasName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      if (format === 'json') {
        const json = await exportToJSON(canvasId, canvasName, items);
        downloadFile(json, `${filename}.json`, 'application/json');
      } else if (format === 'markdown') {
        const md = await exportToMarkdown(canvasId, canvasName, items);
        downloadFile(md, `${filename}.md`, 'text/markdown');
      } else if (format === 'pdf') {
        await exportToPDF(filename, stageRef.current);
      } else if (format === 'png') {
        if (stageRef.current) {
          const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2 });
          const link = document.createElement('a');
          link.download = `${filename}.png`;
          link.href = dataUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }

      onClose();
    } catch (error) {
      console.error('Export failed:', error);
      // Show error toast
    } finally {
      setIsExporting(false);
    }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Download fontSize="small" />
                  <Typography>PNG Image</Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="pdf"
              control={<Radio />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PictureAsPdf fontSize="small" />
                  <Typography>PDF Document</Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="markdown"
              control={<Radio />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Description fontSize="small" />
                  <Typography>Markdown (Notes & Links)</Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="json"
              control={<Radio />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Code fontSize="small" />
                  <Typography>JSON (Backup)</Typography>
                </Box>
              }
            />
          </RadioGroup>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isExporting}>
          Cancel
        </Button>
        <Button
          onClick={handleExport}
          variant="contained"
          disabled={isExporting}
          startIcon={isExporting ? <CircularProgress size={20} /> : <Download />}
        >
          {isExporting ? 'Exporting...' : 'Export'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
