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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useMutation, useQueryClient } from '@tanstack/react-query';

interface SaveAsTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  canvasName: string;
}

const formSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(100),
  description: z.string().max(500).optional(),
  category: z.string().min(1, 'Category is required'),
  isPublic: z.boolean().default(false),
});

type FormData = z.infer<typeof formSchema>;

const CATEGORIES = [
  'Brainstorming',
  'Planning',
  'Research',
  'Design',
  'Meeting',
  'Personal',
  'Education',
  'Other'
];

export function SaveAsTemplateDialog({
  open,
  onClose,
  canvasId,
  canvasName
}: SaveAsTemplateDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: `Template - ${canvasName}`,
      description: '',
      category: 'Other',
      isPublic: false,
    },
  });

  // Mock mutation for now since the API might not be fully ready
  const saveTemplateMutation = useMutation({
    mutationFn: async (data: FormData & { canvasId: string }) => {
      const response = await fetch('/api/v1/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error('Failed to create template');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      onClose();
      reset();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      setError(null);
      await saveTemplateMutation.mutateAsync({ ...data, canvasId });
    } catch {
      // Error handled in onError
    }
  };

  const handleClose = () => {
    reset();
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Save as Template</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Create a reusable template from this canvas.
            </Typography>

            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Template Name"
                  fullWidth
                  error={!!errors.name}
                  helperText={errors.name?.message}
                />
              )}
            />

            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Description (Optional)"
                  fullWidth
                  multiline
                  rows={3}
                  error={!!errors.description}
                  helperText={errors.description?.message}
                />
              )}
            />

            <Controller
              name="category"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth error={!!errors.category}>
                  <InputLabel>Category</InputLabel>
                  <Select {...field} label="Category">
                    {CATEGORIES.map((cat) => (
                      <MenuItem key={cat} value={cat}>
                        {cat}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            />

            {/* 
            <Controller
              name="isPublic"
              control={control}
              render={({ field }) => (
                 <FormControlLabel control={<Switch {...field} checked={field.value} />} label="Share with community" />
              )}
            /> 
            */}

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
            {isSubmitting ? 'Saving...' : 'Save Template'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
