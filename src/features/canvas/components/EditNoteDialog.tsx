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
import type * as Y from "yjs";
import { useUpdateCanvasItem } from "@/lib/hooks/use-canvas-items";
import {
  useCanvasDocument,
  useCanvasDocumentSnapshot,
} from "@/lib/hooks/use-canvas-document";
import { type CanvasItem, ItemType, isNoteContent } from "@/types/canvas";
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

// One editor per shared fragment: a reloaded document brings new fragments.
const fragmentKeys = new WeakMap<Y.XmlFragment, number>();
let nextFragmentKey = 0;
function fragmentKey(fragment: Y.XmlFragment): number {
  let key = fragmentKeys.get(fragment);
  if (key === undefined) {
    key = ++nextFragmentKey;
    fragmentKeys.set(fragment, key);
  }
  return key;
}

/**
 * IMP-042: while the canvas document is open and writable, the note text is
 * edited live with everyone who has the canvas open, and tag changes apply at
 * once; there is nothing to submit.
 */
function SharedNoteDialog({
  open,
  onClose,
  item,
  fragment,
  tags,
}: {
  open: boolean;
  onClose: () => void;
  item: CanvasItem;
  fragment: Y.XmlFragment;
  tags: string[];
}) {
  const updateItem = useUpdateCanvasItem();
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Note</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Changes save as you type and appear for everyone on this canvas.
          </Typography>
          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
              Note Content
            </Typography>
            <RichTextEditor
              key={fragmentKey(fragment)}
              content={null}
              onChange={() => {}}
              collaboration={{ fragment }}
              placeholder="Enter your note..."
              minHeight={200}
            />
          </Box>
          <TagInput
            tags={tags}
            onChange={(nextTags) => {
              setError(null);
              updateItem.mutate(
                {
                  itemId: item.id,
                  data: { version: item.version, tags: nextTags },
                },
                {
                  onError: (err) =>
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Failed to update tags",
                    ),
                },
              );
            }}
            placeholder="Add tags..."
            size="small"
          />
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * TEXT items store plain `text` beside their style fields and are drawn as
 * plain text. The editor gets that text as literal paragraphs (never parsed
 * as markup) and a save writes back plain text with the styles kept.
 */
function plainTextEditorContent(text: string): VersionedNoteContent {
  return normalizeNoteContent(
    {
      formatVersion: 1,
      document: {
        type: "doc",
        content: text
          .split("\n")
          .map((line) =>
            line
              ? { type: "paragraph", content: [{ type: "text", text: line }] }
              : { type: "paragraph" },
          ),
      },
    },
    { allowEmpty: true },
  );
}

const NOTE_FORMAT_KEYS = new Set(["formatVersion", "document", "plainText"]);

function textItemContent(
  stored: CanvasItem["content"],
  edited: VersionedNoteContent,
): Record<string, unknown> {
  const styles = Object.fromEntries(
    Object.entries(stored as Record<string, unknown>).filter(
      ([key]) => !NOTE_FORMAT_KEYS.has(key),
    ),
  );
  return { ...styles, text: normalizeNoteContent(edited).plainText };
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
  const documentSession = useCanvasDocument();
  const documentState = useCanvasDocumentSnapshot(documentSession);
  const sharedEntry = item ? documentState.items.get(item.id) : undefined;
  const sharedFragment =
    item &&
    sharedEntry &&
    documentSession?.acceptsWrites &&
    documentState.writable
      ? documentSession.noteFragment(item.id)
      : null;

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

  const isTextItem = item?.type === ItemType.TEXT;

  useEffect(() => {
    if (item && isNoteContent(item.content)) {
      try {
        const normalized =
          item.type === ItemType.TEXT
            ? plainTextEditorContent(item.content.text ?? "")
            : normalizeNoteContent(item.content);
        reset({
          content: normalized,
          tags: item.tags || [],
        });
        setLegacyNormalized(
          item.type !== ItemType.TEXT && item.content.formatVersion !== 1,
        );
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
          content: isTextItem
            ? textItemContent(item.content, data.content)
            : normalizeNoteContent(data.content),
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

  if (sharedFragment && sharedEntry && !isTextItem) {
    return (
      <SharedNoteDialog
        open={open}
        onClose={handleClose}
        item={item}
        fragment={sharedFragment}
        tags={sharedEntry.state.tags}
      />
    );
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
