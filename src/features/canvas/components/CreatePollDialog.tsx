"use client";

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
} from "@mui/material";
import { Close as RemoveIcon } from "@mui/icons-material";
import { useCreateCanvasItem } from "@/lib/hooks/use-canvas-items";
import { ItemType } from "@/types/canvas";
import { pollContentSchema } from "@/lib/validation/canvas-item";
import { POLL_MAX_CHOICES } from "@/lib/polls/limits";
import { pollHeight } from "./PollItem";

interface CreatePollDialogProps {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  initialPosition?: { x: number; y: number };
}

interface Choice {
  id: string;
  text: string;
}

function newChoice(): Choice {
  return { id: crypto.randomUUID(), text: "" };
}

/** IMP-104: an editor adds a poll; votes are counted on the server. */
export function CreatePollDialog({
  open,
  onClose,
  canvasId,
  initialPosition = { x: 100, y: 100 },
}: CreatePollDialogProps) {
  const createItem = useCreateCanvasItem();
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState<Choice[]>(() => [
    newChoice(),
    newChoice(),
  ]);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setQuestion("");
    setChoices([newChoice(), newChoice()]);
    setMultipleChoice(false);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const options = choices
      .map((choice) => ({ id: choice.id, text: choice.text.trim() }))
      .filter((choice) => choice.text);
    const content = pollContentSchema.safeParse({
      question,
      options,
      multipleChoice,
    });
    if (!content.success) {
      setError(
        !question.trim()
          ? "Write a question."
          : "Give the poll at least two choices.",
      );
      return;
    }
    try {
      setError(null);
      await createItem.mutateAsync({
        canvasId,
        type: ItemType.POLL,
        positionX: initialPosition.x,
        positionY: initialPosition.y,
        width: 320,
        height: pollHeight(content.data.options.length),
        zIndex: 0,
        content: content.data,
        tags: [],
      });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The poll was not added.");
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Add a poll</DialogTitle>
      <form onSubmit={submit} noValidate>
        <DialogContent>
          <Stack spacing={2}>
            <TextField
              label="Question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              autoFocus
              fullWidth
            />
            {choices.map((choice, index) => (
              <Box
                key={choice.id}
                sx={{ display: "flex", gap: 1, alignItems: "center" }}
              >
                <TextField
                  label={`Choice ${index + 1}`}
                  value={choice.text}
                  onChange={(event) =>
                    setChoices((current) =>
                      current.map((entry) =>
                        entry.id === choice.id
                          ? { ...entry, text: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                  fullWidth
                  size="small"
                />
                <IconButton
                  aria-label={`Remove choice ${index + 1}`}
                  disabled={choices.length <= 2}
                  onClick={() =>
                    setChoices((current) =>
                      current.filter((entry) => entry.id !== choice.id),
                    )
                  }
                >
                  <RemoveIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Box>
              <Button
                onClick={() =>
                  setChoices((current) => [...current, newChoice()])
                }
                disabled={choices.length >= POLL_MAX_CHOICES}
              >
                Add a choice
              </Button>
            </Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={multipleChoice}
                  onChange={(event) => setMultipleChoice(event.target.checked)}
                />
              }
              label="People can pick more than one"
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createItem.isPending}
          >
            Add poll
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
