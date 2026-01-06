/**
 * Edit Note Dialog
 *
 * MUI dialog for editing existing notes on the canvas
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  CircularProgress,
  Box,
  Typography,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useUpdateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { type CanvasItem, isNoteContent } from '@/types/canvas';
import { TagInput } from './TagInput';
import { RichTextEditor } from '@/components/RichTextEditor';

interface EditNoteDialogProps {
  open: boolean;
  onClose: () => void;
  item: CanvasItem | null;
}

const formSchema = z.object({
  text: z.string().min(1, 'Note text is required').max(10000, 'Note text too long'),
  tags: z.array(z.string()).default([]),
});

type FormData = z.infer<typeof formSchema>;

export function EditNoteDialog({ open, onClose, item }: EditNoteDialogProps) {
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
      text: '',
      tags: [],
    },
  });

  useEffect(() => {
    if (item && isNoteContent(item.content)) {
      reset({
        text: item.content.text || '',
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
    if (!item) return;

    try {
      setError(null);

      await updateItem.mutateAsync({
        itemId: item.id,
        data: {
          version: item.version,
          content: {
            text: data.text,
          },
          tags: data.tags || [],
        },
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update note');
    }
  };

  if (!item) {
    return null;
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Note</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Update your note content and tags.
            </Typography>

            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Note Content
              </Typography>
              <Controller
                name="text"
                control={control}
                render={({ field }) => (
                  <RichTextEditor
                    content={field.value}
                    onChange={field.onChange}
                    placeholder="Enter your note..."
                    minHeight={200}
                    editable={!isSubmitting}
                  />
                )}
              />
              {errors.text && (
                <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                  {errors.text.message}
                </Typography>
              )}
            </Box>

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
