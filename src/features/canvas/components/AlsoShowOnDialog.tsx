"use client";

import React from "react";
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Stack,
} from "@mui/material";
import { toast } from "sonner";
import { useCanvases } from "@/lib/hooks/use-canvases";
import {
  useAddPlacement,
  useItemPlacements,
  useRemovePlacement,
} from "@/features/canvas/hooks/use-placements";

/**
 * IMP-109: "Also show on…" — tick the canvases this item should also show
 * on. It stays one item: an edit on any of them is an edit everywhere.
 */
export function AlsoShowOnDialog({
  itemId,
  onClose,
}: {
  itemId: string | null;
  onClose: () => void;
}) {
  return itemId === null ? null : (
    <AlsoShowOnBody key={itemId} itemId={itemId} onClose={onClose} />
  );
}

function AlsoShowOnBody({
  itemId,
  onClose,
}: {
  itemId: string;
  onClose: () => void;
}) {
  const placements = useItemPlacements(itemId);
  const canvases = useCanvases();
  const add = useAddPlacement(itemId);
  const remove = useRemovePlacement();
  const busy = add.isPending || remove.isPending;

  const homeCanvasId = placements.data?.homeCanvasId;
  const shownOn = new Map(
    (placements.data?.placements ?? []).map((placement) => [
      placement.canvasId,
      placement,
    ]),
  );
  const options = (canvases.data?.pages ?? [])
    .flatMap((page) => page.canvases)
    .filter((canvas) => canvas.id !== homeCanvasId);

  const toggle = (canvasId: string, checked: boolean) => {
    const failed = (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "That did not work.",
      );
    if (checked) {
      add.mutate(canvasId, { onError: failed });
      return;
    }
    const placement = shownOn.get(canvasId);
    if (placement)
      remove.mutate(
        { canvasId, placementId: placement.id, itemId },
        { onError: failed },
      );
  };

  const loading = placements.isLoading || canvases.isLoading;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Also show on…</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          It stays one item: change it once and it changes everywhere. Elsewhere
          it is read-only; you edit it here.
        </DialogContentText>
        {placements.isError && (
          <Alert severity="info">
            Only the owner of this canvas can show its items elsewhere.
          </Alert>
        )}
        {loading && <CircularProgress size={24} />}
        {!loading && !placements.isError && options.length === 0 && (
          <Alert severity="info">You have no other canvases yet.</Alert>
        )}
        {!placements.isError && (
          <Stack>
            {options.map((canvas) => (
              <FormControlLabel
                key={canvas.id}
                control={
                  <Checkbox
                    checked={shownOn.has(canvas.id)}
                    disabled={busy}
                    onChange={(event) =>
                      toggle(canvas.id, event.target.checked)
                    }
                  />
                }
                label={canvas.name}
              />
            ))}
          </Stack>
        )}
        {canvases.hasNextPage && (
          <Button
            size="small"
            onClick={() => void canvases.fetchNextPage()}
            disabled={canvases.isFetchingNextPage}
          >
            Show more canvases
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
