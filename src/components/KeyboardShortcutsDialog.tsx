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

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  shortcuts: Shortcut[];
}

const shortcuts: ShortcutCategory[] = [
  {
    title: "Canvas Navigation",
    shortcuts: [
      { keys: ["Space", "+", "Drag"], description: "Pan canvas" },
      { keys: ["Scroll"], description: "Zoom in/out" },
      { keys: ["Ctrl/Cmd", "+", "0"], description: "Reset zoom" },
    ],
  },
  {
    title: "Canvas Actions",
    shortcuts: [
      { keys: ["Delete"], description: "Delete selected items" },
      { keys: ["Ctrl/Cmd", "+", "A"], description: "Select all" },
    ],
  },
  {
    title: "Comments",
    shortcuts: [
      { keys: ["Ctrl/Cmd", "+", "Enter"], description: "Submit comment" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { keys: ["?"], description: "Show keyboard shortcuts" },
      { keys: ["Esc"], description: "Close dialogs" },
    ],
  },
];

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Keyboard Shortcuts
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
          aria-label="Close"
        >
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {shortcuts.map((category, idx) => (
          <Box
            key={category.title}
            sx={{ mb: idx < shortcuts.length - 1 ? 3 : 0 }}
          >
            <Typography
              variant="subtitle1"
              gutterBottom
              sx={{
                fontWeight: "bold",
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
                  py: 1,
                  borderBottom: sIdx < category.shortcuts.length - 1 ? 1 : 0,
                  borderColor: "divider",
                }}
              >
                <Typography variant="body2">{shortcut.description}</Typography>
                <Box sx={{ display: "flex", gap: 0.5 }}>
                  {shortcut.keys.map((key, kIdx) => (
                    <React.Fragment key={kIdx}>
                      {kIdx > 0 && (
                        <Typography variant="body2" sx={{ mx: 0.5 }}>
                          {key === "+" ? "+" : ""}
                        </Typography>
                      )}
                      {key !== "+" && (
                        <Chip
                          label={key}
                          size="small"
                          sx={{
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            height: 24,
                          }}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </Box>
              </Box>
            ))}
            {idx < shortcuts.length - 1 && <Divider sx={{ mt: 2 }} />}
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
}
