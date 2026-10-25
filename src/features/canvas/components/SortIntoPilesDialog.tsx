"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { toast } from "sonner";
import {
  useApproveSuggestion,
  useExecuteSuggestion,
  useOrganizeCanvas,
  useRejectSuggestion,
  useRevertChangeSet,
  type OrganizeCanvasResponse,
} from "@/lib/hooks/use-agent-control";

interface SortIntoPilesDialogProps {
  canvasId: string;
  open: boolean;
  onClose: () => void;
  /** Called once the piles are on the board. */
  onApplied?: () => void;
}

/**
 * Previews the built-in organizer's piles. Applying approves and runs the
 * suggestion as one change set, so a single Undo restores the board.
 */
export function SortIntoPilesDialog({
  canvasId,
  open,
  onClose,
  onApplied,
}: SortIntoPilesDialogProps) {
  const organize = useOrganizeCanvas();
  const approve = useApproveSuggestion();
  const execute = useExecuteSuggestion();
  const reject = useRejectSuggestion();
  const revert = useRevertChangeSet();
  const [proposal, setProposal] = useState<OrganizeCanvasResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (!open) {
      requested.current = false;
      setProposal(null);
      setError(null);
      return;
    }
    if (requested.current) return;
    requested.current = true;
    organize
      .mutateAsync(canvasId)
      .then(setProposal)
      .catch((organizeError: unknown) =>
        setError(
          organizeError instanceof Error
            ? organizeError.message
            : "Could not sort this board.",
        ),
      );
  }, [canvasId, open, organize]);

  async function dismiss() {
    if (proposal?.suggestionId) {
      await reject.mutateAsync(proposal.suggestionId).catch(() => undefined);
    }
    onClose();
  }

  async function apply() {
    if (!proposal?.suggestionId) return;
    setApplying(true);
    setError(null);
    try {
      await approve.mutateAsync(proposal.suggestionId);
      const result = (await execute.mutateAsync(proposal.suggestionId)) as {
        executed?: { changeSetId?: string; movedItemCount?: number };
      };
      const changeSetId = result.executed?.changeSetId;
      onClose();
      onApplied?.();
      toast.success(
        `Sorted ${result.executed?.movedItemCount ?? 0} items into ${proposal.piles.length} piles`,
        changeSetId
          ? {
              action: {
                label: "Undo",
                onClick: () => {
                  revert
                    .mutateAsync(changeSetId)
                    .then(() => toast.success("Sort undone"))
                    .catch(() => toast.error("The sort could not be undone"));
                },
              },
            }
          : undefined,
      );
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Could not apply the piles.",
      );
    } finally {
      setApplying(false);
    }
  }

  const loading = !proposal && !error;
  const empty = proposal && proposal.piles.length === 0;

  return (
    <Dialog open={open} onClose={() => void dismiss()} fullWidth maxWidth="xs">
      <DialogTitle>Sort into piles</DialogTitle>
      <DialogContent>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={28} aria-label="Finding piles" />
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {empty && (
          <Alert severity="info">
            No piles found. Loose items need shared tags, words or websites to
            be grouped.
          </Alert>
        )}
        {proposal && proposal.piles.length > 0 && (
          <Stack spacing={1.5}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Each pile becomes a titled frame with its items inside. Items that
              fit nowhere stay where they are.
            </Typography>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              {proposal.piles.map((pile) => (
                <Chip
                  key={pile.title}
                  label={`${pile.title} · ${pile.itemCount}`}
                  variant="outlined"
                />
              ))}
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => void dismiss()} disabled={applying}>
          {proposal?.suggestionId ? "Not now" : "Close"}
        </Button>
        {proposal?.suggestionId && (
          <Button
            variant="contained"
            onClick={() => void apply()}
            disabled={applying}
          >
            {applying ? "Sorting…" : "Apply"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
