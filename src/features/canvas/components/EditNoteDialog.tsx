/**
 * Edit Note Dialog
 *
 * MUI dialog for editing existing notes on the canvas
 */

"use client";

import React, { useState, useEffect } from "react";
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
} from "@mui/material";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUpdateCanvasItem } from "@/lib/hooks/use-canvas-items";
import { type CanvasItem, isNoteContent } from "@/types/canvas";
import { TagInput } from "./TagInput";
import { RichTextEditor } from "@/components/RichTextEditor";
import { EMPTY_VERSIONED_NOTE_CONTENT } from "@/components/RichTextEditor";
import {
  normalizeNoteContent,
  type VersionedNoteContent,
} from "@/lib/rich-text/note-format";

interface EditNoteDialogProps {
  open: boolean;
  onClose: () => void;
  item: CanvasItem | null;
}

const formSchema = z.object({
  content: z.custom<VersionedNoteContent>(),
  tags: z.array(z.string()).default([]),
});

// Zod 4 separates a schema's input and output types: `.default()` makes a
// field optional on the way in and guaranteed on the way out. React Hook Form
// needs both, so the form is typed with the input and the resolved output.
type FormInput = z.input<typeof formSchema>;
type FormData = z.output<typeof formSchema>;

export function EditNoteDialog({ open, onClose, item }: EditNoteDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [legacyNormalized, setLegacyNormalized] = useState(false);
  const updateItem = useUpdateCanvasItem();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      content: EMPTY_VERSIONED_NOTE_CONTENT,
      tags: [],
    },
  });

  useEffect(() => {
    if (item && isNoteContent(item.content)) {
      try {
        const normalized = normalizeNoteContent(item.content);
        reset({
          content: normalized,
          tags: item.tags || [],
        });
        setLegacyNormalized(item.content.formatVersion !== 1);
        setError(null);
      } catch (normalizationError) {
        setError(
          normalizationError instanceof Error
            ? normalizationError.message
            : "This note contains unsupported content and cannot be edited.",
        );
      }
    }
  }, [item, reset]);

  const handleClose = () => {
    reset();
    setError(null);
    setLegacyNormalized(false);
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
          content: normalizeNoteContent(data.content),
          tags: data.tags || [],
        },
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update note");
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
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              Update your note content and tags.
            </Typography>

            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
                Note Content
              </Typography>
              <Controller
                name="content"
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
              {legacyNormalized && (
                <Alert severity="info">
                  Legacy note content was normalized to the supported versioned
                  rich-text format. Review it before saving.
                </Alert>
              )}
              {errors.content && (
                <Typography
                  variant="caption"
                  color="error"
                  sx={{ mt: 0.5, display: "block" }}
                >
                  Unsupported or empty rich-text content.
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
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
