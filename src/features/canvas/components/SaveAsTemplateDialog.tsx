/**
 * Save As Template Dialog
 * Convert current canvas to a reusable template
 */

'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
  IconButton,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { useSaveAsTemplate } from '@/lib/hooks/use-templates';

export interface SaveAsTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  canvasName: string;
}

const TEMPLATE_CATEGORIES = [
  'General',
  'Project Planning',
  'Note Taking',
  'Research',
  'Brainstorming',
  'Education',
  'Personal',
  'Business',
  'Creative',
  'Other',
];

export function SaveAsTemplateDialog({
  open,
  onClose,
  canvasId,
  canvasName,
}: SaveAsTemplateDialogProps) {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { mutateAsync: saveAsTemplate, isPending } = useSaveAsTemplate();

  const handleSave = async () => {
    setError(null);
    setSuccess(false);

    if (!description.trim()) {
      setError('Please provide a description for your template');
      return;
    }

    try {
      await saveAsTemplate({
        canvasId,
        description: description.trim(),
        category,
      });

      setSuccess(true);
      setTimeout(() => {
        onClose();
        setDescription('');
        setCategory('General');
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    }
  };

  const handleClose = () => {
    if (!isPending) {
      onClose();
      setDescription('');
      setCategory('General');
      setError(null);
      setSuccess(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Save as Template
        <IconButton
          onClick={handleClose}
          disabled={isPending}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Template saved successfully!
          </Alert>
        )}

        <TextField
          label="Template Name"
          value={canvasName}
          fullWidth
          disabled
          sx={{ mb: 2 }}
          helperText="The current canvas name will be used"
        />

        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={3}
          required
          disabled={isPending}
          sx={{ mb: 2 }}
          placeholder="Describe what this template is for and how to use it..."
          helperText={`${description.length}/500 characters`}
          inputProps={{ maxLength: 500 }}
        />

        <FormControl fullWidth disabled={isPending}>
          <InputLabel>Category</InputLabel>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} label="Category">
            {TEMPLATE_CATEGORIES.map((cat) => (
              <MenuItem key={cat} value={cat}>
                {cat}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={isPending || !description.trim()}
        >
          {isPending ? <CircularProgress size={20} /> : 'Save Template'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
