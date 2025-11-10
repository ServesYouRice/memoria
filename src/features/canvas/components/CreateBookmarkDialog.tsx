/**
 * Create Bookmark Dialog
 *
 * MUI dialog for creating new bookmarks on the canvas
 * Validates URL input using Zod schema
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
import { bookmarkContentSchema } from '@/lib/validation/canvas-item';
import { useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { ItemType } from '@/types/canvas';
import { TagInput } from './TagInput';

interface CreateBookmarkDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  initialPosition?: { x: number; y: number };
}

const formSchema = z.object({
  url: bookmarkContentSchema.shape.url,
  tags: z.array(z.string()).default([]),
});

type FormData = z.infer<typeof formSchema>;

export function CreateBookmarkDialog({
  open,
  onClose,
  canvasId,
  initialPosition = { x: 100, y: 100 },
}: CreateBookmarkDialogProps) {
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
      url: '',
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
        type: ItemType.BOOKMARK,
        positionX: initialPosition.x,
        positionY: initialPosition.y,
        width: 300,
        height: 100,
        zIndex: 0,
        content: {
          url: data.url,
        },
        tags: data.tags || [],
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bookmark');
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Bookmark</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Enter a URL to create a bookmark on your canvas.
            </Typography>

            {/* Phase 2 notice */}
            <Alert severity="info" sx={{ fontSize: '0.875rem' }}>
              Note: URL preview and metadata (title, description, favicon) will be added in Phase 2.
              For now, only the URL will be displayed.
            </Alert>

            <Controller
              name="url"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="URL"
                  placeholder="https://example.com"
                  fullWidth
                  autoFocus
                  error={!!errors.url}
                  helperText={errors.url?.message}
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
            {isSubmitting ? 'Creating...' : 'Create Bookmark'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
