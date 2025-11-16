/**
 * Create Image Dialog
 *
 * MUI dialog for uploading and adding images to the canvas
 */

'use client';

import React, { useState, useRef } from 'react';
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
  LinearProgress,
} from '@mui/material';
import { CloudUpload as UploadIcon } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateCanvasItem } from '@/lib/hooks/use-canvas-items';
import { ItemType } from '@/types/canvas';
import { TagInput } from './TagInput';

interface CreateImageDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  initialPosition?: { x: number; y: number };
}

const formSchema = z.object({
  alt: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

type FormData = z.infer<typeof formSchema>;

export function CreateImageDialog({
  open,
  onClose,
  canvasId,
  initialPosition = { x: 100, y: 100 },
}: CreateImageDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<{
    url: string;
    filename: string;
    width?: number;
    height?: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createItem = useCreateCanvasItem();

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

  const handleClose = () => {
    reset();
    setError(null);
    setUploadedImage(null);
    onClose();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      setUploading(true);

      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      // Upload to server
      const response = await fetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload image');
      }

      const data = await response.json();

      // Load image to get dimensions
      const img = new Image();
      img.onload = () => {
        setUploadedImage({
          url: data.url,
          filename: data.filename,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => {
        setUploadedImage({
          url: data.url,
          filename: data.filename,
        });
      };
      img.src = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!uploadedImage) {
      setError('Please select an image to upload');
      return;
    }

    try {
      setError(null);

      // Calculate canvas dimensions (max 400px, maintain aspect ratio)
      const MAX_SIZE = 400;
      let canvasWidth = uploadedImage.width || MAX_SIZE;
      let canvasHeight = uploadedImage.height || MAX_SIZE;

      if (canvasWidth > MAX_SIZE || canvasHeight > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / canvasWidth, MAX_SIZE / canvasHeight);
        canvasWidth = Math.floor(canvasWidth * ratio);
        canvasHeight = Math.floor(canvasHeight * ratio);
      }

      await createItem.mutateAsync({
        canvasId,
        type: ItemType.IMAGE,
        positionX: initialPosition.x,
        positionY: initialPosition.y,
        width: canvasWidth,
        height: canvasHeight,
        zIndex: 0,
        content: {
          url: uploadedImage.url,
          filename: uploadedImage.filename,
          alt: data.alt || '',
          width: uploadedImage.width,
          height: uploadedImage.height,
        },
        tags: data.tags || [],
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create image item');
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Image</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Upload an image to add it to your canvas.
            </Typography>

            {/* File upload */}
            <Box>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <Button
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isSubmitting}
                fullWidth
              >
                {uploading ? 'Uploading...' : uploadedImage ? 'Change Image' : 'Select Image'}
              </Button>
              {uploading && <LinearProgress sx={{ mt: 1 }} />}
            </Box>

            {/* Image preview */}
            {uploadedImage && (
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 2,
                  textAlign: 'center',
                }}
              >
                <img
                  src={uploadedImage.url}
                  alt="Preview"
                  style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px' }}
                />
                <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
                  {uploadedImage.filename}
                  {uploadedImage.width && uploadedImage.height &&
                    ` (${uploadedImage.width} × ${uploadedImage.height})`}
                </Typography>
              </Box>
            )}

            {/* Alt text */}
            <Controller
              name="alt"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Alternative Text (optional)"
                  placeholder="Describe the image..."
                  fullWidth
                  helperText="Alternative text helps with accessibility"
                  error={!!errors.alt}
                  disabled={isSubmitting}
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
          <Button onClick={handleClose} disabled={isSubmitting || uploading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting || uploading || !uploadedImage}
            startIcon={isSubmitting ? <CircularProgress size={20} /> : null}
          >
            {isSubmitting ? 'Adding...' : 'Add to Canvas'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
