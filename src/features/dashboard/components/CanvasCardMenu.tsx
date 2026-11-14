"use client";

import React, { useState } from "react";
import NextLink from "next/link";
import { toast } from "sonner";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { Check as CheckIcon, MoreHoriz as MoreIcon } from "@mui/icons-material";
import { useWorkspaces } from "@/lib/hooks/use-workspaces";

export interface CanvasCardMenuCanvas {
  id: string;
  name: string;
  workspaceId?: string | null;
}

export interface CanvasCardMenuProps {
  canvas: CanvasCardMenuCanvas;
  /** Saves the new name; a rejection carries the reason to show. */
  onRename: (name: string) => Promise<unknown>;
  onDuplicate: () => void;
  /** Moves the canvas; `null` takes it out of its workspace. */
  onMove: (workspaceId: string | null) => Promise<unknown>;
  onDelete: () => void;
  /** "Delete" until moving to the Trash exists (IMP-133). */
  deleteLabel?: string;
  disabled?: boolean;
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

// The card is a link: clicks on this control must not open the canvas.
const stop = (event: React.SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

/**
 * IMP-137: the "..." menu on a dashboard canvas card — Rename, Duplicate,
 * Move to workspace and Delete. Only for the person's own canvases.
 */
export function CanvasCardMenu({
  canvas,
  onRename,
  onDuplicate,
  onMove,
  onDelete,
  deleteLabel = "Delete",
  disabled = false,
}: CanvasCardMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const menuId = `canvas-menu-${canvas.id}`;

  const choose = (action: () => void) => (event: React.MouseEvent) => {
    stop(event);
    setAnchor(null);
    action();
  };

  return (
    <>
      <IconButton
        size="small"
        aria-label={`Options for ${canvas.name}`}
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? "true" : undefined}
        disabled={disabled}
        onClick={(event) => {
          stop(event);
          setAnchor(event.currentTarget);
        }}
        sx={{
          bgcolor: "background.paper",
          "&:hover": { bgcolor: "background.paper" },
        }}
      >
        <MoreIcon fontSize="small" />
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        onClick={(event) => event.stopPropagation()}
      >
        <MenuItem onClick={choose(() => setRenameOpen(true))}>Rename</MenuItem>
        <MenuItem onClick={choose(onDuplicate)}>Duplicate</MenuItem>
        <MenuItem onClick={choose(() => setMoveOpen(true))}>
          Move to workspace
        </MenuItem>
        <Divider />
        <MenuItem onClick={choose(onDelete)} sx={{ color: "error.main" }}>
          {deleteLabel}
        </MenuItem>
      </Menu>
      {renameOpen && (
        <RenameCanvasDialog
          name={canvas.name}
          onRename={onRename}
          onClose={() => setRenameOpen(false)}
        />
      )}
      {moveOpen && (
        <MoveCanvasDialog
          workspaceId={canvas.workspaceId ?? null}
          onMove={onMove}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </>
  );
}

function RenameCanvasDialog({
  name,
  onRename,
  onClose,
}: {
  name: string;
  onRename: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = value.trim();
    if (!next) {
      setError("Enter a name");
      return;
    }
    setSaving(true);
    try {
      await onRename(next);
      toast.success("Renamed");
      onClose();
    } catch (failure) {
      setError(errorText(failure, "The canvas could not be renamed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <Box
        component="form"
        noValidate
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          void save();
        }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>Rename canvas</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            required
            fullWidth
            margin="dense"
            label="Name"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            error={Boolean(error)}
            helperText={error ?? " "}
            slotProps={{
              htmlInput: {
                maxLength: 255,
                onFocus: (event: React.FocusEvent<HTMLInputElement>) =>
                  event.target.select(),
              },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            Save
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function MoveCanvasDialog({
  workspaceId,
  onMove,
  onClose,
}: {
  workspaceId: string | null;
  onMove: (workspaceId: string | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useWorkspaces();
  const [moving, setMoving] = useState(false);
  const workspaces = [...(data?.workspaces ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const move = async (target: { id: string; name: string } | null) => {
    if (moving) return;
    setMoving(true);
    try {
      await onMove(target?.id ?? null);
      toast.success(
        target ? `Moved to ${target.name}` : "Removed from workspace",
      );
      onClose();
    } catch (failure) {
      toast.error(errorText(failure, "The canvas could not be moved."));
    } finally {
      setMoving(false);
    }
  };

  const row = (target: { id: string; name: string } | null, label: string) => {
    const current = (target?.id ?? null) === workspaceId;
    return (
      <ListItemButton
        key={target?.id ?? "none"}
        selected={current}
        disabled={moving}
        onClick={() => void move(target)}
      >
        <ListItemIcon sx={{ minWidth: 36 }}>
          {current && <CheckIcon fontSize="small" aria-label="Current" />}
        </ListItemIcon>
        <ListItemText primary={label} />
      </ListItemButton>
    );
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>Move to workspace</DialogTitle>
      <DialogContent sx={{ px: 1 }}>
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} aria-label="Loading workspaces" />
          </Box>
        ) : (
          <List dense>
            {row(null, "No workspace")}
            {workspaces.map((workspace) => row(workspace, workspace.name))}
          </List>
        )}
        {error && (
          <Typography color="error" sx={{ px: 2 }}>
            {errorText(error, "Workspaces could not be loaded.")}
          </Typography>
        )}
        {!isLoading && !error && workspaces.length === 0 && (
          <Typography variant="body2" sx={{ px: 2, pt: 1 }}>
            You have no workspaces yet.{" "}
            <Link component={NextLink} href="/workspaces">
              Create a workspace
            </Link>
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 1 }}>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
