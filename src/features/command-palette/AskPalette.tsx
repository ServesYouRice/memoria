"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  AutoAwesomeOutlined as AskIcon,
  Close as CloseIcon,
  Send as SendIcon,
} from "@mui/icons-material";
import { apiFetch } from "@/lib/api/fetch-client";
import {
  useApproveSuggestion,
  useExecuteSuggestion,
  useRejectSuggestion,
  useRevertChangeSet,
} from "@/lib/hooks/use-agent-control";
import { hasActiveDialog } from "@/lib/keyboard/shortcuts";
import { isAskShortcut } from "./ask-shortcut";

interface AskSource {
  itemId: string;
  canvasId: string;
  canvasName: string;
  type: string;
  title: string;
  url: string | null;
  href: string;
}

export interface AskResponse {
  answer: string;
  sources: AskSource[];
  suggestion: { id: string; summary: string; kind: string } | null;
  commandRejected: string | null;
  commandError?: string;
  retrievedCount: number;
}

const REJECTION_TEXT: Record<string, string> = {
  "not-allowed":
    "That is not something Ask can do. It can create a board, move items, make a pile or archive.",
  "unknown-reference":
    "The proposed change named items I could not find, so I left it out.",
  invalid: "The proposed change was not complete, so I left it out.",
};

