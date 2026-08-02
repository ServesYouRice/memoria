/**
 * Create Note Dialog
 *
 * MUI dialog for creating new notes on the canvas
 */

"use client";

import React, { useState } from "react";
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
import { useCreateCanvasItem } from "@/lib/hooks/use-canvas-items";
import { ItemType } from "@/types/canvas";
import { TagInput } from "./TagInput";
import { RichTextEditor } from "@/components/RichTextEditor";
import { EMPTY_VERSIONED_NOTE_CONTENT } from "@/components/RichTextEditor";
import {
  normalizeNoteContent,
  type VersionedNoteContent,
} from "@/lib/rich-text/note-format";

interface CreateNoteDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  initialPosition?: { x: number; y: number };
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
  } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      content: EMPTY_VERSIONED_NOTE_CONTENT,
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
        content: normalizeNoteContent(data.content),
        tags: data.tags || [],
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create note");
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Note</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              Create a sticky note on your canvas.
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
                    minHeight={150}
                    editable={!isSubmitting}
                  />
                )}
              />
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
            {isSubmitting ? "Creating..." : "Create Note"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
