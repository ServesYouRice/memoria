/**
 * Version History Dialog
 * View and restore canvas versions
 */

"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  IconButton,
  CircularProgress,
  Alert,
  Box,
  Typography,
} from "@mui/material";
import { Close, Restore, Save } from "@mui/icons-material";
import {
  useCanvasVersions,
  useCreateVersion,
  useRestoreVersion,
} from "@/lib/hooks/use-canvas-versions";
import { canvasKeys } from "@/lib/hooks/use-canvases";
import { canvasItemKeys } from "@/lib/hooks/use-canvas-items";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export interface VersionHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
}

export function VersionHistoryDialog({
  open,
  onClose,
  canvasId,
}: VersionHistoryDialogProps) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const { data, isLoading, error } = useCanvasVersions(canvasId);
  const { mutateAsync: createVersion, isPending: isCreating } =
    useCreateVersion();
  const { mutateAsync: restoreVersion } = useRestoreVersion();
  const queryClient = useQueryClient();

  const versions = data?.versions || [];

  const handleCreateVersion = async () => {
    try {
      await createVersion({ canvasId });
    } catch (err) {
      console.error("Failed to create version:", err);
    }
  };

  const handleRestore = async (versionId: string) => {
    setRestoring(versionId);
    try {
      await restoreVersion({ canvasId, versionId });
      onClose();
      // Invalidate queries to refresh canvas data instead of full page reload
      await queryClient.invalidateQueries({
        queryKey: canvasKeys.detail(canvasId),
      });
      await queryClient.invalidateQueries({ queryKey: canvasItemKeys.all });
    } catch (err) {
      console.error("Failed to restore version:", err);
    } finally {
      setRestoring(null);
      setPendingRestore(null);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          Version History
          <IconButton
            aria-label="Close version history"
            onClick={onClose}
            sx={{ position: "absolute", right: 8, top: 8 }}
          >
            <Close />
          </IconButton>
        </DialogTitle>

        <DialogContent>
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error">Failed to load versions</Alert>
          ) : versions.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No versions saved yet
              </Typography>
            </Box>
          ) : (
            <List>
              {versions.map((version) => (
                <ListItem
                  key={version.id}
                  secondaryAction={
                    <IconButton
                      edge="end"
                      aria-label={`Restore ${version.name}`}
                      onClick={() => setPendingRestore(version.id)}
                      disabled={!!restoring}
                    >
                      {restoring === version.id ? (
                        <CircularProgress size={20} />
                      ) : (
                        <Restore />
                      )}
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={version.name}
                    secondary={formatDistanceToNow(
                      new Date(version.createdAt),
                      {
                        addSuffix: true,
                      },
                    )}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleCreateVersion}
            disabled={isCreating}
          >
            {isCreating ? (
              <CircularProgress size={20} />
            ) : (
              "Save Current Version"
            )}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingRestore)}
        title="Restore canvas version?"
        message="The current canvas state will be replaced by this saved version."
        confirmLabel="Restore"
        destructive
        onClose={() => setPendingRestore(null)}
        onConfirm={async () => {
          if (pendingRestore) await handleRestore(pendingRestore);
        }}
      />
    </>
  );
}
