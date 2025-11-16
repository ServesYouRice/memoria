'use client';

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
  TextField,
  Typography,
  Box,
  Divider,
  Alert,
} from '@mui/material';
import { Download } from '@mui/icons-material';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, options: ExportOptions) => void;
  canvasName: string;
}

export type ExportFormat = 'png' | 'pdf' | 'json' | 'svg';

export interface ExportOptions {
  quality: 'low' | 'medium' | 'high';
  includeBackground: boolean;
  filename?: string;
}

const QUALITY_SETTINGS = {
  low: { pixelRatio: 1, description: 'Smaller file size, lower quality' },
  medium: { pixelRatio: 2, description: 'Balanced size and quality' },
  high: { pixelRatio: 3, description: 'Larger file size, best quality' },
};

export function ExportDialog({ open, onClose, onExport, canvasName }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [includeBackground, setIncludeBackground] = useState(true);
  const [filename, setFilename] = useState(canvasName.replace(/\s+/g, '_'));

  const handleExport = () => {
    onExport(format, {
      quality,
      includeBackground,
      filename: filename || 'canvas_export',
    });
    onClose();
  };

  const getFormatDescription = (fmt: ExportFormat): string => {
    switch (fmt) {
      case 'png':
        return 'Raster image format, good for sharing and embedding';
      case 'pdf':
        return 'Document format, ideal for printing and archiving';
      case 'json':
        return 'Data format, preserves all canvas data for backup or migration';
      case 'svg':
        return 'Vector format, scalable without quality loss';
      default:
        return '';
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Export Canvas</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
          {/* Format Selection */}
          <FormControl component="fieldset">
            <FormLabel component="legend">Export Format</FormLabel>
            <RadioGroup value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              <FormControlLabel value="png" control={<Radio />} label="PNG Image" />
              <FormControlLabel value="pdf" control={<Radio />} label="PDF Document" />
              <FormControlLabel value="svg" control={<Radio />} label="SVG Vector (Coming Soon)" disabled />
              <FormControlLabel value="json" control={<Radio />} label="JSON Data" />
            </RadioGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              {getFormatDescription(format)}
            </Typography>
          </FormControl>

          <Divider />

          {/* Quality Settings (for image exports) */}
          {(format === 'png' || format === 'svg') && (
            <FormControl component="fieldset">
              <FormLabel component="legend">Quality</FormLabel>
              <RadioGroup
                value={quality}
                onChange={(e) => setQuality(e.target.value as 'low' | 'medium' | 'high')}
              >
                <FormControlLabel value="low" control={<Radio />} label="Low" />
                <FormControlLabel value="medium" control={<Radio />} label="Medium (Recommended)" />
                <FormControlLabel value="high" control={<Radio />} label="High" />
              </RadioGroup>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                {QUALITY_SETTINGS[quality].description}
              </Typography>
            </FormControl>
          )}

          {/* Filename */}
          <TextField
            label="Filename"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            fullWidth
            helperText="File extension will be added automatically"
          />

          {/* JSON Export Info */}
          {format === 'json' && (
            <Alert severity="info">
              JSON export includes all canvas data: items, positions, content, tags, and metadata.
              This format is useful for backups or importing into another system.
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleExport} variant="contained" startIcon={<Download />}>
          Export
        </Button>
      </DialogActions>
    </Dialog>
  );
}
