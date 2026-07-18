import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  IconButton,
} from "@mui/material";
import {
  EditNote as QuickEntryIcon,
  Send as SendIcon,
  Close as CloseIcon,
} from "@mui/icons-material";

interface WhisperModeProps {
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
}

export function WhisperMode({ open, onClose, onSend }: WhisperModeProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleSend = () => {
    if (text.trim()) {
      onSend(text);
      setText("");
      // Optional: Auto-close after sending or keep open for rapid entry?
      // Keeping open for rapid entry style.
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="quick-capture-title"
    >
      <DialogTitle id="quick-capture-title" sx={{ pb: 1 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            mb: 1,
            justifyContent: "space-between",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <QuickEntryIcon color="action" fontSize="small" sx={{ mr: 1 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600 }}
            >
              QUICK CAPTURE
            </Typography>
          </Box>
          <IconButton
            aria-label="Close quick capture"
            size="small"
            onClick={onClose}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <TextField
          inputRef={inputRef}
          fullWidth
          multiline
          minRows={1}
          maxRows={4}
          placeholder="Capture a thought…"
          variant="standard"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          InputProps={{
            disableUnderline: true,
            endAdornment: (
              <IconButton
                aria-label="Save quick capture"
                onClick={handleSend}
                disabled={!text.trim()}
                color="primary"
                size="small"
              >
                <SendIcon />
              </IconButton>
            ),
            style: { fontSize: "1.2rem" },
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
