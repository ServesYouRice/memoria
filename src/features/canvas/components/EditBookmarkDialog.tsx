/**
 * Edit Bookmark Dialog
 *
 * MUI dialog for editing existing bookmarks on the canvas
 */

"use client";

import React, { useState, useEffect } from "react";
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
} from "@mui/material";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUpdateCanvasItem } from "@/lib/hooks/use-canvas-items";
import { type CanvasItem, isBookmarkContent } from "@/types/canvas";
import { TagInput } from "./TagInput";

interface EditBookmarkDialogProps {
  open: boolean;
  onClose: () => void;
  item: CanvasItem | null;
}

const formSchema = z.object({
  url: z.string().url("Please enter a valid URL"),
  tags: z.array(z.string()).default([]),
});

// Zod 4 separates a schema's input and output types: `.default()` makes a
// field optional on the way in and guaranteed on the way out. React Hook Form
// needs both, so the form is typed with the input and the resolved output.
type FormInput = z.input<typeof formSchema>;
type FormData = z.output<typeof formSchema>;

export function EditBookmarkDialog({
  open,
  onClose,
  item,
}: EditBookmarkDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isUnfurling, setIsUnfurling] = useState(false);
  const [metadata, setMetadata] = useState<any>(null);
  // The URL `metadata` describes, and whether it was fetched in this dialog
  // (rather than loaded from the saved bookmark). Metadata is only shown and
  // saved while this URL matches the one in the form.
  const [metadataUrl, setMetadataUrl] = useState<string | null>(null);
  const [metadataFetched, setMetadataFetched] = useState(false);
  const updateItem = useUpdateCanvasItem();

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "",
      tags: [],
    },
  });

  const urlValue = watch("url");

  useEffect(() => {
    if (item && isBookmarkContent(item.content)) {
      reset({
        url: item.content.url || "",
        tags: item.tags || [],
      });
      // Set initial metadata from existing content
      setMetadata({
        title: item.content.title,
        description: item.content.description,
        favicon: item.content.favicon,
        previewImage: item.content.previewImage,
        siteName: item.content.siteName,
      });
      setMetadataUrl(item.content.url || null);
      setMetadataFetched(false);
    }
  }, [item, reset]);

  const handleClose = () => {
    reset();
    setError(null);
    setMetadata(null);
    setMetadataUrl(null);
    setMetadataFetched(false);
    onClose();
  };

  const handleUnfurl = async () => {
    if (!urlValue) {
      setError("Please enter a URL first");
      return;
    }

    const requestedUrl = urlValue;
    try {
      setError(null);
      setIsUnfurling(true);

      const response = await fetch("/api/v1/unfurl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: requestedUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Failed to fetch preview");
      }

      const data = await response.json();
      setMetadata(data);
      setMetadataUrl(requestedUrl);
      setMetadataFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch preview");
    } finally {
      setIsUnfurling(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!item) return;

    try {
      setError(null);

      const urlUnchanged =
        isBookmarkContent(item.content) && item.content.url === data.url;
      // Metadata loaded or fetched for another URL must not be saved with
      // this one, or the bookmark would show the old page's title and image.
      const metadataMatches = metadata !== null && metadataUrl === data.url;
      const saved = metadataMatches ? metadata : null;
      let unfurledAt: string | undefined;
      if (metadataMatches && metadataFetched) {
        unfurledAt = new Date().toISOString();
      } else if (urlUnchanged && isBookmarkContent(item.content)) {
        unfurledAt = item.content.unfurledAt;
      }

      const updatedContent = {
        url: data.url,
        title: saved?.title || undefined,
        description: saved?.description || undefined,
        favicon: saved?.favicon || undefined,
        previewImage: saved?.previewImage || undefined,
        siteName: saved?.siteName || undefined,
        unfurledAt,
        // Keep the enrichment summary while the link stays the same.
        summary:
          urlUnchanged && isBookmarkContent(item.content)
            ? item.content.summary
            : undefined,
      };

      await updateItem.mutateAsync({
        itemId: item.id,
        data: {
          version: item.version,
          content: updatedContent,
          tags: data.tags || [],
        },
      });

      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update bookmark",
      );
    }
  };

  if (!item) {
    return null;
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Bookmark</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              Update the bookmark URL and tags. You can re-fetch metadata if the
              URL has changed.
            </Typography>

            <Box>
              <Controller
                name="url"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="URL"
                    fullWidth
                    error={!!errors.url}
                    helperText={errors.url?.message}
                    disabled={isSubmitting}
                    placeholder="https://example.com"
                  />
                )}
              />
              <Button
                variant="outlined"
                size="small"
                onClick={handleUnfurl}
                disabled={isUnfurling || isSubmitting || !urlValue}
                sx={{ mt: 1 }}
                startIcon={isUnfurling ? <CircularProgress size={16} /> : null}
              >
                {isUnfurling ? "Fetching..." : "Re-fetch Metadata"}
              </Button>
            </Box>

            {metadata &&
              metadataUrl === urlValue &&
              (metadata.title || metadata.description) && (
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle2" gutterBottom>
                      Preview
                    </Typography>
                    {metadata.title && (
                      <Typography
                        variant="body1"
                        gutterBottom
                        sx={{
                          fontWeight: "bold",
                        }}
                      >
                        {metadata.title}
                      </Typography>
                    )}
                    {metadata.description && (
                      <Typography
                        variant="body2"
                        gutterBottom
                        sx={{
                          color: "text.secondary",
                        }}
                      >
                        {metadata.description}
                      </Typography>
                    )}
                    {metadata.siteName && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                        }}
                      >
                        {metadata.siteName}
                      </Typography>
                    )}
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
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
