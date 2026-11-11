/**
 * Create Image Dialog
 *
 * MUI dialog for uploading and adding images to the canvas
 */

"use client";

import React, { useEffect, useState, useRef } from "react";
import Image from "next/image";
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
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { CloudUpload as UploadIcon } from "@mui/icons-material";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateCanvasItem } from "@/lib/hooks/use-canvas-items";
import { ItemType } from "@/types/canvas";
import { TagInput } from "./TagInput";
import {
  announceUploadNote,
  requestUploadNote,
  uploadAssetIdFromUrl,
  useUploadNoteOffers,
} from "@/features/canvas/hooks/use-upload-notes";

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

// Zod 4 separates a schema's input and output types: `.default()` makes a
// field optional on the way in and guaranteed on the way out. React Hook Form
// needs both, so the form is typed with the input and the resolved output.
type FormInput = z.input<typeof formSchema>;
type FormData = z.output<typeof formSchema>;

/**
 * Best-effort delete of an upload the user abandoned, so it stops counting
 * against the quota. The DELETE route allows only the canvas owner, so an
 * editor's abandoned upload is refused (403) and stays until upload delete
 * authorization for uploaders is decided; failures are ignored.
 */
function discardUpload(assetId: string) {
  try {
    void fetch(`/api/v1/uploads/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Cleanup never blocks closing the dialog.
  }
}

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
  // The uploaded asset not yet added to the canvas.
  const pendingAssetRef = useRef<string | null>(null);
  const discardPending = () => {
    const assetId = pendingAssetRef.current;
    pendingAssetRef.current = null;
    if (assetId) discardUpload(assetId);
  };
  useEffect(() => discardPending, []);
  const createItem = useCreateCanvasItem();
  // IMP-071: offered only when the saved AI provider can read images.
  const offers = useUploadNoteOffers(open);
  const [makeNote, setMakeNote] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      alt: "",
      tags: [],
    },
  });

  // Each file pick gets an id; work from an earlier pick (or a pick the
  // dialog was closed during) is ignored.
  const selectionRef = useRef(0);

  const handleClose = () => {
    selectionRef.current += 1;
    discardPending();
    reset();
    setError(null);
    setUploadedImage(null);
    setUploading(false);
    setMakeNote(false);
    onClose();
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const selection = ++selectionRef.current;
    const isCurrent = () => selection === selectionRef.current;

    try {
      setError(null);
      // The previous image must not be submitted while its replacement
      // uploads and loads; Add stays disabled until this pick settles.
      setUploadedImage(null);
      setUploading(true);

      // Create form data
      const formData = new FormData();
      formData.append("file", file);
      formData.append("canvasId", canvasId);

      // Upload to server
      const response = await fetch("/api/v1/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload image");
      }

      const data = await response.json();
      const assetId: string | null =
        typeof data.assetId === "string"
          ? data.assetId
          : uploadAssetIdFromUrl(data.url);
      if (!isCurrent()) {
        // A newer pick (or closing) replaced this upload before it finished.
        if (assetId) discardUpload(assetId);
        return;
      }
      // "Change Image": the previous upload is no longer wanted.
      discardPending();
      pendingAssetRef.current = assetId;

      // Load image to get dimensions
      const img = new globalThis.Image();
      const settle = (dimensions: { width?: number; height?: number }) => {
        if (!isCurrent()) return;
        setUploadedImage({
          url: data.url,
          filename: data.filename,
          ...dimensions,
        });
        setUploading(false);
      };
      img.onload = () =>
        settle({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => settle({});
      img.src = data.url;
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : "Failed to upload image");
      setUploading(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!uploadedImage) {
      setError("Please select an image to upload");
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
          alt: data.alt || "",
          width: uploadedImage.width,
          height: uploadedImage.height,
        },
        tags: data.tags || [],
      });
      // The item now references the upload; closing must not delete it.
      pendingAssetRef.current = null;

      const assetId = uploadAssetIdFromUrl(uploadedImage.url);
      if (makeNote && offers.readImage && assetId) {
        // The note goes beside the image; the original is kept.
        announceUploadNote(
          assetId,
          requestUploadNote({
            assetId,
            positionX: initialPosition.x + canvasWidth + 24,
            positionY: initialPosition.y,
          }),
        );
      }

      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create image item",
      );
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Image</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              Upload an image to add it to your canvas.
            </Typography>

            {/* File upload */}
            <Box>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
              <Button
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isSubmitting}
                fullWidth
              >
                {uploading
                  ? "Uploading..."
                  : uploadedImage
                    ? "Change Image"
                    : "Select Image"}
              </Button>
              {uploading && <LinearProgress sx={{ mt: 1 }} />}
            </Box>

            {/* Image preview */}
            {uploadedImage && (
              <Box
                sx={{
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  p: 2,
                  textAlign: "center",
                }}
              >
                <Image
                  src={uploadedImage.url}
                  alt={uploadedImage.filename || "Uploaded image preview"}
                  width={uploadedImage.width ?? 400}
                  height={uploadedImage.height ?? 300}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "300px",
                    height: "auto",
                    borderRadius: "4px",
                  }}
                  unoptimized
                />
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    color: "text.secondary",
                    mt: 1,
                  }}
                >
                  {uploadedImage.filename}
                  {uploadedImage.width &&
                    uploadedImage.height &&
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

            {offers.readImage && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={makeNote}
                    onChange={(event) => setMakeNote(event.target.checked)}
                    disabled={isSubmitting}
                  />
                }
                label="Make a note from this photo (AI reads receipts, whiteboards and pages)"
              />
            )}

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
            {isSubmitting ? "Adding..." : "Add to Canvas"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
