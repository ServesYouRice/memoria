/**
 * Version History Dialog
 * View and restore canvas versions
 */

'use client';

import React, { useState } from 'react';
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
} from '@mui/material';
import { Close, Restore, Save } from '@mui/icons-material';
import {
  useCanvasVersions,
  useCreateVersion,
  useRestoreVersion,
} from '@/lib/hooks/use-canvas-versions';
import { formatDistanceToNow } from 'date-fns';

export interface VersionHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
}

export function VersionHistoryDialog({ open, onClose, canvasId }: VersionHistoryDialogProps) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const { data, isLoading, error } = useCanvasVersions(canvasId);
  const { mutateAsync: createVersion, isPending: isCreating } = useCreateVersion();
  const { mutateAsync: restoreVersion } = useRestoreVersion();

  const versions = data?.versions || [];

  const handleCreateVersion = async () => {
    try {
      await createVersion({ canvasId });
    } catch (err) {
      console.error('Failed to create version:', err);
    }
  };

  const handleRestore = async (versionId: string) => {
    if (!confirm('Restore to this version? Current state will be lost.')) return;

    setRestoring(versionId);
    try {
      await restoreVersion({ canvasId, versionId });
      onClose();
      window.location.reload();
    } catch (err) {
      console.error('Failed to restore version:', err);
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Version History
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">Failed to load versions</Alert>
        ) : versions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
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
                    onClick={() => handleRestore(version.id)}
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
                  secondary={formatDistanceToNow(new Date(version.createdAt), {
                    addSuffix: true,
                  })}
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
          {isCreating ? <CircularProgress size={20} /> : 'Save Current Version'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
