/**
 * Create Bookmark Dialog
 *
 * MUI dialog for creating new bookmarks on the canvas
 * Validates URL input using Zod schema
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
  CardContent,
  CardMedia,
  IconButton,
  LinearProgress,
} from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { bookmarkContentSchema } from '@/lib/validation/canvas-item';
import { useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { useDebounce } from '@/lib/hooks/use-debounce';
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

interface UnfurledMetadata {
  title?: string;
  description?: string;
  favicon?: string;
  previewImage?: string;
  siteName?: string;
  unfurledAt?: string;
}

export function CreateBookmarkDialog({
  open,
  onClose,
  canvasId,
  initialPosition = { x: 100, y: 100 },
}: CreateBookmarkDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [unfurling, setUnfurling] = useState(false);
  const [metadata, setMetadata] = useState<UnfurledMetadata | null>(null);
  const createItem = useCreateCanvasItem();

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: '',
      tags: [],
    },
  });

  // Watch the URL field for auto-unfurling
  const urlValue = watch('url');
  const debouncedUrl = useDebounce(urlValue, 1000); // 1 second debounce

  const handleClose = () => {
    reset();
    setError(null);
    setMetadata(null);
    onClose();
  };

  // Auto-unfurl when a valid URL is entered
  useEffect(() => {
    // Only auto-unfurl if:
    // 1. Dialog is open
    // 2. We have a URL value
    // 3. There are no validation errors
    // 4. We don't already have metadata
    // 5. We're not currently unfurling
    if (open && debouncedUrl && !errors.url && !metadata && !unfurling) {
      // Validate that it's a proper URL format
      try {
        new URL(debouncedUrl);
        handleUnfurl(debouncedUrl);
      } catch {
        // Invalid URL format, don't auto-unfurl
      }
    }
  }, [debouncedUrl, open, errors.url, metadata, unfurling]);

  const handleUnfurl = async (url: string) => {
    try {
      setError(null);
      setUnfurling(true);

      const response = await fetch('/api/v1/unfurl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch URL metadata');
      }

      const unfurledData = await response.json();
      setMetadata(unfurledData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unfurl URL');
    } finally {
      setUnfurling(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    try {
      setError(null);

      // Calculate height based on whether we have metadata
      const hasMetadata = metadata && (metadata.title || metadata.description);
      const height = hasMetadata ? 150 : 100;

      await createItem.mutateAsync({
        canvasId,
        type: ItemType.BOOKMARK,
        positionX: initialPosition.x,
        positionY: initialPosition.y,
        width: 300,
        height,
        zIndex: 0,
        content: {
          url: data.url,
          title: metadata?.title,
          description: metadata?.description,
          favicon: metadata?.favicon,
          previewImage: metadata?.previewImage,
          siteName: metadata?.siteName,
          unfurledAt: metadata?.unfurledAt,
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

            <Controller
              name="url"
              control={control}
              render={({ field }) => (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    {...field}
                    label="URL"
                    placeholder="https://example.com"
                    fullWidth
                    autoFocus
                    error={!!errors.url}
                    helperText={errors.url?.message}
                    disabled={isSubmitting}
                    onChange={(e) => {
                      field.onChange(e);
                      // Clear metadata when URL changes
                      setMetadata(null);
                    }}
                  />
                  <IconButton
                    onClick={() => handleUnfurl(field.value)}
                    disabled={unfurling || isSubmitting || !field.value || !!errors.url}
                    title="Fetch preview"
                    sx={{ alignSelf: 'flex-start', mt: 1 }}
                  >
                    <RefreshIcon />
                  </IconButton>
                </Box>
              )}
            />

            {unfurling && <LinearProgress />}

            {/* Metadata preview */}
            {metadata && (
              <Card variant="outlined">
                {metadata.previewImage && (
                  <CardMedia
                    component="img"
                    height="140"
                    image={metadata.previewImage}
                    alt={metadata.title || 'Preview'}
                    sx={{ objectFit: 'cover' }}
                  />
                )}
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    {metadata.favicon && (
                      <Box
                        component="img"
                        src={metadata.favicon}
                        alt="favicon"
                        sx={{ width: 20, height: 20, flexShrink: 0 }}
                      />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {metadata.title && (
                        <Typography variant="subtitle1" noWrap>
                          {metadata.title}
                        </Typography>
                      )}
                      {metadata.description && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {metadata.description}
                        </Typography>
                      )}
                      {metadata.siteName && (
                        <Typography variant="caption" color="text.secondary">
                          {metadata.siteName}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            )}

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
