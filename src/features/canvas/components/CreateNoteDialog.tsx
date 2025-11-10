/**
 * Create Note Dialog
 *
 * MUI dialog for creating new notes on the canvas
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
  Alert,
  CircularProgress,
  Box,
  Typography,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { ItemType } from '@/types/canvas';
import { TagInput } from './TagInput';

interface CreateNoteDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  initialPosition?: { x: number; y: number };
}

const formSchema = z.object({
  text: z.string().min(1, 'Note text is required').max(5000, 'Note text too long'),
  tags: z.array(z.string()).default([]),
});

type FormData = z.infer<typeof formSchema>;

export function CreateNoteDialog({
  open,
  onClose,
  canvasId,
  initialPosition = { x: 100, y: 100 },
}: CreateNoteDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const createItem = useCreateCanvasItem();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      text: '',
      tags: [],
    },
  });

  const handleClose = () => {
    reset();
    setError(null);
    onClose();
  };

  const onSubmit = async (data: FormData) => {
    try {
      setError(null);

      await createItem.mutateAsync({
        canvasId,
        type: ItemType.NOTE,
        positionX: initialPosition.x,
        positionY: initialPosition.y,
        width: 200,
        height: 200,
        zIndex: 0,
        content: {
          text: data.text,
        },
        tags: data.tags || [],
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Note</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Create a sticky note on your canvas.
            </Typography>

            <Controller
              name="text"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Note Text"
                  placeholder="Enter your note..."
                  fullWidth
                  multiline
                  rows={4}
                  autoFocus
                  error={!!errors.text}
                  helperText={errors.text?.message}
                  disabled={isSubmitting}
                />
              )}
            />

            <Controller
              name="tags"
              control={control}
              render={({ field }) => (
                <TagInput
                  tags={field.value || []}
                  onChange={field.onChange}
                  placeholder="Add tags..."
                  size="small"
                />
              )}
            />

            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting}
            startIcon={isSubmitting ? <CircularProgress size={20} /> : null}
          >
            {isSubmitting ? 'Creating...' : 'Create Note'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
