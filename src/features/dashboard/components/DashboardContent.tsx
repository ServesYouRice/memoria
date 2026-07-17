"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  TextField,
  Typography,
  Alert,
  alpha,
} from "@mui/material";
import {
  Add as AddIcon,
  MoreVert,
  ContentCopy as DuplicateIcon,
  Delete as DeleteIcon,
  CheckBoxOutlineBlank,
  Close as CloseIcon,
  BrushOutlined as CanvasIcon,
  FolderOutlined as WorkspaceIcon,
} from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import {
  useCanvases,
  useCreateCanvas,
  useDuplicateCanvas,
  canvasKeys,
} from "@/lib/hooks/use-canvases";
import { useWorkspace } from "@/lib/hooks/use-workspaces";
import { ActivityFeed } from "./ActivityFeed";
import { CanvasCard, CanvasCardSkeleton, CardGrid } from "./CanvasCard";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { useThemeMode } from "@/lib/theme-context";

export function DashboardContent({ userName }: { userName?: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const workspaceId = searchParams.get("workspace");
  const { data: workspaceData } = useWorkspace(workspaceId || undefined);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState("");
  const [menuAnchor, setMenuAnchor] = useState<{
    element: HTMLElement;
    canvasId: string;
  } | null>(null);
  const [selectedCanvasIds, setSelectedCanvasIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const { data: canvasesData, isLoading, error } = useCanvases();
  const createCanvas = useCreateCanvas();
  const duplicateCanvas = useDuplicateCanvas();
  const { mode, toggleTheme } = useThemeMode();

  const canvases = useMemo(() => {
    const all = canvasesData?.canvases ?? [];
    return workspaceId ? all.filter((c) => c.workspaceId === workspaceId) : all;
  }, [canvasesData, workspaceId]);

  const handleCreateCanvas = async () => {
    try {
      const canvas = await createCanvas.mutateAsync({
        name: newCanvasName || undefined,
        workspaceId: workspaceId || undefined,
      });
      setCreateDialogOpen(false);
      setNewCanvasName("");
      router.push(`/canvas/${canvas.id}`);
    } catch {
      toast.error("Failed to create canvas");
    }
  };

  // Command palette keyboard shortcut
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleCanvasSelection = (canvasId: string) => {
    setSelectedCanvasIds((prev) => {
      const next = new Set(prev);
      if (next.has(canvasId)) next.delete(canvasId);
      else next.add(canvasId);
      return next;
    });
  };

  const handleCanvasClick = (canvasId: string, event?: React.MouseEvent) => {
    if (selectionMode) {
      event?.stopPropagation();
      toggleCanvasSelection(canvasId);
    } else {
      router.push(`/canvas/${canvasId}`);
    }
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) setSelectedCanvasIds(new Set());
  };

  const handleMenuOpen = (
    event: React.MouseEvent<HTMLElement>,
    canvasId: string,
  ) => {
    event.stopPropagation();
    setMenuAnchor({ element: event.currentTarget, canvasId });
  };

  const handleMenuClose = () => setMenuAnchor(null);

  const handleDuplicate = async () => {
    if (!menuAnchor) return;
    handleMenuClose();
    try {
      await duplicateCanvas.mutateAsync(menuAnchor.canvasId);
      toast.success("Canvas duplicated");
    } catch {
      toast.error("Failed to duplicate canvas");
    }
  };

  const handleBulkDuplicate = async () => {
    try {
      await Promise.all(
        Array.from(selectedCanvasIds).map((id) =>
          duplicateCanvas.mutateAsync(id),
        ),
      );
      toast.success(
        `Duplicated ${selectedCanvasIds.size} canvas${selectedCanvasIds.size === 1 ? "" : "es"}`,
      );
      setSelectedCanvasIds(new Set());
      setSelectionMode(false);
    } catch {
      toast.error("Failed to duplicate canvases");
    }
  };

  const handleBulkDelete = async () => {
    setIsDeleting(true);
    try {
      await Promise.all(
        Array.from(selectedCanvasIds).map(async (id) => {
          const response = await fetch(`/api/v1/canvases/${id}`, {
            method: "DELETE",
          });
          if (!response.ok) throw new Error("Failed to delete canvas");
        }),
      );
      toast.success(
        `Deleted ${selectedCanvasIds.size} canvas${selectedCanvasIds.size === 1 ? "" : "es"}`,
      );
      setSelectedCanvasIds(new Set());
      setSelectionMode(false);
      setDeleteConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: canvasKeys.all });
    } catch {
      toast.error("Failed to delete canvases");
    } finally {
      setIsDeleting(false);
    }
  };

  const hasCanvases = canvases.length > 0;
  const workspaceName = workspaceData?.name;

  return (
    <>
      <PageHeader
        title={workspaceId ? workspaceName || "Workspace" : "My canvases"}
        subtitle={
          workspaceId ? (
            <Chip
              size="small"
              icon={<WorkspaceIcon />}
              label={`Filtered by workspace${workspaceName ? `: ${workspaceName}` : ""}`}
              onDelete={() => router.push("/dashboard")}
              sx={{ mt: 0.5 }}
            />
          ) : (
            `Welcome back${userName ? `, ${userName}` : ""} — ${
              isLoading
                ? "loading…"
                : `${canvases.length} canvas${canvases.length === 1 ? "" : "es"}`
            }`
          )
        }
        actions={
          <>
            {hasCanvases && (
              <Button
                variant="outlined"
                startIcon={
                  selectionMode ? <CloseIcon /> : <CheckBoxOutlineBlank />
                }
                onClick={toggleSelectionMode}
              >
                {selectionMode ? "Cancel" : "Select"}
              </Button>
            )}
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              New canvas
            </Button>
          </>
        }
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 320px" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Box>
          {/* Bulk actions toolbar */}
          {selectionMode && (
            <Paper
              variant="outlined"
              sx={{
                mb: 2,
                p: 1.5,
                px: 2,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 1,
                borderRadius: 3,
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
                animation: "fadeIn 0.25s ease-out",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography variant="body2" fontWeight={600}>
                  {selectedCanvasIds.size} selected
                </Typography>
                {selectedCanvasIds.size > 0 && (
                  <Button
                    size="small"
                    onClick={() => setSelectedCanvasIds(new Set())}
                  >
                    Clear
                  </Button>
                )}
                {selectedCanvasIds.size !== canvases.length && (
                  <Button
                    size="small"
                    onClick={() =>
                      setSelectedCanvasIds(new Set(canvases.map((c) => c.id)))
                    }
                  >
                    Select all
                  </Button>
                )}
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DuplicateIcon />}
                  onClick={handleBulkDuplicate}
                  disabled={selectedCanvasIds.size === 0}
                >
                  Duplicate
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={selectedCanvasIds.size === 0}
                >
                  Delete
                </Button>
              </Box>
            </Paper>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to load canvases. Please try again.
            </Alert>
          )}

          {isLoading && (
            <CardGrid>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <CanvasCardSkeleton key={i} index={i} />
              ))}
            </CardGrid>
          )}

          {!isLoading && !hasCanvases && (
            <EmptyState
              icon={CanvasIcon}
              title={
                workspaceId
                  ? "No canvases in this workspace"
                  : "No canvases yet"
              }
              description={
                workspaceId
                  ? "Canvases assigned to this workspace will show up here."
                  : "Create your first canvas to start organizing your notes, bookmarks, and ideas in an infinite workspace."
              }
              action={
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setCreateDialogOpen(true)}
                >
                  Create your first canvas
                </Button>
              }
            />
          )}

          {!isLoading && hasCanvases && (
            <CardGrid>
              {canvases.map((canvas, index) => (
                <CanvasCard
                  key={canvas.id}
                  name={canvas.name}
                  thumbnail={canvas.thumbnail}
                  index={index}
                  selected={selectedCanvasIds.has(canvas.id)}
                  meta={`Updated ${formatDistanceToNow(new Date(canvas.updatedAt), { addSuffix: true })}`}
                  onClick={(e) => handleCanvasClick(canvas.id, e)}
                  corner={
                    selectionMode ? (
                      <Checkbox
                        checked={selectedCanvasIds.has(canvas.id)}
                        onChange={() => toggleCanvasSelection(canvas.id)}
                        onClick={(e) => e.stopPropagation()}
                        sx={{
                          bgcolor: "background.paper",
                          borderRadius: 1,
                          p: 0.25,
                        }}
                      />
                    ) : (
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${canvas.name}`}
                        onClick={(e) => handleMenuOpen(e, canvas.id)}
                        sx={{
                          bgcolor: (theme) =>
                            alpha(theme.palette.background.paper, 0.85),
                          backdropFilter: "blur(4px)",
                          "&:hover": { bgcolor: "background.paper" },
                        }}
                      >
                        <MoreVert fontSize="small" />
                      </IconButton>
                    )
                  }
                />
              ))}
            </CardGrid>
          )}
        </Box>

        {/* Activity feed */}
        <Paper
          variant="outlined"
          sx={{
            p: 2.5,
            position: "sticky",
            top: 80,
            borderRadius: 3,
            display: { xs: "none", md: "block" },
          }}
        >
          <ActivityFeed limit={15} />
        </Paper>
      </Box>

      {/* Create canvas dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Create new canvas</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Canvas name"
            type="text"
            fullWidth
            variant="outlined"
            value={newCanvasName}
            onChange={(e) => setNewCanvasName(e.target.value)}
            placeholder="Untitled Canvas"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateCanvas();
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateCanvas}
            variant="contained"
            disabled={createCanvas.isPending}
          >
            {createCanvas.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Canvas action menu */}
      <Menu
        anchorEl={menuAnchor?.element}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleDuplicate}>
          <ListItemIcon>
            <DuplicateIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
      </Menu>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Delete canvases?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete {selectedCanvasIds.size} canvas
            {selectedCanvasIds.size === 1 ? "" : "es"}? This action cannot be
            undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleBulkDelete}
            variant="contained"
            color="error"
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <GlobalSearchDialog
        open={searchDialogOpen}
        onClose={() => setSearchDialogOpen(false)}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onCreateCanvas={() => setCreateDialogOpen(true)}
        onSearch={() => setSearchDialogOpen(true)}
        onToggleTheme={toggleTheme}
        isDarkMode={mode === "dark"}
      />
    </>
  );
}