async function postAsk(question: string): Promise<AskResponse> {
  const response = await apiFetch("/api/v1/ai/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const body = (await response.json().catch(() => null)) as
    (AskResponse & { error?: string; message?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(
      body?.message || body?.error || "Ask is not available right now.",
    );
  }
  return body;
}

/**
 * IMP-068 — one box to ask your boards or tell them what to do. Commands
 * arrive as suggestions; nothing changes until the user approves here (or in
 * Settings → Agents), and an applied change can be undone.
 */
export function AskPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [settled, setSettled] = useState<string | null>(null);
  const approve = useApproveSuggestion();
  const execute = useExecuteSuggestion();
  const reject = useRejectSuggestion();
  const revert = useRevertChangeSet();
  const controller = useRef<AbortController | null>(null);
  // The suggestion already approved on the server; a retry after a failed
  // execution must not approve it again (only OPEN suggestions approve).
  const [approvedId, setApprovedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      controller.current?.abort();
      setQuestion("");
      setResult(null);
      setError(null);
      setSettled(null);
      setApprovedId(null);
    }
  }, [open]);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length < 2 || asking) return;
    setAsking(true);
    setError(null);
    setResult(null);
    setSettled(null);
    setApprovedId(null);
    try {
      setResult(await postAsk(trimmed));
    } catch (askError) {
      setError(
        askError instanceof Error ? askError.message : "Ask failed. Try again.",
      );
    } finally {
      setAsking(false);
    }
  }

  async function approveSuggestion() {
    const suggestion = result?.suggestion;
    if (!suggestion) return;
    setApplying(true);
    setError(null);
    try {
      if (approvedId !== suggestion.id) {
        await approve.mutateAsync(suggestion.id);
        setApprovedId(suggestion.id);
      }
      const executed = (await execute.mutateAsync(suggestion.id)) as {
        executed?: { changeSetId?: string };
      };
      const changeSetId = executed.executed?.changeSetId;
      setSettled("Done.");
      toast.success(
        suggestion.summary,
        changeSetId
          ? {
              action: {
                label: "Undo",
                onClick: () => {
                  revert
                    .mutateAsync(changeSetId)
                    .then(() => toast.success("Undone"))
                    .catch(() => toast.error("That could not be undone"));
                },
              },
            }
          : undefined,
      );
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "The change could not be applied.",
      );
    } finally {
      setApplying(false);
    }
  }

  async function dismissSuggestion() {
    const suggestion = result?.suggestion;
    if (!suggestion) return;
    await reject.mutateAsync(suggestion.id).catch(() => undefined);
    setSettled("Dismissed. Nothing changed.");
  }

  const rejection = result?.commandRejected
    ? result.commandRejected === "failed"
      ? result.commandError || "The change could not be filed."
      : REJECTION_TEXT[result.commandRejected]
    : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      aria-labelledby="ask-palette-title"
      slotProps={{
        paper: { sx: { borderRadius: fullScreen ? 0 : 2, overflow: "hidden" } },
      }}
    >
      <Box
        component="form"
        onSubmit={submit}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <AskIcon color="primary" aria-hidden />
        <Typography id="ask-palette-title" sx={visuallyHidden}>
          Ask Memoria
        </Typography>
        <InputBase
          autoFocus
          fullWidth
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask your boards, or tell them what to do"
          inputProps={{ "aria-label": "Ask Memoria", maxLength: 1000 }}
        />
        <IconButton
          type="submit"
          aria-label="Ask"
          disabled={asking || question.trim().length < 2}
        >
          {asking ? <CircularProgress size={20} /> : <SendIcon />}
        </IconButton>
        {fullScreen && (
          <IconButton aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </Box>
      <DialogContent sx={{ minHeight: 120 }}>
        {!result && !error && !asking && (
          <Typography variant="body2" color="text.secondary">
            Try “what was that knife site I saved?” or “make a Japan board from
            everything about Japan”. Answers come only from your own boards, and
            changes wait for your approval.
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {result && (
          <Stack spacing={2}>
            <Typography sx={{ whiteSpace: "pre-wrap" }}>
              {result.answer}
            </Typography>
            {result.sources.length > 0 && (
              <Box>
                <Typography variant="overline" color="text.secondary">
                  From your items
                </Typography>
                <List dense disablePadding>
                  {result.sources.map((source) => (
                    <ListItemButton
                      key={source.itemId}
                      component={Link}
                      href={source.href}
                      onClick={onClose}
                      sx={{ borderRadius: 1 }}
                    >
                      <ListItemText
                        primary={source.title}
                        secondary={`${source.canvasName}${source.url ? ` · ${source.url}` : ""}`}
                        slotProps={{
                          primary: { noWrap: true },
                          secondary: { noWrap: true },
                        }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            )}
            {rejection && <Alert severity="info">{rejection}</Alert>}
            {result.suggestion && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="overline" color="text.secondary">
                  Suggested change
                </Typography>
                <Typography sx={{ mb: 1.5 }}>
                  {result.suggestion.summary}
                </Typography>
                {settled ? (
                  <Typography variant="body2" color="text.secondary">
                    {settled}
                  </Typography>
                ) : (
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      onClick={() => void approveSuggestion()}
                      disabled={applying}
                    >
                      {applying
                        ? "Applying…"
                        : approvedId === result.suggestion.id
                          ? "Retry"
                          : "Approve"}
                    </Button>
                    <Button
                      onClick={() => void dismissSuggestion()}
                      disabled={applying}
                    >
                      Dismiss
                    </Button>
                  </Stack>
                )}
              </Paper>
            )}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/**
 * Opens Ask from anywhere in the app shell: Ctrl/⌘+J on desktop, a search
 * bar in the top bar on phones.
 */
export function AskLauncher() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAskShortcut(event)) return;
      if (!open && hasActiveDialog()) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <ButtonBase
        onClick={() => setOpen(true)}
        aria-label="Ask Memoria"
        sx={{
          display: { xs: "flex", md: "none" },
          flexGrow: 1,
          minWidth: 0,
          justifyContent: "flex-start",
          gap: 1,
          px: 1.5,
          py: 0.75,
          borderRadius: 999,
          // Secondary text on this tint can fall below 4.5:1 contrast (axe
          // flagged it on the dashboard at 768px).
          color: "text.primary",
          bgcolor: (theme) => alpha(theme.palette.text.primary, 0.06),
        }}
      >
        <AskIcon fontSize="small" />
        <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
          Ask your boards…
        </Typography>
      </ButtonBase>
      <Tooltip title="Ask Memoria (Ctrl+J)">
        <IconButton
          aria-label="Ask Memoria"
          aria-keyshortcuts="Control+J Meta+J"
          onClick={() => setOpen(true)}
          sx={{ display: { xs: "none", md: "inline-flex" } }}
        >
          <AskIcon />
        </IconButton>
      </Tooltip>
      {/* Mounted only while open, so the shell carries no AI state. */}
      {open && <AskPalette open onClose={close} />}
    </>
  );
}
