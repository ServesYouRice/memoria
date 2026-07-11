/**
 * Confirmation Dialog Host
 *
 * Renders the app-wide MUI confirmation dialog driven by confirmStore.
 * Mounted once in Providers; triggered via `confirmDialog()`.
 */

"use client";

import React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useConfirmStore } from "@/stores/confirmStore";

export function ConfirmDialogHost() {
  const open = useConfirmStore((state) => state.open);
  const options = useConfirmStore((state) => state.options);
  const settle = useConfirmStore((state) => state.settle);

  return (
    <Dialog
      open={open}
      onClose={() => settle(false)}
      maxWidth="xs"
      fullWidth
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <DialogTitle id="confirm-dialog-title">
        {options.title ?? "Are you sure?"}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="confirm-dialog-description">
          {options.message}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => settle(false)}>
          {options.cancelText ?? "Cancel"}
        </Button>
        <Button
          onClick={() => settle(true)}
          variant="contained"
          color={options.destructive ? "error" : "primary"}
          autoFocus
        >
          {options.confirmText ?? "Confirm"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
