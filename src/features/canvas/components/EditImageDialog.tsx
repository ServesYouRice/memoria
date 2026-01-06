/**
 * Edit Image Dialog
 *
 * MUI dialog for editing existing images on the canvas
 */

'use client';

import React, { useState, useEffect } from 'react';
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
  Card,
  CardMedia,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useUpdateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { type CanvasItem, isImageContent } from '@/types/canvas';
import { TagInput } from './TagInput';

interface EditImageDialogProps {
  open: boolean;
  onClose: () => void;
  item: CanvasItem | null;
}

const formSchema = z.object({
  alt: z.string().max(500, 'Alt text too long').optional(),
  tags: z.array(z.string()).default([]),
});

type FormData = z.infer<typeof formSchema>;

export function EditImageDialog({ open, onClose, item }: EditImageDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const updateItem = useUpdateCanvasItem();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      alt: '',
      tags: [],
    },
  });

  useEffect(() => {
    if (item && isImageContent(item.content)) {
      reset({
        alt: item.content.alt || '',
        tags: item.tags || [],
      });
    }
  }, [item, reset]);

  const handleClose = () => {
    reset();
    setError(null);
    onClose();
  };

  const onSubmit = async (data: FormData) => {
    if (!item || !isImageContent(item.content)) return;

    try {
      setError(null);

      await updateItem.mutateAsync({
        itemId: item.id,
        data: {
          version: item.version,
          content: {
            url: item.content.url,
            filename: item.content.filename,
            alt: data.alt || '',
          },
          tags: data.tags || [],
        },
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update image');
    }
  };

  if (!item || !isImageContent(item.content)) {
    return null;
  }

  const content = item.content;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Image</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Update the image alt text and tags. To replace the image, delete this one and upload a new image.
            </Typography>

            {/* Image Preview */}
            <Card variant="outlined">
              <CardMedia
                component="img"
                image={content.url}
                alt={content.alt || content.filename}
                sx={{ maxHeight: 300, objectFit: 'contain', bgcolor: '#f5f5f5' }}
              />
              <Box sx={{ p: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {content.filename}
                </Typography>
              </Box>
            </Card>

            {/* Alt Text */}
            <Controller
              name="alt"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Alt Text"
                  fullWidth
                  multiline
                  rows={2}
                  error={!!errors.alt}
                  helperText={errors.alt?.message || 'Describe the image for accessibility'}
                  disabled={isSubmitting}
                  placeholder="A description of the image..."
                />
              )}
            />

            {/* Tags */}
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
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
