"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Paper,
  TextField,
  Typography,
  Alert,
  alpha,
} from "@mui/material";
import {
  Add as AddIcon,
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
  canvasKeys,
} from "@/lib/hooks/use-canvases";
import { useWorkspace } from "@/lib/hooks/use-workspaces";
import { ActivityFeed } from "./ActivityFeed";
import { StarterRow } from "./StarterRow";
import { CanvasCard, CanvasCardSkeleton, CardGrid } from "./CanvasCard";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { useThemeMode } from "@/lib/theme-context";
import { canvasThumbnailUrl } from "@/lib/thumbnails/url";
import { apiFetch } from "@/lib/api/fetch-client";
import { deleteCanvasesBounded, removeCanvasesFromPages } from "./bulk-delete";

export function DashboardContent({ userName }: { userName?: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const workspaceId = searchParams.get("workspace");
  const { data: workspaceData } = useWorkspace(workspaceId || undefined);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [showActivity, setShowActivity] = useState(true);
  const [newCanvasName, setNewCanvasName] = useState("");
  const createInFlightRef = useRef(false);
  const [selectedCanvasIds, setSelectedCanvasIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const {
    data: canvasesData,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useCanvases(workspaceId || undefined);
  const createCanvas = useCreateCanvas();
  const { mode, toggleTheme } = useThemeMode();

  const canvases = useMemo(() => {
    return canvasesData?.pages.flatMap((page) => page.canvases) ?? [];
  }, [canvasesData]);

  // The workspace filter is a search param, so changing it keeps this
  // component mounted. A selection made in another view must not carry over
  // into a bulk delete of canvases that are no longer on screen.
  useEffect(() => {
    setSelectedCanvasIds(new Set());
    setDeleteConfirmOpen(false);
  }, [workspaceId]);

  // Only selected canvases that are in the visible list can be deleted.
  const visibleSelectedIds = useMemo(() => {
    const visible = new Set(canvases.map((canvas) => canvas.id));
    return Array.from(selectedCanvasIds).filter((id) => visible.has(id));
  }, [canvases, selectedCanvasIds]);

  const handleCreateCanvas = async () => {
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
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
    } finally {
      createInFlightRef.current = false;
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

  // Outside selection mode the card is a link and opens the canvas itself.
  const handleCanvasClick = (canvasId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    toggleCanvasSelection(canvasId);
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) setSelectedCanvasIds(new Set());
  };

  const handleBulkDelete = async () => {
    const ids = visibleSelectedIds;
    if (ids.length === 0) return;
    setIsDeleting(true);

    try {
      // apiFetch shares the 401 sign-in redirect and reads the problem detail.
      const result = await deleteCanvasesBounded(ids, (id) =>
        apiFetch(`/api/v1/canvases/${id}`, { method: "DELETE" }),
      );
      const succeeded = result.deleted.length;
      const plural = (count: number) =>
        `${count} canvas${count === 1 ? "" : "es"}`;

      if (result.failed.length === 0 && result.notAttempted.length === 0) {
        toast.success(`Deleted ${plural(succeeded)}`);
        setSelectedCanvasIds(new Set());
        setSelectionMode(false);
      } else {
        const unfinished = result.failed.length + result.notAttempted.length;
        const reason = result.rateLimited
          ? `Rate limit reached; try again${
              result.retryAfterSeconds != null
                ? ` in ${result.retryAfterSeconds} seconds`
                : " shortly"
            }.`
          : (result.failed.find((failure) => failure.detail)?.detail ??
            "Failed to delete canvas");
        const message =
          succeeded > 0
            ? `Deleted ${plural(succeeded)}, ${unfinished} not deleted. ${reason}`
            : `Failed to delete selected canvases. ${reason}`;
        if (succeeded > 0) toast.warning(message);
        else toast.error(message);
        setSelectedCanvasIds(
          new Set([
            ...result.failed.map((failure) => failure.id),
            ...result.notAttempted,
          ]),
        );
      }
      setDeleteConfirmOpen(false);

      const deleted = new Set(result.deleted);
      queryClient.setQueriesData({ queryKey: canvasKeys.all }, (data) =>
        removeCanvasesFromPages(data, deleted),
      );
      // After a 429 the canvases budget is spent; mark the lists stale
      // without refetching straight into the exhausted window.
      await queryClient.invalidateQueries(
        result.rateLimited
          ? { queryKey: canvasKeys.all, refetchType: "none" }
          : { queryKey: canvasKeys.all },
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const hasCanvases = canvases.length > 0;
  const workspaceName = workspaceData?.name;

  const totalCount =
    canvasesData?.pages[0]?.pagination.total ?? canvases.length;

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
                : `${totalCount} canvas${totalCount === 1 ? "" : "es"}`
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

      {!workspaceId && !selectionMode && (
        <StarterRow onBlankCanvas={() => setCreateDialogOpen(true)} />
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: showActivity ? "minmax(0, 1fr) 320px" : "1fr",
          },
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
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                  }}
                >
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
                    {canvases.length < totalCount
                      ? `Select all loaded (${canvases.length})`
                      : "Select all"}
                  </Button>
                )}
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
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
            <>
              <CardGrid>
                {canvases.map((canvas, index) => (
                  <CanvasCard
                    key={canvas.id}
                    name={canvas.name}
                    thumbnail={canvasThumbnailUrl(canvas)}
                    index={index}
                    selected={selectedCanvasIds.has(canvas.id)}
                    meta={`Updated ${formatDistanceToNow(new Date(canvas.updatedAt), { addSuffix: true })}`}
                    href={selectionMode ? undefined : `/canvas/${canvas.id}`}
                    onClick={
                      selectionMode
                        ? (e) => handleCanvasClick(canvas.id, e)
                        : undefined
                    }
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
                      ) : undefined
                    }
                  />
                ))}
              </CardGrid>
              {hasNextPage && (
                <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
                  <Button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more canvases"}
                  </Button>
                </Box>
              )}
            </>
          )}
        </Box>

        {/* Activity feed: stacked below the canvases on small screens and
            left out when there is nothing to show, so the cards use the
            width (IMP-083). */}
        {showActivity && (
          <Paper
            variant="outlined"
            data-testid="activity-feed-panel"
            sx={{
              p: 2.5,
              position: { xs: "static", md: "sticky" },
              top: 80,
              borderRadius: 3,
            }}
          >
            <ActivityFeed limit={15} onHasActivity={setShowActivity} />
          </Paper>
        )}
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
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreateCanvas();
              }
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

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Delete canvases?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete {visibleSelectedIds.length} canvas
            {visibleSelectedIds.length === 1 ? "" : "es"}? This action cannot be
            undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleBulkDelete}
            variant="contained"
            color="error"
            disabled={isDeleting || visibleSelectedIds.length === 0}
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
