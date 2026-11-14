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
  IconButton,
  InputAdornment,
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
  UploadFile,
} from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import {
  useCanvases,
  useCreateCanvas,
  useDuplicateCanvas,
  useUpdateCanvas,
  canvasKeys,
  type CanvasListSort,
} from "@/lib/hooks/use-canvases";
import {
  useAssignCanvasToWorkspace,
  useWorkspace,
} from "@/lib/hooks/use-workspaces";
import { ActivityFeed } from "./ActivityFeed";
import { StarterRow } from "./StarterRow";
import { ImportCanvasDialog } from "./ImportCanvasDialog";
import { SomethingOldCard } from "./SomethingOldCard";
import { BLANK_TEMPLATE, TemplatePicker } from "./TemplatePicker";
import { useCreateFromTemplate, useTemplates } from "@/lib/hooks/use-templates";
import { CanvasCard, CanvasCardSkeleton, CardGrid } from "./CanvasCard";
import { CanvasCardMenu } from "./CanvasCardMenu";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { canvasThumbnailUrl } from "@/lib/thumbnails/url";
import { apiFetch } from "@/lib/api/fetch-client";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";
import {
  deleteCanvasesBounded,
  removeCanvasesFromPages,
  restoreCanvasesBounded,
} from "./bulk-delete";

const canvasCount = (count: number) =>
  `${count} canvas${count === 1 ? "" : "es"}`;

