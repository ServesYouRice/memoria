/**
 * Version History Dialog
 * Browse a canvas's saved and automatic versions, preview one read-only, and
 * (for editors and owners) restore it or save the current state.
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
  ListItemButton,
  ListItemText,
  IconButton,
  CircularProgress,
  Alert,
  Box,
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Close, Restore, Save } from "@mui/icons-material";
import {
  useCanvasVersion,
  useCanvasVersionHistory,
  useCreateVersion,
  useRestoreVersion,
  type CanvasVersion,
  type CanvasVersionKind,
} from "@/lib/hooks/use-canvas-versions";
import { canvasKeys } from "@/lib/hooks/use-canvases";
import { canvasItemKeys } from "@/lib/hooks/use-canvas-items";
import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { VersionPreview } from "@/features/canvas/components/VersionPreview";

export interface VersionHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  /**
   * Owners and editors may restore a version and save the current state.
   * Everyone who can view the canvas may browse and preview. The server
   * enforces the same split; this only decides what is offered.
   */
  canRestore?: boolean;
}

type KindFilter = CanvasVersionKind | "ALL";

function versionTitle(version: CanvasVersion) {
  return version.kind === "AUTO" ? "Automatic snapshot" : version.name;
}

function versionDetail(version: CanvasVersion) {
  const createdAt = new Date(version.createdAt);
  const when = `${format(createdAt, "MMM d, yyyy, h:mm a")} (${formatDistanceToNow(
    createdAt,
    { addSuffix: true },
  )})`;
  if (version.kind === "AUTO") return when;
  return `${when} by ${version.createdBy?.name || "a collaborator"}`;
}

export function VersionHistoryDialog({
  open,
  onClose,
  canvasId,
  canRestore = false,
}: VersionHistoryDialogProps) {
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [pendingRestore, setPendingRestore] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useCanvasVersionHistory(canvasId, kind, open);
  const { mutateAsync: createVersion, isPending: isCreating } =
    useCreateVersion();
  const { mutateAsync: restoreVersion } = useRestoreVersion();
  const queryClient = useQueryClient();

  const versions = data?.pages.flatMap((page) => page.versions) ?? [];
  const activeId =
    selectedId && versions.some((version) => version.id === selectedId)
      ? selectedId
      : (versions[0]?.id ?? null);
  const activeSummary = versions.find((version) => version.id === activeId);
  const {
    data: activeVersion,
    isLoading: isPreviewLoading,
    error: previewError,
  } = useCanvasVersion(canvasId, activeId ?? undefined, open);

  const handleCreateVersion = async () => {
    setActionError(null);
    try {
      await createVersion({ canvasId });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to save version",
      );
    }
  };

  const handleRestore = async () => {
    if (!activeId) return;
    setRestoring(true);
    setActionError(null);
    try {
      await restoreVersion({ canvasId, versionId: activeId });
      onClose();
      // Invalidate queries to refresh canvas data instead of full page reload
      await queryClient.invalidateQueries({
        queryKey: canvasKeys.detail(canvasId),
      });
      await queryClient.invalidateQueries({ queryKey: canvasItemKeys.all });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to restore version",
      );
    } finally {
      setRestoring(false);
      setPendingRestore(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
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
          <ToggleButtonGroup
            exclusive
            size="small"
            value={kind}
            onChange={(_, next: KindFilter | null) => next && setKind(next)}
            aria-label="Filter versions"
            sx={{ mb: 2 }}
          >
            <ToggleButton value="ALL">All</ToggleButton>
            <ToggleButton value="MANUAL">Saved</ToggleButton>
            <ToggleButton value="AUTO">Automatic</ToggleButton>
          </ToggleButtonGroup>

          {actionError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {actionError}
            </Alert>
          )}

          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error">Failed to load versions</Alert>
          ) : versions.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                No versions saved yet
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: { xs: "1fr", md: "minmax(0, 5fr) 7fr" },
              }}
            >
              <Box sx={{ maxHeight: { xs: 220, md: 400 }, overflowY: "auto" }}>
                <List dense disablePadding aria-label="Versions">
                  {versions.map((version) => (
                    <ListItemButton
                      key={version.id}
                      selected={version.id === activeId}
                      onClick={() => setSelectedId(version.id)}
                    >
                      <ListItemText
                        primary={versionTitle(version)}
                        secondary={versionDetail(version)}
                        slotProps={{ primary: { noWrap: true } }}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={version.kind === "AUTO" ? "Auto" : "Saved"}
                        color={version.kind === "AUTO" ? "default" : "primary"}
                        sx={{ ml: 1 }}
                      />
                    </ListItemButton>
                  ))}
                </List>
                {hasNextPage && (
                  <Button
                    fullWidth
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <CircularProgress size={20} />
                    ) : (
                      "Load older versions"
                    )}
                  </Button>
                )}
              </Box>

              <Box>
                {previewError ? (
                  <Alert severity="error">Failed to load this version</Alert>
                ) : isPreviewLoading || !activeVersion ? (
                  <Box
                    sx={{ display: "flex", justifyContent: "center", py: 4 }}
                  >
                    <CircularProgress aria-label="Loading preview" />
                  </Box>
                ) : (
                  <>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Preview (read-only)
                      {activeSummary ? `: ${versionTitle(activeSummary)}` : ""}
                    </Typography>
                    <VersionPreview
                      snapshot={activeVersion.snapshot}
                      name={versionTitle(activeVersion)}
                    />
                    {!canRestore && (
                      <Typography
                        variant="caption"
                        sx={{
                          display: "block",
                          mt: 1,
                          color: "text.secondary",
                        }}
                      >
                        Only owners and editors can restore a version.
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose}>Close</Button>
          {canRestore && (
            <>
              <Button
                startIcon={<Restore />}
                onClick={() => setPendingRestore(true)}
                disabled={!activeId || restoring}
              >
                Restore This Version
              </Button>
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
            </>
          )}
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={pendingRestore}
        title="Restore canvas version?"
        message="The current canvas state will be replaced by this saved version."
        confirmLabel="Restore"
        destructive
        onClose={() => setPendingRestore(false)}
        onConfirm={handleRestore}
      />
    </>
  );
}
