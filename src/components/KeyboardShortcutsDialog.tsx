/**
 * Keyboard Shortcuts Dialog
 * Display all keyboard shortcuts in the app
 */

"use client";

import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Typography,
  Box,
  Chip,
  Divider,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import { SHORTCUT_GROUPS } from "@/lib/keyboard/shortcut-catalog";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
        Keyboard Shortcuts
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
          aria-label="Close"
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {SHORTCUT_GROUPS.map((category, idx) => (
          <Box
            key={category.title}
            sx={{ mb: idx < SHORTCUT_GROUPS.length - 1 ? 3 : 0 }}
          >
            <Typography
              variant="subtitle2"
              gutterBottom
              sx={{
                fontWeight: 700,
                color: "primary.main",
                letterSpacing: "0.02em",
              }}
            >
              {category.title}
            </Typography>
            {category.shortcuts.map((shortcut, sIdx) => (
              <Box
                key={sIdx}
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 2,
                  py: 0.9,
                  borderBottom: sIdx < category.shortcuts.length - 1 ? 1 : 0,
                  borderColor: "divider",
                }}
              >
                <Typography variant="body2">{shortcut.description}</Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    flexShrink: 0,
                  }}
                >
                  {shortcut.keys.map((key, kIdx) => (
                    <React.Fragment key={kIdx}>
                      {key === "+" ? (
                        <Typography
                          variant="caption"
                          sx={{ color: "text.secondary", mx: 0.25 }}
                        >
                          +
                        </Typography>
                      ) : (
                        <Chip
                          label={key}
                          size="small"
                          variant="outlined"
                          sx={{
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            height: 24,
                            bgcolor: "background.default",
                          }}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </Box>
              </Box>
            ))}
            {idx < SHORTCUT_GROUPS.length - 1 && <Divider sx={{ mt: 2 }} />}
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
}