const SORT_STORAGE_KEY = "memoria.dashboard.sort";
const SORT_LABELS: Record<CanvasListSort, string> = {
  updated: "Recently updated",
  name: "Name (A to Z)",
  created: "Newest first",
};

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
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // `/templates` lands here with `?new=1`: open "New canvas" once, then
  // drop the parameter so a refresh does not reopen it (IMP-126).
  const openNewCanvas = searchParams.get("new") === "1";
  useEffect(() => {
    if (!openNewCanvas) return;
    setCreateDialogOpen(true);
    router.replace("/dashboard");
  }, [openNewCanvas, router]);

  // IMP-136: sort and name filter run on the server, so they reach canvases
  // that are not loaded yet.
  const [sort, setSort] = useState<CanvasListSort>("updated");
  const [filterText, setFilterText] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (saved && saved in SORT_LABELS) setSort(saved as CanvasListSort);
    } catch {
      // Storage can be blocked; the default order still works.
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilterQuery(filterText.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [filterText]);
  const changeSort = (next: CanvasListSort) => {
    setSort(next);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      // Remembering the choice is a convenience only.
    }
  };
  const clearFilter = () => {
    setFilterText("");
    setFilterQuery("");
  };

  // The unfiltered list counts every canvas for the header; with the default
  // sort and no filter both calls share one cached query.
  const { data: allCanvasesData } = useCanvases(workspaceId || undefined);
  const {
    data: canvasesData,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useCanvases(workspaceId || undefined, {
    sort,
    ...(filterQuery ? { q: filterQuery } : {}),
  });
  const createCanvas = useCreateCanvas();
  // IMP-098: "New canvas" can start from a built-in template.
  const [startFrom, setStartFrom] = useState(BLANK_TEMPLATE);
  const templates = useTemplates(createDialogOpen);
  const createFromTemplate = useCreateFromTemplate();
  const creating = createCanvas.isPending || createFromTemplate.isPending;
  // IMP-098: a private copy of one of the person's canvases.
  const duplicateCanvas = useDuplicateCanvas();
  // IMP-137: the card menu renames and moves canvases.
  const updateCanvas = useUpdateCanvas();
  const assignToWorkspace = useAssignCanvasToWorkspace();
  const handleDuplicate = async (canvasId: string) => {
    try {
      const copy = await duplicateCanvas.mutateAsync(canvasId);
      toast.success(`Made “${copy.name}”`, {
        action: {
          label: "Open",
          onClick: () => router.push(`/canvas/${copy.id}`),
        },
      });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "The canvas could not be copied.",
      );
    }
  };

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
      const input = {
        name: newCanvasName || undefined,
        workspaceId: workspaceId || undefined,
      };
      const canvas =
        startFrom === BLANK_TEMPLATE
          ? await createCanvas.mutateAsync(input)
          : await createFromTemplate.mutateAsync({
              ...input,
              templateId: startFrom,
            });
      setCreateDialogOpen(false);
      setNewCanvasName("");
      setStartFrom(BLANK_TEMPLATE);
      router.push(`/canvas/${canvas.id}`);
    } catch (error) {
      // The server says why, e.g. the canvas limit was reached.
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to create canvas",
      );
    } finally {
      createInFlightRef.current = false;
    }
  };

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

  // A card menu's Delete selects just that canvas outside selection mode;
  // cancelling must not leave it selected.
  const closeDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    if (!selectionMode) setSelectedCanvasIds(new Set());
  };

  // Undo of a bulk delete (IMP-133): the canvases come back from Trash.
  const undoBulkDelete = async (ids: string[]) => {
    const result = await restoreCanvasesBounded(ids, (id) =>
      apiFetch(`/api/v1/canvases/${id}/restore`, { method: "POST" }),
    );
    const refetchType = result.rateLimited ? "none" : undefined;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: canvasKeys.all, refetchType }),
      queryClient.invalidateQueries({ queryKey: ["trash"], refetchType }),
    ]);
    const left = result.stillInTrash.length;
    if (left === 0) {
      toast.success("Restored");
    } else if (result.restored.length > 0) {
      toast.warning(
        `Restored ${canvasCount(result.restored.length)}. ${canvasCount(left)} could not be restored and ${left === 1 ? "is" : "are"} still in Trash.`,
      );
    } else {
      toast.error(
        `Could not restore ${canvasCount(left)}. ${left === 1 ? "It is" : "They are"} still in Trash.`,
      );
    }
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
      const moved = [...result.deleted];
      const undo = {
        // Long enough to read and reach the button (at least 8 seconds).
        duration: 10_000,
        action: { label: "Undo", onClick: () => void undoBulkDelete(moved) },
      };

      if (result.failed.length === 0 && result.notAttempted.length === 0) {
        toast.success(`${canvasCount(succeeded)} moved to Trash`, undo);
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
        if (succeeded > 0)
          toast.warning(
            `${canvasCount(succeeded)} moved to Trash, ${unfinished} not moved. ${reason}`,
            undo,
          );
        else
          toast.error(
            `Could not move the selected canvases to Trash. ${reason}`,
          );
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
  const allCount = allCanvasesData?.pages[0]?.pagination.total ?? totalCount;
  const filtering = filterQuery.length > 0;
  const showListControls =
    !selectionMode && (allCount > 0 || filterText.length > 0 || filtering);

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
                : `${allCount} canvas${allCount === 1 ? "" : "es"}`
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
              variant="outlined"
              startIcon={<UploadFile />}
              onClick={() => setImportDialogOpen(true)}
            >
              Import
            </Button>
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

      {!workspaceId && !selectionMode && <StarterRow />}

      {!workspaceId && !selectionMode && <SomethingOldCard />}

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

          {showListControls && (
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                gap: 1.5,
                mb: 2,
              }}
            >
              <TextField
                size="small"
                label="Filter by name"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                slotProps={{
                  htmlInput: { maxLength: 100 },
                  input: {
                    endAdornment: filterText ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label="Clear name filter"
                          onClick={clearFilter}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  },
                }}
                sx={{ width: { xs: "100%", sm: 260 } }}
              />
              <TextField
                select
                size="small"
                label="Sort by"
                value={sort}
                onChange={(e) => changeSort(e.target.value as CanvasListSort)}
                slotProps={{ select: { native: true } }}
                sx={{ width: { xs: "100%", sm: 200 } }}
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </TextField>
            </Box>
          )}

          {!isLoading && !hasCanvases && filtering && (
            <Box sx={{ py: 6, textAlign: "center" }}>
              <Typography sx={{ mb: 2 }}>
                {`No canvases match "${filterQuery}"`}
              </Typography>
              <Button variant="outlined" onClick={clearFilter}>
                Clear filter
              </Button>
            </Box>
          )}

          {!isLoading && !hasCanvases && !filtering && (
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
                      ) : (
                        <CanvasCardMenu
                          canvas={canvas}
                          onRename={(name) =>
                            updateCanvas.mutateAsync({
                              canvasId: canvas.id,
                              data: { name },
                            })
                          }
                          onDuplicate={() => void handleDuplicate(canvas.id)}
                          onMove={(target) =>
                            assignToWorkspace.mutateAsync({
                              canvasId: canvas.id,
                              workspaceId: target,
                            })
                          }
                          deleteLabel="Move to Trash"
                          onDelete={() => {
                            setSelectedCanvasIds(new Set([canvas.id]));
                            setDeleteConfirmOpen(true);
                          }}
                        />
                      )
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
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Create new canvas</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 2 }}>
          <TextField
            autoFocus
            margin="dense"
            label="Canvas name"
            type="text"
            fullWidth
            variant="outlined"
            value={newCanvasName}
            onChange={(e) => setNewCanvasName(e.target.value)}
            placeholder={
              templates.data?.templates.find((t) => t.id === startFrom)?.name ??
              "Untitled Canvas"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreateCanvas();
              }
            }}
          />
          <Typography variant="subtitle2">Start from</Typography>
          <TemplatePicker
            templates={templates.data?.templates}
            loading={templates.isLoading}
            value={startFrom}
            onChange={setStartFrom}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateCanvas}
            variant="contained"
            disabled={creating}
          >
            {creating ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <ImportCanvasDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onOpenCanvas={(canvasId) => router.push(`/canvas/${canvasId}`)}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmOpen} onClose={closeDeleteConfirm}>
        <DialogTitle sx={{ fontWeight: 600 }}>
          Move {canvasCount(visibleSelectedIds.length)} to Trash?
        </DialogTitle>
        <DialogContent>
          <Typography>
            You can restore {visibleSelectedIds.length === 1 ? "it" : "them"}{" "}
            from Trash for {LAUNCH_LIMITS.trashRetentionDays} days.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={closeDeleteConfirm}>Cancel</Button>
          <Button
            onClick={handleBulkDelete}
            variant="contained"
            color="error"
            disabled={isDeleting || visibleSelectedIds.length === 0}
          >
            {isDeleting ? "Moving…" : "Move to Trash"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
