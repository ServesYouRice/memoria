"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
  TextField,
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

const INSTRUCTION_MAX_LENGTH = 1_000;

interface SortIntoPilesDialogProps {
  canvasId: string;
  open: boolean;
  onClose: () => void;
  /** Called once the piles are on the board. */
  onApplied?: () => void;
}

/**
 * Previews the built-in organizer's piles. With AI set up, the piles follow
 * the optional instruction, which starts as the latest batch note. Applying
 * approves and runs the suggestion as one change set, so a single Undo
 * restores the board.
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
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const [applying, setApplying] = useState(false);
  const requested = useRef(false);
  // Each sort (and each close) bumps the generation; callbacks of an older
  // request see a newer generation and leave the current state alone.
  const generationRef = useRef(0);

  const runSort = useCallback(
    (nextInstruction?: string) => {
      const generation = ++generationRef.current;
      const isCurrent = () => generation === generationRef.current;
      setSorting(true);
      setError(null);
      organize
        .mutateAsync({ canvasId, instruction: nextInstruction })
        .then((result) => {
          if (!isCurrent()) {
            // Nobody will see or dismiss this proposal; do not leave it open.
            if (result.suggestionId) {
              reject.mutateAsync(result.suggestionId).catch(() => undefined);
            }
            return;
          }
          setProposal(result);
          if (nextInstruction === undefined) {
            setInstruction(result.instruction ?? "");
          }
        })
        .catch((organizeError: unknown) => {
          if (!isCurrent()) return;
          setError(
            organizeError instanceof Error
              ? organizeError.message
              : "Could not sort this board.",
          );
        })
        .finally(() => {
          if (isCurrent()) setSorting(false);
        });
    },
    [canvasId, organize, reject],
  );

  useEffect(() => {
    if (!open) {
      generationRef.current += 1;
      requested.current = false;
      setProposal(null);
      setInstruction("");
      setError(null);
      setSorting(false);
      return;
    }
    if (requested.current) return;
    requested.current = true;
    runSort();
  }, [open, runSort]);

  async function sortAgain() {
    if (proposal?.suggestionId) {
      await reject.mutateAsync(proposal.suggestionId).catch(() => undefined);
    }
    setProposal(null);
    runSort(instruction.trim());
  }

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

  const loading = sorting || (!proposal && !error);
  const empty = !sorting && proposal && proposal.piles.length === 0;
  const busy = sorting || applying;

  return (
    <Dialog open={open} onClose={() => void dismiss()} fullWidth maxWidth="xs">
      <DialogTitle>Sort into piles</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <TextField
            label="How should it sort? (optional)"
            placeholder="By project; anything about travel together"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            multiline
            minRows={2}
            maxRows={5}
            size="small"
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: INSTRUCTION_MAX_LENGTH } }}
            helperText="Used when AI is set up in Settings."
            sx={{ mt: 1 }}
          />
          {loading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={28} aria-label="Finding piles" />
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {!sorting && proposal?.notice && (
            <Alert severity="warning">{proposal.notice}</Alert>
          )}
          {empty && (
            <Alert severity="info">
              No piles found. Loose items need shared tags, words or websites to
              be grouped.
            </Alert>
          )}
          {!sorting && proposal && proposal.piles.length > 0 && (
            <Stack spacing={1.5}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {proposal.method === "ai" ? "Sorted by AI. " : ""}Each pile
                becomes a titled frame with its items inside. Items that fit
                nowhere stay where they are.
              </Typography>
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                {proposal.piles.map((pile, index) => (
                  <Chip
                    key={`${pile.title}-${index}`}
                    label={`${pile.title} · ${pile.itemCount}`}
                    variant="outlined"
                  />
                ))}
              </Stack>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => void dismiss()} disabled={applying}>
          {proposal?.suggestionId ? "Not now" : "Close"}
        </Button>
        <Button onClick={() => void sortAgain()} disabled={busy}>
          Sort again
        </Button>
        {proposal?.suggestionId && !sorting && (
          <Button
            variant="contained"
            onClick={() => void apply()}
            disabled={busy}
          >
            {applying ? "Sorting…" : "Apply"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
