import React, { useState } from "react";
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
  Typography,
  FormControlLabel,
  Switch,
} from "@mui/material";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSaveAsTemplate } from "@/lib/hooks/use-templates";

interface SaveAsTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  canvasName: string;
}

const formSchema = z.object({
  name: z.string().min(1, "Template name is required").max(100),
  description: z.string().max(500).optional(),
  category: z.string().min(1, "Category is required"),
  isPublic: z.boolean().default(false),
});

type FormData = z.infer<typeof formSchema>;

const CATEGORIES = [
  "Brainstorming",
  "Planning",
  "Research",
  "Design",
  "Meeting",
  "Personal",
  "Education",
  "Other",
];

export function SaveAsTemplateDialog({
  open,
  onClose,
  canvasId,
  canvasName,
}: SaveAsTemplateDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: saveAsTemplate, isPending } = useSaveAsTemplate();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: `Template - ${canvasName}`,
      description: "",
      category: "Other",
      isPublic: false,
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      setError(null);
      await saveAsTemplate({ ...data, canvasId });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    }
  };

  const handleClose = () => {
    reset({
      name: `Template - ${canvasName}`,
      description: "",
      category: "Other",
      isPublic: false,
    });
    setError(null);
    onClose();
  };

  const isBusy = isSubmitting || isPending;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Save as Template</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
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

            <Controller
              name="isPublic"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.value}
                      onChange={(_, checked) => field.onChange(checked)}
                    />
                  }
                  label="Share with community"
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
          <Button onClick={handleClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isBusy}
            startIcon={isBusy ? <CircularProgress size={20} /> : null}
          >
            {isBusy ? "Saving..." : "Save Template"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
